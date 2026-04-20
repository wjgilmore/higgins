import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { homedir, platform } from "node:os";

const IS_MACOS = platform() === "darwin";
const IS_LINUX = platform() === "linux";

// --- Shared ---

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

// --- macOS (launchd) ---

const LABEL_APP = "com.higgins.app";
const LABEL_SYNC = "com.higgins.calsync";

function launchAgentsDir() {
  return join(homedir(), "Library", "LaunchAgents");
}

function plistPath(label) {
  return join(launchAgentsDir(), `${label}.plist`);
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

async function installMacos(root) {
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

async function uninstallMacos() {
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

// --- Linux (systemd user units) ---

const UNIT_APP = "higgins.service";
const UNIT_SYNC = "higgins-calsync.service";
const UNIT_TIMER = "higgins-calsync.timer";

function systemdUserDir() {
  return join(homedir(), ".config", "systemd", "user");
}

function unitPath(name) {
  return join(systemdUserDir(), name);
}

function systemctl(...args) {
  const res = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  return res;
}

async function installLinux(root) {
  const unitDir = systemdUserDir();
  mkdirSync(unitDir, { recursive: true });
  mkdirSync(resolve(root, "logs"), { recursive: true });

  const node = nodeBinary();
  const vars = { HIGGINS_ROOT: root, NODE_PATH: node };

  for (const [unit, tpl] of [
    [UNIT_APP, "systemd/higgins.service.tpl"],
    [UNIT_SYNC, "systemd/higgins-calsync.service.tpl"],
    [UNIT_TIMER, "systemd/higgins-calsync.timer.tpl"],
  ]) {
    const src = resolve(root, tpl);
    if (!existsSync(src)) {
      console.warn(`  (missing template: ${src})`);
      continue;
    }
    const out = unitPath(unit);
    writeFileSync(out, renderTemplate(src, vars));
    console.log(`✓ Wrote ${unit} -> ${out}`);
  }

  systemctl("daemon-reload");
  systemctl("enable", "--now", UNIT_APP);
  systemctl("enable", "--now", UNIT_TIMER);
  console.log(`\nHiggins is now running in the background.`);
  console.log(`Logs: higgins logs  |  Stop: higgins uninstall-service`);
}

async function uninstallLinux() {
  systemctl("disable", "--now", UNIT_APP);
  systemctl("disable", "--now", UNIT_TIMER);
  for (const unit of [UNIT_APP, UNIT_SYNC, UNIT_TIMER]) {
    const path = unitPath(unit);
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`✓ Removed ${unit}`);
    } else {
      console.log(`  ${unit} was not installed`);
    }
  }
  systemctl("daemon-reload");
}

// --- Public API ---

export async function install(root) {
  if (IS_MACOS) return installMacos(root);
  if (IS_LINUX) return installLinux(root);
  console.error(`Unsupported platform: ${platform()}`);
  process.exit(1);
}

export async function uninstall() {
  if (IS_MACOS) return uninstallMacos();
  if (IS_LINUX) return uninstallLinux();
  console.error(`Unsupported platform: ${platform()}`);
  process.exit(1);
}

export async function logs(root, kind = "app") {
  const file =
    kind === "calsync"
      ? resolve(root, "logs/calsync.log")
      : resolve(root, "logs/higgins.log");

  // On Linux with systemd, prefer journalctl for live logs
  if (IS_LINUX && kind !== "calsync") {
    const child = spawn("journalctl", ["--user", "-u", UNIT_APP, "-f", "--no-pager"], {
      stdio: "inherit",
    });
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    return;
  }

  if (!existsSync(file)) {
    console.error(`No log file at ${file} yet. Service may not have started.`);
    process.exit(1);
  }
  const child = spawn("tail", ["-f", file], { stdio: "inherit" });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

export function isServiceInstalled() {
  if (IS_MACOS) {
    return existsSync(plistPath(LABEL_APP));
  }
  if (IS_LINUX) {
    return existsSync(unitPath(UNIT_APP));
  }
  return false;
}
