import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";

import { readEnv } from "./envfile.mjs";
import { ollamaReachable, telegramReachable, nodeVersionOk } from "./checks.mjs";

const IS_MACOS = platform() === "darwin";
const IS_LINUX = platform() === "linux";

function status(ok, msg) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
}

function checkServicesMacos() {
  const launchAgents = `${homedir()}/Library/LaunchAgents`;
  for (const label of ["com.higgins.app", "com.higgins.calsync"]) {
    const path = `${launchAgents}/${label}.plist`;
    status(existsSync(path), `launchd: ${label} ${existsSync(path) ? "installed" : "not installed"}`);
  }
}

function checkServicesLinux() {
  for (const unit of ["higgins.service", "higgins-calsync.timer"]) {
    const res = spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" });
    const active = res.stdout.trim() === "active";
    status(active, `systemd: ${unit} ${active ? "active" : "not running"}`);
  }
}

export async function run(root) {
  const envPath = resolve(root, ".env");
  const env = readEnv(envPath);

  console.log(`Higgins — doctor\n`);
  status(existsSync(envPath), `.env present at ${envPath}`);

  const n = nodeVersionOk(20);
  status(n.ok, `Node.js ${n.version} ${n.ok ? "" : "(need 20+)"}`);

  status(true, `Platform: ${IS_MACOS ? "macOS" : IS_LINUX ? "Linux" : platform()}`);

  const backend = (env.LLM_BACKEND ?? "ollama").toLowerCase();
  const isMlx = backend === "mlx";
  const defaultUrl = isMlx ? "http://localhost:8000" : "http://localhost:11434";
  const llmUrl = env.LLM_URL ?? env.OLLAMA_URL ?? defaultUrl;
  const apiFormat = isMlx ? "openai" : (env.LLM_API_FORMAT ?? env.OLLAMA_API_FORMAT ?? "auto");
  status(true, `LLM backend: ${backend}`);
  const llmApiKey = env.LLM_API_KEY ?? "";
  const ol = await ollamaReachable(llmUrl, apiFormat, llmApiKey);
  status(ol.ok, `LLM reachable at ${llmUrl}${ol.ok ? ` (${ol.detectedFormat} API)` : ` (${ol.error})`}`);
  if (ol.ok) {
    const model = env.LLM_MODEL ?? env.OLLAMA_MODEL ?? (isMlx ? "" : "gemma4:latest");
    if (model) {
      const hasModel = ol.models.includes(model);
      status(hasModel, `Model "${model}" available${hasModel ? "" : ` — available models: ${ol.models.join(", ")}`}`);
    }
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

  if (IS_MACOS) checkServicesMacos();
  else if (IS_LINUX) checkServicesLinux();

  console.log("");
}
