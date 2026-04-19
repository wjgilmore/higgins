#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ICAL from "ical.js";

const CAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function parseArgs(argv) {
  const opts = { days: 7, date: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") opts.days = parseInt(argv[++i], 10);
    else if (a === "--date") opts.date = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: cal-query.mjs [--days N] [--date YYYY-MM-DD] [--json]",
      );
      process.exit(0);
    }
  }
  return opts;
}

function windowBounds({ days, date }) {
  if (date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { start, end };
}

function toDate(t) {
  return t.toJSDate();
}

function eventsFromComponent(vcal, winStart, winEnd) {
  const comp = new ICAL.Component(vcal);
  const vevents = comp.getAllSubcomponents("vevent");
  const rangeStart = ICAL.Time.fromJSDate(winStart, false);
  const rangeEnd = ICAL.Time.fromJSDate(winEnd, false);
  const out = [];

  for (const ve of vevents) {
    let evt;
    try {
      evt = new ICAL.Event(ve);
    } catch {
      continue;
    }
    if (!evt.startDate) continue;

    const isRecurring = evt.isRecurring();
    const summary = evt.summary || "(no title)";
    const location = evt.location || "";
    const description = evt.description || "";

    if (isRecurring) {
      const iter = evt.iterator();
      let next;
      let safety = 0;
      while ((next = iter.next())) {
        if (safety++ > 5000) break;
        if (next.compare(rangeEnd) >= 0) break;

        let occStart, occEnd;
        try {
          const det = evt.getOccurrenceDetails(next);
          occStart = det.startDate;
          occEnd = det.endDate;
        } catch {
          occStart = next;
          const dur = evt.endDate.subtractDate(evt.startDate);
          occEnd = next.clone();
          occEnd.addDuration(dur);
        }

        if (occEnd.compare(rangeStart) <= 0) continue;
        if (occStart.compare(rangeEnd) >= 0) break;

        out.push({
          summary,
          location,
          description,
          start: toDate(occStart),
          end: toDate(occEnd),
          allDay: occStart.isDate,
          recurring: true,
        });
      }
    } else {
      const s = evt.startDate;
      const e = evt.endDate || evt.startDate;
      const sd = toDate(s);
      const ed = toDate(e);
      if (ed <= winStart || sd >= winEnd) continue;
      out.push({
        summary,
        location,
        description,
        start: sd,
        end: ed,
        allDay: s.isDate,
        recurring: false,
      });
    }
  }
  return out;
}

function loadIcsFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ics"))
    .map((f) => ({
      name: f.replace(/\.ics$/, ""),
      path: join(dir, f),
    }));
}

function dedupe(events) {
  const seen = new Map();
  for (const e of events) {
    const key = `${e.summary}|${e.start.toISOString()}`;
    const prev = seen.get(key);
    if (!prev || (prev.recurring && !e.recurring)) seen.set(key, e);
  }
  return [...seen.values()];
}

function fmtLocal(d, allDay) {
  if (allDay) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: LOCAL_TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function fmtTime(d) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function humanOutput(events, win) {
  if (events.length === 0) {
    console.log("No events in range.");
    return;
  }
  const byDay = new Map();
  for (const e of events) {
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: LOCAL_TZ,
      year: "numeric",
      month: "2-digit",
      day: "numeric",
    }).format(e.start);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(e);
  }

  const days = [...byDay.keys()].sort();
  for (const day of days) {
    const header = new Intl.DateTimeFormat("en-US", {
      timeZone: LOCAL_TZ,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${day}T12:00:00`));
    console.log(`\n${header}`);
    console.log("-".repeat(header.length));
    for (const e of byDay.get(day)) {
      const marker = e.recurring ? " ↻" : "";
      const when = e.allDay
        ? "all-day"
        : `${fmtTime(e.start)}–${fmtTime(e.end)}`;
      const loc = e.location ? `  @ ${e.location}` : "";
      console.log(`  ${when}  ${e.summary}${marker}${loc}`);
    }
  }
  console.log(
    `\n(${events.length} events, ${LOCAL_TZ}, window ${win.start.toISOString()} → ${win.end.toISOString()})`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const win = windowBounds(opts);
  const files = loadIcsFiles(CAL_DIR);

  let all = [];
  for (const { name, path } of files) {
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let jcal;
    try {
      jcal = ICAL.parse(raw);
    } catch (err) {
      console.error(`Parse error in ${name}: ${err.message}`);
      continue;
    }
    const evts = eventsFromComponent(jcal, win.start, win.end).map((e) => ({
      ...e,
      calendar: name,
    }));
    all = all.concat(evts);
  }

  all = dedupe(all);
  all.sort((a, b) => a.start - b.start);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          timezone: LOCAL_TZ,
          window: { start: win.start.toISOString(), end: win.end.toISOString() },
          events: all.map((e) => ({
            summary: e.summary,
            calendar: e.calendar,
            start: e.start.toISOString(),
            end: e.end.toISOString(),
            allDay: e.allDay,
            recurring: e.recurring,
            location: e.location || undefined,
            description: e.description || undefined,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    humanOutput(all, win);
  }
}

main();
