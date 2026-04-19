#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "calendars.json");
const DATA_DIR = resolve(__dirname, "data");
const TIMEOUT_MS = 30_000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      `No calendars.json at ${CONFIG_PATH}.\nRun \`higgins config calendar\` to add calendar URLs.`,
    );
    process.exit(1);
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.calendars)) {
    console.error("calendars.json must contain a 'calendars' array.");
    process.exit(1);
  }
  return data.calendars;
}

async function syncOne({ name, url }) {
  const dest = join(DATA_DIR, `${name}.ics`);
  const tmp = `${dest}.tmp`;
  const bak = `${dest}.bak`;
  if (existsSync(dest)) copyFileSync(dest, bak);

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (!body.startsWith("BEGIN:VCALENDAR")) {
    throw new Error("response did not look like iCalendar");
  }
  writeFileSync(tmp, body);
  renameSync(tmp, dest);
  return body.split("\n").length;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const calendars = loadConfig();
  if (calendars.length === 0) {
    log("No calendars configured; nothing to sync.");
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const cal of calendars) {
    if (!cal?.name || !cal?.url) {
      log(`Skipping malformed entry: ${JSON.stringify(cal)}`);
      fail++;
      continue;
    }
    try {
      const lines = await syncOne(cal);
      log(`${cal.name}: ${lines} lines`);
      ok++;
    } catch (err) {
      log(`ERROR ${cal.name}: ${err.message}`);
      const tmp = join(DATA_DIR, `${cal.name}.ics.tmp`);
      if (existsSync(tmp)) {
        try {
          unlinkSync(tmp);
        } catch {}
      }
      fail++;
    }
  }
  log(`Done. ${ok} synced, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
