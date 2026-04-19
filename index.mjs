import { config } from "./src/config.mjs";
import { Ollama } from "./src/ollama.mjs";
import { Telegram } from "./src/telegram.mjs";
import { loadSkills } from "./src/skills.mjs";
import { History } from "./src/history.mjs";
import { Agent } from "./src/agent.mjs";
import { Scheduler } from "./src/scheduler.mjs";

async function main() {
  const tag = `[${config.higgins.name}]`;
  console.log(`${tag} starting...`);

  const ollama = new Ollama(config.ollama);
  const nativeTools = await ollama.probeToolSupport();
  console.log(
    `${tag} native tool-calling for ${config.ollama.model}: ${nativeTools}`,
  );

  const skills = await loadSkills(config.paths.skills, {
    enabled: config.higgins.enabledSkills,
  });
  console.log(
    `${tag} loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`,
  );

  const telegram = new Telegram(config.telegram);
  const history = new History({ maxTurns: config.higgins.historyTurns });

  let scheduler;
  const getContext = ({ userId }) => ({
    userId,
    config,
    telegram,
    scheduler,
  });

  const agent = new Agent({ config, ollama, skills, history, getContext });

  scheduler = new Scheduler({
    schedulesPath: config.paths.schedules,
    defaultTimezone: config.higgins.timezone,
    runJob: async (schedule) => {
      const target = schedule.chatId ?? config.telegram.primaryUserId;
      await telegram.sendTyping(target);
      const reply = await agent.runTurn({
        userId: target,
        text: schedule.action?.prompt ?? "Run the scheduled job.",
        useHistory: false,
        scheduled: true,
      });
      await telegram.send(target, reply);
    },
  });
  await scheduler.reload();

  telegram.onMessage(async ({ userId, chatId, text }) => {
    try {
      const trimmed = text.trim();
      if (trimmed === "/reset") {
        history.reset(userId);
        await telegram.send(chatId, "Chat history cleared.");
        return;
      }
      if (trimmed === "/skills") {
        await telegram.send(
          chatId,
          `Available skills:\n${skills.map((s) => `• ${s.name}: ${s.description}`).join("\n")}`,
        );
        return;
      }
      if (trimmed === "/help" || trimmed === "/start") {
        await telegram.send(
          chatId,
          `Hi, I'm ${config.higgins.name}. Ask me about your schedule, or tell me to set up a recurring task.\n\nCommands:\n/reset — clear chat history\n/skills — list my capabilities`,
        );
        return;
      }
      await telegram.sendTyping(chatId);
      const reply = await agent.runTurn({ userId, text });
      await telegram.send(chatId, reply);
    } catch (err) {
      console.error("[higgins] chat error:", err);
      await telegram.send(chatId, `Sorry — something went wrong: ${err.message}`);
    }
  });

  console.log(`${tag} ready.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
