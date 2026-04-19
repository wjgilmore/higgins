import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { createPrompter } from "./prompt.mjs";
import { readEnv, writeEnv } from "./envfile.mjs";

export async function run(root, args) {
  const [sub] = args;
  if (sub === "calendar") return configureCalendar(root);
  if (sub === "skills") return configureSkills(root);
  console.error(`Usage: higgins config <calendar|skills>`);
  process.exit(2);
}

async function configureCalendar(root) {
  const path = resolve(root, "skills/calendar/calendars.json");
  const data = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { calendars: [] };
  const p = createPrompter();

  while (true) {
    console.log(`\nConfigured calendars:`);
    if (data.calendars.length === 0) console.log("  (none)");
    else data.calendars.forEach((c, i) => console.log(`  [${i + 1}] ${c.name}: ${c.url}`));

    const action = await p.ask(
      `\nAction: (a)dd, (r)emove, (d)one`,
      { default: data.calendars.length === 0 ? "a" : "d" },
    );
    if (action === "d" || action === "done") break;

    if (action === "a" || action === "add") {
      const name = await p.ask("  Name", { required: true });
      const url = await p.ask("  iCal URL", { required: true });
      data.calendars.push({ name, url });
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      console.log(`  ✓ Added ${name}`);
    } else if (action === "r" || action === "remove") {
      const idx = parseInt(await p.ask("  Number to remove"), 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= data.calendars.length) {
        const [gone] = data.calendars.splice(idx - 1, 1);
        writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
        console.log(`  ✓ Removed ${gone.name}`);
      } else {
        console.log("  (invalid index)");
      }
    }
  }

  p.close();
  console.log(`\n✓ Saved ${path}`);
}

async function configureSkills(root) {
  const envPath = resolve(root, ".env");
  const env = readEnv(envPath);
  const skillsDir = resolve(root, "skills");
  const available = readdirSync(skillsDir).filter((e) => {
    const full = join(skillsDir, e);
    return statSync(full).isDirectory() && existsSync(join(full, "skill.mjs"));
  });
  const currentlyEnabled = (env.HIGGINS_SKILLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`\nAvailable skills: ${available.join(", ")}`);
  console.log(`Currently enabled: ${currentlyEnabled.join(", ") || "(none)"}`);

  const p = createPrompter();
  const input = await p.ask(
    "Enable which skills? (comma-separated, or 'all')",
    { default: currentlyEnabled.join(",") || available.join(",") },
  );
  p.close();

  const enabled =
    input.toLowerCase() === "all"
      ? available
      : input
          .split(",")
          .map((s) => s.trim())
          .filter((s) => available.includes(s));

  writeEnv(envPath, { ...env, HIGGINS_SKILLS: enabled.join(",") });
  console.log(`\n✓ Updated HIGGINS_SKILLS=${enabled.join(",")} in ${envPath}`);
  console.log(`Restart Higgins to pick up the change.`);
}
