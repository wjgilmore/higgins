import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileP = promisify(execFile);

function todayISO(tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "numeric",
  }).format(new Date());
}

const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default {
  name: "calendar",
  description:
    "Look up the user's calendar events. Use this whenever the user asks about their schedule, calendar, meetings, or what's coming up. Defaults to today.",
  parameters: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description:
          "A single day to look up, in YYYY-MM-DD format. Use this for 'today', 'tomorrow', or a specific date.",
      },
      days: {
        type: "integer",
        description:
          "Number of days to look ahead from today (e.g. 7 for this week). Only used when 'date' is not provided.",
      },
    },
  },
  async handler(args, ctx) {
    const tz = ctx.config.higgins.timezone;
    const script = resolve(ctx.skillDir, "cal-query.mjs");
    const argv = ["--json"];

    if (isIso(args?.date)) {
      argv.push("--date", args.date);
    } else if (Number.isFinite(args?.days) && args.days > 0) {
      argv.push("--days", String(args.days));
    } else {
      argv.push("--date", todayISO(tz));
    }

    const { stdout } = await execFileP("node", [script, ...argv], {
      maxBuffer: 10 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout);
    const dayFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const enriched = {
      timezone: parsed.timezone,
      window: parsed.window,
      events: (parsed.events ?? []).map((e) => {
        const start = new Date(e.start);
        const end = new Date(e.end);
        return {
          summary: e.summary,
          day: dayFmt.format(start),
          time: e.allDay
            ? "all day"
            : `${timeFmt.format(start)} – ${timeFmt.format(end)}`,
          allDay: e.allDay,
          location: e.location,
          calendar: e.calendar,
          recurring: e.recurring,
          start_iso: e.start,
          end_iso: e.end,
        };
      }),
    };
    return JSON.stringify(enriched, null, 2);
  },
};
