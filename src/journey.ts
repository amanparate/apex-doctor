import { RecentAnalysisEntry } from "./recentHistory";

export interface JourneyEntry {
  /** Recent-history entry id (drives apexDoctor.openRecent) */
  id: string;
  label: string;
  /** Wall-clock start from the log header, HH:MM:SS.mmm */
  startedAt?: string;
  totalDurationMs: number;
  errorCount: number;
  isCurrent: boolean;
}

const DEFAULT_WINDOW_SECONDS = 90;

/**
 * Stitch a "user journey" out of the saved Recent Analyses: the cluster of
 * logs whose execution start-times sit within `windowSeconds` of one another
 * (chained — A↔B and B↔C joins A,B,C), filtered to the same user when both
 * sides know who ran them.
 *
 * One UI click in Salesforce routinely produces several disconnected logs
 * (Aura/VF controller, triggers, @future…). This groups them back into the
 * single action the user actually performed.
 */
export function detectJourney(
  history: RecentAnalysisEntry[],
  currentSource: string | undefined,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
): JourneyEntry[] {
  if (!currentSource) {
    return [];
  }
  // The current log = newest history entry for this source path.
  const current = history.find((h) => h.source === currentSource);
  if (!current) {
    return [];
  }
  const currentT = secondsOfDay(current.analysis.summary.executionStart);
  if (currentT === undefined) {
    return [];
  }

  // De-dupe: keep the newest entry per (source, executionStart) so re-analysing
  // the same log doesn't produce phantom journey siblings.
  const seen = new Set<string>();
  const candidates: { entry: RecentAnalysisEntry; t: number }[] = [];
  for (const h of history) {
    const t = secondsOfDay(h.analysis.summary.executionStart);
    if (t === undefined) {
      continue;
    }
    const key = `${h.source}|${h.analysis.summary.executionStart}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (!sameUserIfKnown(current, h)) {
      continue;
    }
    candidates.push({ entry: h, t });
  }

  // Expand the cluster outward from the current log (chained proximity).
  candidates.sort((a, b) => a.t - b.t);
  const idx = candidates.findIndex((c) => c.entry.id === current.id);
  if (idx < 0) {
    return [];
  }
  let lo = idx;
  let hi = idx;
  while (lo > 0 && candidates[lo].t - candidates[lo - 1].t <= windowSeconds) {
    lo--;
  }
  while (hi < candidates.length - 1 && candidates[hi + 1].t - candidates[hi].t <= windowSeconds) {
    hi++;
  }

  const cluster = candidates.slice(lo, hi + 1);
  if (cluster.length < 2) {
    return []; // a journey of one isn't a journey
  }

  return cluster.map((c) => ({
    id: c.entry.id,
    label: c.entry.label,
    startedAt: c.entry.analysis.summary.executionStart,
    totalDurationMs: c.entry.totalDurationMs,
    errorCount: c.entry.errorCount,
    isCurrent: c.entry.id === current.id,
  }));
}

/** "HH:MM:SS.mmm" → seconds since midnight (same-day assumption). */
function secondsOfDay(ts?: string): number | undefined {
  if (!ts) {
    return undefined;
  }
  const m = /^(\d{2}):(\d{2}):(\d{2})\.(\d+)/.exec(ts);
  if (!m) {
    return undefined;
  }
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function sameUserIfKnown(a: RecentAnalysisEntry, b: RecentAnalysisEntry): boolean {
  const ua = a.analysis.userInfo?.Username;
  const ub = b.analysis.userInfo?.Username;
  if (ua && ub) {
    return ua === ub;
  }
  return true; // unknown on either side → don't exclude
}
