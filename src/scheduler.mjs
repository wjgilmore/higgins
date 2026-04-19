import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_TIMEOUT = 2 ** 31 - 1;
const LATE_GRACE_MS = 5 * 60 * 1000;

export class Scheduler {
  constructor({ schedulesPath, runJob, defaultTimezone }) {
    this.path = schedulesPath;
    this.runJob = runJob;
    this.defaultTz = defaultTimezone;
    this.jobs = new Map();
  }

  load() {
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ schedules: [] }, null, 2));
    }
    const data = JSON.parse(readFileSync(this.path, "utf8"));
    return data.schedules ?? [];
  }

  save(schedules) {
    writeFileSync(this.path, JSON.stringify({ schedules }, null, 2));
  }

  list() {
    return this.load();
  }

  removeFromFile(id) {
    const remaining = this.load().filter((x) => x.id !== id);
    this.save(remaining);
  }

  async reload() {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();

    const schedules = this.load();
    const survivors = [];

    for (const s of schedules) {
      if (s.enabled === false) {
        survivors.push(s);
        continue;
      }

      if (s.runAt) {
        const fireAt = new Date(s.runAt);
        if (Number.isNaN(fireAt.getTime())) {
          console.warn(`[scheduler] Invalid runAt for ${s.id}: ${s.runAt}`);
          continue;
        }
        const delay = fireAt.getTime() - Date.now();
        if (delay <= 0) {
          if (-delay <= LATE_GRACE_MS) {
            console.log(
              `[scheduler] Firing ${s.id} late by ${Math.round(-delay / 1000)}s`,
            );
            setImmediate(() =>
              this.runJob(s).catch((err) =>
                console.error(`[scheduler] ${s.id} failed:`, err),
              ),
            );
          } else {
            console.warn(`[scheduler] Dropping stale one-time ${s.id}`);
          }
          continue;
        }
        if (delay > MAX_TIMEOUT) {
          console.warn(`[scheduler] ${s.id} fires >24d out; will reschedule on next reload`);
          survivors.push(s);
          continue;
        }
        const handle = setTimeout(async () => {
          try {
            console.log(`[scheduler] Firing ${s.id} (one-time)`);
            await this.runJob(s);
          } catch (err) {
            console.error(`[scheduler] ${s.id} failed:`, err);
          } finally {
            this.jobs.delete(s.id);
            this.removeFromFile(s.id);
          }
        }, delay);
        this.jobs.set(s.id, { stop: () => clearTimeout(handle) });
        survivors.push(s);
        console.log(
          `[scheduler] Registered one-time ${s.id} at ${fireAt.toISOString()}`,
        );
        continue;
      }

      if (!s.cron || !cron.validate(s.cron)) {
        console.warn(`[scheduler] Invalid cron for ${s.id}: ${s.cron}`);
        survivors.push(s);
        continue;
      }
      const tz = s.timezone ?? this.defaultTz;
      const job = cron.schedule(
        s.cron,
        async () => {
          try {
            console.log(`[scheduler] Firing ${s.id}`);
            await this.runJob(s);
          } catch (err) {
            console.error(`[scheduler] ${s.id} failed:`, err);
          }
        },
        { timezone: tz },
      );
      this.jobs.set(s.id, job);
      survivors.push(s);
      console.log(`[scheduler] Registered ${s.id} (${s.cron} ${tz})`);
    }

    if (survivors.length !== schedules.length) this.save(survivors);
  }

  async add(schedule) {
    const schedules = this.load();
    if (schedules.some((s) => s.id === schedule.id)) {
      throw new Error(`Schedule with id "${schedule.id}" already exists`);
    }
    schedules.push(schedule);
    this.save(schedules);
    await this.reload();
  }

  async remove(id) {
    const before = this.load();
    const after = before.filter((s) => s.id !== id);
    if (before.length === after.length) {
      throw new Error(`No schedule with id "${id}"`);
    }
    this.save(after);
    await this.reload();
  }

  async update(id, patch) {
    const schedules = this.load();
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`No schedule with id "${id}"`);
    schedules[idx] = { ...schedules[idx], ...patch };
    this.save(schedules);
    await this.reload();
  }
}
