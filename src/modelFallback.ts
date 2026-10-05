import * as https from "https";

type FallbackProvider = "gemini" | "openrouter";

/** Detects "this model doesn't exist / has no free quota" errors across providers. */
export function isModelUnavailableError(err: string): boolean {
  return (
    /HTTP 404/.test(err) ||
    /No endpoints found/i.test(err) ||
    /unexpected model name format/i.test(err) ||
    /is not found for API version/i.test(err) ||
    // OpenRouter returns 400 with "is not a valid model ID" for unknown model ids
    /not a valid model/i.test(err) ||
    /model[^.]*\b(not found|does not exist|unavailable|deprecated|decommissioned)\b/i.test(
      err,
    ) ||
    // Gemini returns 429 with "limit: 0" (or "quotaValue": "0") when a model
    // has no free tier at all. Match both quoted and unquoted shapes.
    (/HTTP 429/.test(err) &&
      /\b(limit|quotaValue)\s*[:="]+\s*"?0"?\b/.test(err))
  );
}

function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

/** Higher version first; among equal versions prefer the shorter (non-"lite") name. */
function byVersionDesc(a: string, b: string): number {
  const v = (s: string) => parseFloat((/(\d+(?:\.\d+)?)/.exec(s) || ["0"])[0]);
  return v(b) - v(a) || a.length - b.length;
}

export async function findFallbackModel(
  provider: FallbackProvider,
  apiKey: string,
  failedModel: string,
): Promise<string | undefined> {
  if (provider === "gemini") {
    const data = await getJson(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
    );
    const candidates: string[] = (data.models ?? [])
      .filter((m: any) =>
        (m.supportedGenerationMethods ?? []).includes("generateContent"),
      )
      .map((m: any) => String(m.name).replace(/^models\//, ""))
      .filter(
        (n: string) =>
          n.includes("flash") &&
          n !== failedModel &&
          !/(preview|exp|tts|image|audio|live|embedding|thinking)/i.test(n),
      );
    return candidates.sort(byVersionDesc)[0];
  }

  // OpenRouter: ask the catalogue for a currently-available ":free" model. We
  // skip the "openrouter/free" auto-router — it was removed from the catalogue
  // and 400s every request, so swapping to it would just fail the retry too.
  const data = await getJson("https://openrouter.ai/api/v1/models", {
    Authorization: `Bearer ${apiKey}`,
  });
  const free: string[] = (data.data ?? [])
    .map((m: any) => String(m.id))
    .filter(
      (id: string) =>
        id.endsWith(":free") && id !== failedModel && id !== "openrouter/free",
    );
  return free[0];
}
