import { readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { createPrompter } from "./prompt.mjs";
import { readEnv, writeEnv } from "./envfile.mjs";
import { ollamaReachable, telegramReachable, nodeVersionOk } from "./checks.mjs";

function listSkillDirs(root) {
  const dir = resolve(root, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() && existsSync(join(full, "skill.mjs"));
  });
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/New_York";
  }
}

export async function run(root) {
  const envPath = resolve(root, ".env");
  const existing = readEnv(envPath);
  const p = createPrompter();

  console.log(`\nHiggins — setup wizard\n`);

  // --- Prereq checks ---
  const nodeCheck = nodeVersionOk(20);
  console.log(
    nodeCheck.ok
      ? `✓ Node.js ${nodeCheck.version}`
      : `✗ Node.js ${nodeCheck.version} (20+ required)`,
  );
  if (!nodeCheck.ok) {
    p.close();
    process.exit(1);
  }

  const ollamaUrl = existing.OLLAMA_URL ?? "http://localhost:11434";
  const ollamaResult = await ollamaReachable(ollamaUrl);
  if (!ollamaResult.ok) {
    console.log(`✗ Ollama not reachable at ${ollamaUrl}: ${ollamaResult.error}`);
    console.log(
      `  Install Ollama from https://ollama.com and start it, then re-run \`higgins setup\`.`,
    );
    p.close();
    process.exit(1);
  }
  console.log(`✓ Ollama reachable (${ollamaResult.models.length} models)`);

  // --- Telegram ---
  console.log(`\n--- Telegram ---`);
  console.log(
    `  Create a bot by messaging @BotFather on Telegram, send /newbot, follow prompts, copy the token.`,
  );
  const botToken = await p.ask("Telegram bot token", {
    default: existing.TELEGRAM_BOT_TOKEN,
    required: true,
  });

  const tg = await telegramReachable(botToken);
  if (!tg.ok) {
    console.log(`  (couldn't reach Telegram with that token: ${tg.error})`);
  } else {
    console.log(`  ✓ Talking to @${tg.botUsername}`);
  }

  console.log(
    `\n  Find your numeric Telegram user ID by messaging @userinfobot.`,
  );
  const userIds = await p.ask("Allowed Telegram user IDs (comma-separated)", {
    default: existing.TELEGRAM_ALLOWED_USER_IDS,
    required: true,
  });
  const primary = await p.ask("Primary user ID (for scheduled messages)", {
    default: existing.TELEGRAM_PRIMARY_USER_ID ?? userIds.split(",")[0]?.trim(),
    required: true,
  });

  // --- Higgins basics ---
  console.log(`\n--- Higgins ---`);
  const name = await p.ask("Assistant name", {
    default: existing.HIGGINS_NAME ?? "Higgins",
  });
  const timezone = await p.ask("Timezone (IANA, e.g. America/New_York)", {
    default: existing.HIGGINS_TIMEZONE ?? defaultTimezone(),
  });
  const model = await p.ask("Ollama model", {
    default: existing.OLLAMA_MODEL ?? "gemma4:latest",
  });

  if (ollamaResult.models.length && !ollamaResult.models.includes(model)) {
    console.log(
      `  ! Model "${model}" not found in Ollama. Available: ${ollamaResult.models.join(", ")}`,
    );
    console.log(`    Run \`ollama pull ${model}\` before starting Higgins.`);
  }

  // --- Skills ---
  console.log(`\n--- Skills ---`);
  const available = listSkillDirs(root);
  console.log(`  Available: ${available.join(", ")}`);
  const existingEnabled = existing.HIGGINS_SKILLS
    ? existing.HIGGINS_SKILLS.split(",").map((s) => s.trim()).filter(Boolean)
    : available;
  const skillsInput = await p.ask(
    "Enable which skills? (comma-separated, or 'all')",
    { default: existingEnabled.join(",") },
  );
  const enabled =
    skillsInput.toLowerCase() === "all"
      ? available
      : skillsInput
          .split(",")
          .map((s) => s.trim())
          .filter((s) => available.includes(s));
  console.log(`  Enabled: ${enabled.join(", ")}`);

  // --- Write .env ---
  writeEnv(envPath, {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_ALLOWED_USER_IDS: userIds,
    TELEGRAM_PRIMARY_USER_ID: primary,
    OLLAMA_URL: ollamaUrl,
    OLLAMA_MODEL: model,
    HIGGINS_NAME: name,
    HIGGINS_TIMEZONE: timezone,
    HIGGINS_HISTORY_TURNS: existing.HIGGINS_HISTORY_TURNS ?? "10",
    HIGGINS_SKILLS: enabled.join(","),
  });
  console.log(`\n✓ Wrote ${envPath}`);

  // --- Calendar config ---
  if (enabled.includes("calendar")) {
    const cfgPath = resolve(root, "skills/calendar/calendars.json");
    const existingCals = existsSync(cfgPath)
      ? JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(cfgPath, "utf8"))).calendars ?? []
      : [];

    console.log(`\n--- Calendar URLs ---`);
    if (existingCals.length > 0) {
      console.log(`  Currently configured:`);
      for (const c of existingCals) console.log(`    - ${c.name}: ${c.url}`);
    } else {
      console.log(
        `  Paste Google Calendar iCal URLs (Settings → your calendar → "Secret address in iCal format").`,
      );
    }
    const addMore = await p.confirm(
      existingCals.length > 0
        ? "Add more calendars?"
        : "Add calendar URLs now?",
      { default: existingCals.length === 0 },
    );

    const cals = [...existingCals];
    if (addMore) {
      while (true) {
        const name = await p.ask("  Calendar name (blank to finish)");
        if (!name) break;
        const url = await p.ask("  iCal URL", { required: true });
        cals.push({ name, url });
      }
    }

    mkdirSync(resolve(root, "skills/calendar/data"), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ calendars: cals }, null, 2) + "\n");
    console.log(`✓ Wrote ${cfgPath}`);

    if (cals.length > 0) {
      const syncNow = await p.confirm("Run cal-sync now to download iCal data?");
      if (syncNow) {
        const res = spawnSync(
          "node",
          [resolve(root, "skills/calendar/cal-sync.mjs")],
          { stdio: "inherit" },
        );
        if (res.status !== 0) {
          console.log("  (sync reported errors; check output above)");
        }
      }
    }
  }

  // --- Service install ---
  console.log(`\n--- Background service ---`);
  const installSvc = await p.confirm(
    "Install launchd agents so Higgins starts at login and calendars sync each morning?",
    { default: true },
  );
  if (installSvc) {
    const res = spawnSync(
      "node",
      [resolve(root, "bin/higgins.mjs"), "install-service"],
      { stdio: "inherit" },
    );
    if (res.status !== 0) {
      console.log("  (install-service reported errors; check output above)");
    }
  } else {
    console.log(
      `  Skipped. Start Higgins any time with:  node ${resolve(root, "index.mjs")}`,
    );
  }

  p.close();
  if (installSvc) {
    console.log(`\nDone. Message your bot on Telegram to say hi.`);
  } else {
    console.log(`\nDone. Start Higgins with \`node ${resolve(root, "index.mjs")}\`, then message your bot on Telegram.`);
  }
}
