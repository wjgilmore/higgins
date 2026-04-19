import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readEnv } from "./envfile.mjs";
import { ollamaReachable, telegramReachable, nodeVersionOk } from "./checks.mjs";

function status(ok, msg) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
}

export async function run(root) {
  const envPath = resolve(root, ".env");
  const env = readEnv(envPath);

  console.log(`Higgins — doctor\n`);
  status(existsSync(envPath), `.env present at ${envPath}`);

  const n = nodeVersionOk(20);
  status(n.ok, `Node.js ${n.version} ${n.ok ? "" : "(need 20+)"}`);

  const ollamaUrl = env.OLLAMA_URL ?? "http://localhost:11434";
  const ol = await ollamaReachable(ollamaUrl);
  status(ol.ok, `Ollama reachable at ${ollamaUrl}${ol.ok ? "" : ` (${ol.error})`}`);
  if (ol.ok) {
    const model = env.OLLAMA_MODEL ?? "gemma4:latest";
    const hasModel = ol.models.includes(model);
    status(hasModel, `Model "${model}" available in Ollama${hasModel ? "" : ` — run 'ollama pull ${model}'`}`);
  }

  if (env.TELEGRAM_BOT_TOKEN) {
    const tg = await telegramReachable(env.TELEGRAM_BOT_TOKEN);
    status(tg.ok, tg.ok ? `Telegram bot OK (@${tg.botUsername})` : `Telegram: ${tg.error}`);
  } else {
    status(false, `TELEGRAM_BOT_TOKEN not set`);
  }
  status(!!env.TELEGRAM_PRIMARY_USER_ID, `TELEGRAM_PRIMARY_USER_ID set`);

  const skillsDir = resolve(root, "skills");
  status(existsSync(skillsDir), `skills/ directory present`);

  const calJson = resolve(root, "skills/calendar/calendars.json");
  const skills = (env.HIGGINS_SKILLS ?? "").split(",").map((s) => s.trim());
  if (skills.includes("calendar")) {
    status(existsSync(calJson), `calendar skill enabled; calendars.json ${existsSync(calJson) ? "present" : "missing"}`);
  }

  const launchAgents = `${process.env.HOME}/Library/LaunchAgents`;
  for (const label of ["com.higgins.app", "com.higgins.calsync"]) {
    const path = `${launchAgents}/${label}.plist`;
    status(existsSync(path), `launchd: ${label} ${existsSync(path) ? "installed" : "not installed"}`);
  }

  console.log("");
}
