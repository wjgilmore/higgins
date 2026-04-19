function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugify(text, max = 40) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

function uniqueId(base, taken) {
  const seed = slugify(base) || "task";
  if (!taken.has(seed)) return seed;
  let i = 2;
  while (taken.has(`${seed}-${i}`)) i++;
  return `${seed}-${i}`;
}

export default {
  name: "schedule",
  description:
    "Manage Higgins's scheduled tasks. Use this ONLY when the user is asking you to TRIGGER something at a future time — e.g. 'remind me at 5pm', 'every morning send me X', 'wake me at 7am'. Do NOT use this when the user says 'note that', 'remember that', 'write down', or similar phrasings — those are for the notes skill, even if the note text mentions a time. When a task fires, its 'prompt' runs through Higgins and the reply is sent to the user via Telegram. Two kinds: RECURRING (use 'cron') and ONE-TIME (use 'runAt'). Choose based on the user's intent — 'every morning' is recurring, 'at 5pm today' or 'in two hours' is one-time. You do NOT need to ask the user for an id; generate one from context or omit it.",
  parameters: {
    type: "object",
    properties: {
      op: {
        type: "string",
        enum: ["list", "add", "remove", "update"],
        description: "Which operation to perform.",
      },
      id: {
        type: "string",
        description:
          "Optional. Unique id for the schedule (kebab-case). Auto-generated from the description/prompt if omitted. Required for remove/update.",
      },
      cron: {
        type: "string",
        description:
          "For RECURRING tasks only. 5-field cron expression: 'minute hour day-of-month month day-of-week'. Example: '0 7 * * *' = 7:00 AM every day.",
      },
      runAt: {
        type: "string",
        description:
          "For ONE-TIME tasks only. ISO 8601 datetime with timezone offset. Example for 5pm today Eastern: '2026-04-17T17:00:00-04:00'. Use the current date shown in the system prompt.",
      },
      timezone: {
        type: "string",
        description:
          "IANA timezone (e.g. 'America/New_York'). Defaults to the user's timezone. Only affects cron interpretation; runAt already has its offset baked in.",
      },
      description: {
        type: "string",
        description: "Short human-readable description of what the task does.",
      },
      prompt: {
        type: "string",
        description:
          "The instruction Higgins runs when the task fires. Write it as if the user is asking Higgins to do something. Example: 'Remind me about the 6:15pm soccer game.'",
      },
    },
    required: ["op"],
  },
  async handler(args, ctx) {
    const { scheduler, config } = ctx;
    const defaultTz = config.higgins.timezone;

    switch (args.op) {
      case "list": {
        const all = scheduler.list();
        if (all.length === 0) return "No scheduled tasks.";
        return JSON.stringify(
          all.map((s) => ({
            id: s.id,
            kind: s.runAt ? "one-time" : "recurring",
            when: s.runAt ?? s.cron,
            timezone: s.timezone ?? defaultTz,
            description: s.description,
            prompt: s.action?.prompt,
            enabled: s.enabled !== false,
          })),
          null,
          2,
        );
      }
      case "add": {
        if (!args.prompt) return "ERROR: add requires a prompt.";
        if (!args.cron && !args.runAt) {
          return "ERROR: add requires either cron (recurring) or runAt (one-time ISO datetime).";
        }
        if (args.cron && args.runAt) {
          return "ERROR: provide cron OR runAt, not both.";
        }
        const allExisting = scheduler.list();
        const newPrompt = normalize(args.prompt);
        const dup = allExisting.find((s) => {
          if (normalize(s.action?.prompt) !== newPrompt) return false;
          if (args.runAt && s.runAt === args.runAt) return true;
          if (args.cron && s.cron === args.cron) return true;
          return false;
        });
        if (dup) {
          return `A matching schedule already exists: "${dup.id}". Not creating a duplicate. If the user actually wants two identical reminders, have them confirm first and then use a slightly different prompt or time.`;
        }
        const existing = new Set(allExisting.map((s) => s.id));
        const id = args.id?.trim()
          ? args.id.trim()
          : uniqueId(args.description || args.prompt, existing);
        if (args.id && existing.has(id)) {
          return `ERROR: schedule "${id}" already exists.`;
        }
        const schedule = {
          id,
          timezone: args.timezone ?? defaultTz,
          description: args.description ?? "",
          action: { type: "prompt", prompt: args.prompt },
          enabled: true,
        };
        if (args.cron) schedule.cron = args.cron;
        if (args.runAt) schedule.runAt = args.runAt;
        await scheduler.add(schedule);
        const when = args.cron
          ? `cron '${args.cron}' ${schedule.timezone}`
          : `at ${args.runAt}`;
        return `Added schedule "${id}" (${when}).`;
      }
      case "remove": {
        if (!args.id) return "ERROR: remove requires id.";
        await scheduler.remove(args.id);
        return `Removed schedule "${args.id}".`;
      }
      case "update": {
        if (!args.id) return "ERROR: update requires id.";
        const patch = {};
        if (args.cron) patch.cron = args.cron;
        if (args.runAt) patch.runAt = args.runAt;
        if (args.timezone) patch.timezone = args.timezone;
        if (args.description != null) patch.description = args.description;
        if (args.prompt) patch.action = { type: "prompt", prompt: args.prompt };
        await scheduler.update(args.id, patch);
        return `Updated schedule "${args.id}".`;
      }
      default:
        return `ERROR: unknown op "${args.op}".`;
    }
  },
};
