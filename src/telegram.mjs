import TelegramBot from "node-telegram-bot-api";

const MAX_CHUNK = 4000;

export class Telegram {
  constructor({ botToken, allowedUserIds }) {
    this.bot = new TelegramBot(botToken, { polling: true });
    this.allowed = new Set(allowedUserIds);
    this.handlers = [];

    this.bot.on("message", (msg) => {
      const userId = msg.from?.id;
      if (!this.allowed.has(userId)) {
        console.warn(`[telegram] Ignoring message from unauthorized user ${userId}`);
        return;
      }
      if (!msg.text) return;
      for (const h of this.handlers) {
        Promise.resolve(
          h({ userId, chatId: msg.chat.id, text: msg.text, msg }),
        ).catch((err) => console.error("[telegram] Handler error:", err));
      }
    });

    this.bot.on("polling_error", (err) => {
      console.error("[telegram] Polling error:", err.message);
    });
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  async send(chatId, text) {
    if (!text) return;
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      await this.bot.sendMessage(chatId, text.slice(i, i + MAX_CHUNK));
    }
  }

  async sendTyping(chatId) {
    try {
      await this.bot.sendChatAction(chatId, "typing");
    } catch {}
  }
}
