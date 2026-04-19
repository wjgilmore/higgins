import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function readEnv(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function writeEnv(path, values) {
  const content = `# --- Telegram ---
TELEGRAM_BOT_TOKEN=${values.TELEGRAM_BOT_TOKEN ?? ""}
TELEGRAM_ALLOWED_USER_IDS=${values.TELEGRAM_ALLOWED_USER_IDS ?? ""}
TELEGRAM_PRIMARY_USER_ID=${values.TELEGRAM_PRIMARY_USER_ID ?? ""}

# --- Ollama ---
OLLAMA_URL=${values.OLLAMA_URL ?? "http://localhost:11434"}
OLLAMA_MODEL=${values.OLLAMA_MODEL ?? "gemma4:latest"}

# --- Higgins ---
HIGGINS_NAME=${values.HIGGINS_NAME ?? "Higgins"}
HIGGINS_TIMEZONE=${values.HIGGINS_TIMEZONE ?? "America/New_York"}
HIGGINS_HISTORY_TURNS=${values.HIGGINS_HISTORY_TURNS ?? "10"}

# Comma-separated list of enabled skill directory names under skills/.
# Leave empty to enable every skill that's present.
HIGGINS_SKILLS=${values.HIGGINS_SKILLS ?? ""}
`;
  writeFileSync(path, content);
}
