// Regenerates the Commands and Settings tables in README.md from package.json.
// Runs automatically via "vscode:prepublish". Manual: npm run docs
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const readmePath = path.join(root, "README.md");
let readme = fs.readFileSync(readmePath, "utf8");

const cell = (s) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();

// ---- Commands (skip ones hidden from the palette with when: "false") ----
const hidden = new Set(
  (pkg.contributes?.menus?.commandPalette ?? [])
    .filter((m) => m.when === "false")
    .map((m) => m.command),
);
const commands = (pkg.contributes?.commands ?? []).filter(
  (c) => !hidden.has(c.command),
);
const commandsTable = [
  "| Command | ID |",
  "| --- | --- |",
  ...commands.map(
    (c) =>
      `| ${cell(c.category ? `${c.category}: ${c.title}` : c.title)} | \`${c.command}\` |`,
  ),
].join("\n");

// ---- Settings (configuration can be an object or an array of sections) ----
const configs = [].concat(pkg.contributes?.configuration ?? []);
const settings = configs.flatMap((cfg) => Object.entries(cfg.properties ?? {}));
const settingsTable = [
  "| Setting | Default | Description |",
  "| --- | --- | --- |",
  ...settings.map(([key, p]) => {
    let desc = p.markdownDescription || p.description || "";
    if (Array.isArray(p.enum)) {
      desc += ` One of: ${p.enum.map((e) => `\`${e}\``).join(", ")}.`;
    }
    const def =
      p.default === undefined ? "" : `\`${JSON.stringify(p.default)}\``;
    return `| \`${key}\` | ${cell(def)} | ${cell(desc)} |`;
  }),
].join("\n");

function inject(md, key, content) {
  const re = new RegExp(
    `(<!-- ${key}:START -->)[\\s\\S]*?(<!-- ${key}:END -->)`,
  );
  if (!re.test(md)) {
    throw new Error(
      `README.md is missing <!-- ${key}:START --> / <!-- ${key}:END --> markers`,
    );
  }
  // Function replacement so "$" in descriptions is never treated as a backreference
  return md.replace(re, (_, start, end) => `${start}\n${content}\n${end}`);
}

readme = inject(readme, "COMMANDS", commandsTable);
readme = inject(readme, "SETTINGS", settingsTable);
fs.writeFileSync(readmePath, readme);
console.log(
  `README.md updated: ${commands.length} commands, ${settings.length} settings.`,
);
