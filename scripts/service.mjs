import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { homedir } from "node:os";

const LABEL_APP = "com.higgins.app";
const LABEL_SYNC = "com.higgins.calsync";

function launchAgentsDir() {
  return join(homedir(), "Library", "LaunchAgents");
}

function plistPath(label) {
  return join(launchAgentsDir(), `${label}.plist`);
}

function renderTemplate(templatePath, vars) {
  let content = readFileSync(templatePath, "utf8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.split(`{{${key}}}`).join(value);
  }
  return content;
}

function nodeBinary() {
  const which = spawnSync("which", ["node"]);
  const path = which.stdout.toString().trim();
  return path || "/usr/local/bin/node";
}

function loadAgent(label) {
  const path = plistPath(label);
  const res = spawnSync("launchctl", ["load", "-w", path], { encoding: "utf8" });
  if (res.status !== 0 && !/already loaded/i.test(res.stderr)) {
    console.warn(`  (launchctl load ${label}: ${res.stderr.trim()})`);
  }
}

function unloadAgent(label) {
  const path = plistPath(label);
  if (!existsSync(path)) return;
  spawnSync("launchctl", ["unload", "-w", path], { encoding: "utf8" });
}

export async function install(root) {
  const agentsDir = launchAgentsDir();
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(resolve(root, "logs"), { recursive: true });

  const node = nodeBinary();
  const vars = { HIGGINS_ROOT: root, NODE_PATH: node };

  for (const [label, tpl] of [
    [LABEL_APP, "launchd/com.higgins.app.plist.tpl"],
    [LABEL_SYNC, "launchd/com.higgins.calsync.plist.tpl"],
  ]) {
    const src = resolve(root, tpl);
    if (!existsSync(src)) {
      console.warn(`  (missing template: ${src})`);
      continue;
    }
    const out = plistPath(label);
    unloadAgent(label);
    writeFileSync(out, renderTemplate(src, vars));
    loadAgent(label);
    console.log(`✓ Installed ${label} -> ${out}`);
  }
  console.log(`\nHiggins is now running in the background.`);
  console.log(`Logs: higgins logs  |  Stop: higgins uninstall-service`);
}

export async function uninstall() {
  for (const label of [LABEL_APP, LABEL_SYNC]) {
    const path = plistPath(label);
    if (existsSync(path)) {
      unloadAgent(label);
      unlinkSync(path);
      console.log(`✓ Removed ${label}`);
    } else {
      console.log(`  ${label} was not installed`);
    }
  }
}

export async function logs(root, kind = "app") {
  const file =
    kind === "calsync"
      ? resolve(root, "logs/calsync.log")
      : resolve(root, "logs/higgins.log");
  if (!existsSync(file)) {
    console.error(`No log file at ${file} yet. Service may not have started.`);
    process.exit(1);
  }
  const child = spawn("tail", ["-f", file], { stdio: "inherit" });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
