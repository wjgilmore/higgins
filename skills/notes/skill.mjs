import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function timestamp(tz) {
  const d = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} ${time}`;
}

async function ensureFile(path) {
  await mkdir(dirname(path), { recursive: true });
  if (!existsSync(path)) await appendFile(path, "");
}

async function readAllNotes(path) {
  await ensureFile(path);
  const raw = await readFile(path, "utf8");
  return raw.split(/\r?\n/).filter(Boolean);
}

export default {
  name: "notes",
  description:
    "Capture and retrieve quick notes to a plain text file. ALWAYS use this skill (not schedule) when the user's message begins with or contains 'note that', 'remember that', 'write down', 'jot down', 'make a note', or 'keep in mind' — even if the content mentions a time, date, or action. In those cases the user is recording a thought verbatim, not asking you to schedule or act on anything. Also use this for 'what did I note about X?' or 'show me my recent notes'. One note per line, each timestamped. Do NOT use this skill for scheduling reminders — that's the schedule skill.",
  parameters: {
    type: "object",
    properties: {
      op: {
        type: "string",
        enum: ["add", "list", "search", "delete"],
        description:
          "add = save a new note; list = show the most recent notes; search = find notes matching a substring; delete = remove notes.",
      },
      text: {
        type: "string",
        description:
          "The note body. Required for 'add'. Newlines are collapsed into spaces so each note stays on one line.",
      },
      query: {
        type: "string",
        description:
          "Case-insensitive substring to match. Required for 'search'. Optional for 'delete' — deletes every note whose line contains this substring. Be precise: all matches are deleted.",
      },
      recent: {
        type: "integer",
        description:
          "For 'delete' only. Number of most recent notes to delete (e.g. 1 for 'delete my most recent note'). Use either 'recent' or 'query', not both.",
      },
      confirm: {
        type: "boolean",
        description:
          "For 'delete' only. Set to true on the SECOND call after the user confirms a multi-note deletion. The first call (without confirm) returns a preview; relay it to the user and ask 'proceed?'. Only call again with confirm: true after the user says yes. Single-note deletes don't need confirmation.",
      },
      limit: {
        type: "integer",
        description: "Max notes to return for list/search. Default 10, max 100.",
      },
    },
    required: ["op"],
  },
  async handler(args, ctx) {
    const notesPath = resolve(ctx.config.paths.data, "notes.txt");
    const tz = ctx.config.higgins.timezone;
    const limit = Math.min(Math.max(args?.limit ?? 10, 1), 100);

    switch (args?.op) {
      case "add": {
        const text = String(args.text ?? "").trim().replace(/\s+/g, " ");
        if (!text) return "ERROR: add requires 'text'.";
        await ensureFile(notesPath);
        await appendFile(notesPath, `${timestamp(tz)} | ${text}\n`);
        return `Saved: "${text}"`;
      }
      case "list": {
        const lines = await readAllNotes(notesPath);
        if (lines.length === 0) return "No notes yet.";
        return lines.slice(-limit).reverse().join("\n");
      }
      case "search": {
        const q = String(args.query ?? "").trim().toLowerCase();
        if (!q) return "ERROR: search requires 'query'.";
        const lines = await readAllNotes(notesPath);
        const hits = lines.filter((l) => l.toLowerCase().includes(q));
        if (hits.length === 0) return `No notes matching "${args.query}".`;
        return hits.slice(-limit).reverse().join("\n");
      }
      case "delete": {
        const lines = await readAllNotes(notesPath);
        if (lines.length === 0) return "No notes to delete.";

        const recentNum =
          typeof args.recent === "number"
            ? args.recent
            : parseInt(args.recent, 10);
        const hasRecent = Number.isFinite(recentNum) && recentNum > 0;
        const q = String(args.query ?? "").trim();
        const hasQuery = q.length > 0;

        if (!hasRecent && !hasQuery) {
          return "ERROR: delete requires either 'recent' (N most recent) or 'query' (substring).";
        }
        if (hasRecent && hasQuery) {
          return "ERROR: pass either 'recent' or 'query', not both.";
        }

        let candidates;
        let keep;
        let descriptor;
        if (hasRecent) {
          const n = Math.min(recentNum, lines.length);
          candidates = lines.slice(-n);
          keep = lines.slice(0, -n);
          descriptor = n === 1 ? "most recent note" : `${n} most recent notes`;
        } else {
          const needle = q.toLowerCase();
          candidates = lines.filter((l) => l.toLowerCase().includes(needle));
          keep = lines.filter((l) => !l.toLowerCase().includes(needle));
          if (candidates.length === 0) {
            return `No notes matching "${args.query}" to delete.`;
          }
          descriptor = `matching "${args.query}"`;
        }

        if (candidates.length > 1 && args.confirm !== true) {
          const preview = candidates.slice(-10).reverse().join("\n");
          return `CONFIRMATION NEEDED: This would delete ${candidates.length} notes (${descriptor}). Show this preview to the user and ask if they want to proceed. Only if they confirm, call delete again with the same arguments plus confirm: true.\n\nPreview:\n${preview}`;
        }

        await writeFile(notesPath, keep.map((l) => l + "\n").join(""));
        const preview = candidates.slice(-5).reverse().join("\n");
        const noun = candidates.length === 1 ? "note" : "notes";
        return `Deleted ${candidates.length} ${noun}:\n${preview}`;
      }
      default:
        return `ERROR: unknown op "${args?.op}".`;
    }
  },
};
