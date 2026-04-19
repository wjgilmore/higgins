import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
dotenv.config({ path: resolve(ROOT, ".env") });

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const enabledSkills = parseList(process.env.HIGGINS_SKILLS);

export const config = Object.freeze({
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: parseList(required("TELEGRAM_ALLOWED_USER_IDS")).map((s) =>
      parseInt(s, 10),
    ),
    primaryUserId: parseInt(required("TELEGRAM_PRIMARY_USER_ID"), 10),
  },
  ollama: {
    url: (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL ?? "gemma4:latest",
  },
  higgins: {
    name: process.env.HIGGINS_NAME ?? "Higgins",
    timezone: process.env.HIGGINS_TIMEZONE ?? "America/New_York",
    historyTurns: parseInt(process.env.HIGGINS_HISTORY_TURNS ?? "10", 10),
    enabledSkills,
  },
  paths: {
    root: ROOT,
    skills: resolve(ROOT, "skills"),
    data: resolve(ROOT, "data"),
    schedules: resolve(ROOT, "data", "schedules.json"),
    logs: resolve(ROOT, "logs"),
  },
});
