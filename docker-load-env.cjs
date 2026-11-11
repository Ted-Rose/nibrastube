// Minimal dotenv loader, preloaded via `node --require` (see
// docker-entrypoint.sh) so process.env is populated before any app module
// is imported. Skips blank lines, comments, and vars already set in the
// real environment (explicit env vars win over file contents).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");

const envPath = process.env.ENV_FILE_PATH || "/tmp/.env.runtime";

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}
