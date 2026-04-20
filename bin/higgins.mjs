#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , cmd, ...rest] = process.argv;

function help() {
  console.log(`Higgins — a personal AI agent

Usage: higgins <command> [args]

Commands:
  setup                Run the first-time configuration wizard
  start                Start Higgins in the foreground
  doctor               Check system prerequisites and connectivity
  config calendar      Add, remove, or list calendar URLs
  config skills        Enable or disable skills
  install-service      Install background services (launchd on macOS, systemd on Linux)
  uninstall-service    Remove background services
  logs [kind]          Tail logs ('app' or 'calsync'; default 'app')
  help                 Show this help

Docs: https://github.com/wjgilmore/higgins
`);
}

async function main() {
  switch (cmd) {
    case "setup":
      return (await import("../scripts/setup.mjs")).run(ROOT);
    case "start":
      return import("../index.mjs");
    case "doctor":
      return (await import("../scripts/doctor.mjs")).run(ROOT);
    case "config":
      return (await import("../scripts/config.mjs")).run(ROOT, rest);
    case "install-service":
      return (await import("../scripts/service.mjs")).install(ROOT);
    case "uninstall-service":
      return (await import("../scripts/service.mjs")).uninstall(ROOT);
    case "logs":
      return (await import("../scripts/service.mjs")).logs(ROOT, rest[0]);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return help();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      help();
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
