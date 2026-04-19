import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function createPrompter() {
  const rl = readline.createInterface({ input, output });
  const close = () => rl.close();

  async function ask(question, { default: defaultValue, required } = {}) {
    while (true) {
      const hint = defaultValue !== undefined && defaultValue !== ""
        ? ` [${defaultValue}]`
        : "";
      const answer = (await rl.question(`${question}${hint}: `)).trim();
      if (answer) return answer;
      if (defaultValue !== undefined && defaultValue !== "") return defaultValue;
      if (!required) return "";
      console.log("  (required — please enter a value)");
    }
  }

  async function confirm(question, { default: defaultYes = true } = {}) {
    const hint = defaultYes ? " [Y/n]" : " [y/N]";
    const raw = (await rl.question(`${question}${hint}: `)).trim().toLowerCase();
    if (!raw) return defaultYes;
    return raw === "y" || raw === "yes";
  }

  return { ask, confirm, close };
}
