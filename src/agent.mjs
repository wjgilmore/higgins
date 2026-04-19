import { asOllamaTools } from "./skills.mjs";

const MAX_ITERATIONS = 8;

export class Agent {
  constructor({ config, ollama, skills, history, getContext }) {
    this.config = config;
    this.ollama = ollama;
    this.skills = skills;
    this.skillsByName = new Map(skills.map((s) => [s.name, s]));
    this.history = history;
    this.getContext = getContext;
    this.tools = asOllamaTools(skills);
  }

  systemPrompt(useNative, scheduled = false) {
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: this.config.higgins.timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);
    const isoToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.config.higgins.timezone,
      year: "numeric",
      month: "2-digit",
      day: "numeric",
    }).format(now);

    const skillList = this.skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");

    let prompt = `You are ${this.config.higgins.name}, a personal AI assistant for the user.
Current time: ${dateStr}
Today's date (ISO, user's timezone): ${isoToday}
User's timezone: ${this.config.higgins.timezone}

Be warm, concise, and helpful. Respond conversationally — never dump raw JSON or tool output at the user. Summarize tool results in plain English.

FORMATTING: Reply in PLAIN TEXT only. The user reads your messages in Telegram, which does NOT render Markdown by default — so \`**bold**\`, \`*italic*\`, \`# headers\`, \`\`\`code fences\`\`\`, and backtick-quoting all show up as literal punctuation and look broken. Do not use any of them. For bullet lists, use a \`•\` (U+2022) or \`-\` at the start of the line. For section headings, use a plain line of text followed by a blank line — no \`#\` or asterisks. Emojis are fine in moderation.

When presenting lists of facts (calendar events, schedules, notes, weather), present them straight. Do NOT editorialize about the data — no "super busy!", "packed schedule", "looks like a quiet day", or similar commentary on density, tone, or quality. No unsolicited observations, takeaways, or "looking ahead" sections. Just the facts, cleanly formatted. Let the user draw their own conclusions.

When showing calendar events, quote the pre-formatted 'time' and 'day' fields from the tool output verbatim. Do NOT reformat ISO timestamps yourself — the tool has already converted them to the user's local timezone, and any arithmetic you do on 'start_iso' / 'end_iso' will likely be wrong.`;

    if (scheduled) {
      prompt += `\n\n*** SCHEDULED TASK CONTEXT ***
This turn is NOT a live user message — a previously scheduled task just fired, and its prompt is the message you're seeing. Your job is to ACT on it and produce the final text that will be delivered to the user via Telegram.

Hard rules for scheduled turns:
- Do NOT call the schedule tool. The task that fired was already scheduled; the user does not want you to create another copy of it or schedule a follow-up.
- If the prompt asks you to "message me / remind me / tell me about X", just compose that message and return it as your reply. Do not treat it as a request to set up a new reminder.
- You may freely call read-only tools (calendar, weather, notes list/search) if you need data to compose the message.
- Keep the reply in the voice of a text message — short, direct, friendly.`;
    }

    if (useNative) {
      prompt += `\n\nYou have tools available. Call them when they're needed to answer the user's question.

Routing guidance — pay attention to the user's framing verb, not just the content:
- "note that X", "remember that X", "write down X", "jot this down", "keep in mind X" → use the notes skill to capture X verbatim, even if X mentions a time or action. The user is recording a thought, not asking you to act on it.
- "remind me to X at/on <time>", "schedule X at <time>", "wake me up at <time>" → use the schedule skill.
- When in doubt between notes and schedule, ask the user rather than guessing.`;
    } else {
      prompt += `\n\nYou have these tools:\n${skillList}\n\nTo call a tool, respond with ONLY a JSON object on a single line:
{"tool": "<name>", "args": { ... }}
After the tool result is returned to you, respond in plain natural language.
If no tool is needed, just reply in natural language (no JSON).`;
    }
    return prompt;
  }

  async runTurn({ userId, text, useHistory = true, scheduled = false }) {
    const useNative = await this.ollama.probeToolSupport();
    const system = {
      role: "system",
      content: this.systemPrompt(useNative, scheduled),
    };
    const prior = useHistory ? this.history.get(userId) : [];
    const userMsg = { role: "user", content: text };
    const messages = [system, ...prior, userMsg];
    const newTurns = [userMsg];

    const reply = await this.loop(messages, newTurns, userId, useNative);

    if (useHistory) {
      for (const m of newTurns) this.history.append(userId, m);
    }
    return reply;
  }

  async loop(messages, transcript, userId, useNative) {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await this.ollama.chat({
        messages,
        tools: this.tools,
        useNative,
      });
      const msg = res.message ?? {};
      const content = msg.content ?? "";
      const calls = this.extractToolCalls(msg, useNative);

      if (calls.length === 0) {
        const asst = { role: "assistant", content };
        messages.push(asst);
        transcript.push(asst);
        return content.trim();
      }

      const assistantTurn = useNative
        ? { role: "assistant", content, tool_calls: msg.tool_calls }
        : { role: "assistant", content };
      messages.push(assistantTurn);
      transcript.push(assistantTurn);

      for (const call of calls) {
        const result = await this.runSkill(call, userId);
        const toolMsg = useNative
          ? { role: "tool", name: call.name, content: result }
          : { role: "user", content: `[tool:${call.name} result]\n${result}` };
        messages.push(toolMsg);
        transcript.push(toolMsg);
      }
    }
    return "(Exceeded tool-use iterations. Please try rephrasing.)";
  }

  extractToolCalls(msg, useNative) {
    if (useNative) {
      const calls = msg.tool_calls ?? [];
      return calls.map((c) => ({
        name: c.function?.name ?? c.name,
        args: c.function?.arguments ?? c.arguments ?? {},
      }));
    }
    const content = msg.content ?? "";
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fence ? fence[1] : content;
    const braceIdx = candidate.indexOf("{");
    if (braceIdx < 0) return [];
    const jsonLike = candidate.slice(braceIdx).trim();
    try {
      const parsed = JSON.parse(jsonLike);
      if (parsed && typeof parsed === "object" && parsed.tool) {
        return [{ name: parsed.tool, args: parsed.args ?? {} }];
      }
    } catch {}
    return [];
  }

  async runSkill(call, userId) {
    const skill = this.skillsByName.get(call.name);
    if (!skill) return `ERROR: unknown skill "${call.name}"`;
    let args = call.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    try {
      const ctx = { ...this.getContext({ userId }), skillDir: skill.skillDir };
      const result = await skill.handler(args ?? {}, ctx);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      console.error(`[agent] Skill ${call.name} error:`, err);
      return `ERROR: ${err.message}`;
    }
  }
}
