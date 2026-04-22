# Higgins

A personal AI agent that lives on your Mac, talks to you through Telegram, uses a local LLM via [Ollama](https://ollama.com) or [oMLX](https://omlx.com), and runs pluggable skills. Think of it as a butler you drop new tricks into by adding a directory.

Higgins is single-user, local-first, and MIT-licensed.

## Features

- **Telegram chat interface** — talk to Higgins from anywhere your phone is.
- **Local LLM via Ollama or oMLX** — no usage fees, no data leaving your machine.
- **Pluggable skills** — one directory per skill, auto-discovered at boot.
- **Scheduler** — ask Higgins in plain English to remind you at 5pm, every morning at 7, or in two hours.
- **Built-in skills** — calendar, weather, notes, schedule. Enable just the ones you want.
- **Runs in the background** — as a `launchd` agent, so it starts at login and restarts on crash.

## Built-in skills

| Skill      | What it does                                                                                |
| ---------- | ------------------------------------------------------------------------------------------- |
| `calendar` | Reads `.ics` files synced from your Google Calendars and answers questions about schedule. |
| `weather`  | Fetches current conditions and forecast for a US zip code (no API key).                     |
| `notes`    | Append-only timestamped notes in a plain text file. Add, list, search, delete.              |
| `schedule` | Set up recurring (cron) or one-time reminders. Higgins texts you when they fire.            |

## Requirements

- **macOS** (Linux support is planned; PRs welcome)
- **Node.js 20+** — `brew install node`
- **A local LLM backend** (pick one):
  - **Ollama** — install from <https://ollama.com>, then pull a chat model that supports tool-calling, e.g. `ollama pull gemma3:latest` (Higgins defaults to `gemma4:latest`)
  - **oMLX** — install from <https://omlx.com> (macOS with Apple Silicon only). Download a model in the oMLX app, then grab your API key from the oMLX menu bar icon > Settings.
- **A Telegram bot** — see [Telegram setup](#telegram-setup) below

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/wjgilmore/higgins/main/install.sh | bash
```

The installer will:

1. Verify macOS, Node 20+, and a running LLM backend (Ollama or oMLX).
2. Clone Higgins to `~/higgins` (override with `HIGGINS_DIR=...`).
3. `npm install`.
4. Run the setup wizard to collect your Telegram token, user ID, skills, and calendar URLs.
5. Optionally install launchd agents that keep Higgins running in the background and sync calendars daily at 6 AM.

### Manual install

```bash
git clone https://github.com/wjgilmore/higgins.git ~/higgins
cd ~/higgins
npm install
node bin/higgins.mjs setup
```

## Telegram setup

1. On Telegram, message **[@BotFather](https://t.me/BotFather)** and send `/newbot`. Follow the prompts. Copy the **bot token** it gives you — you'll paste it into the setup wizard.
2. Message **[@userinfobot](https://t.me/userinfobot)** and it will reply with your numeric **user ID**. You'll paste this in too — Higgins only responds to user IDs on an allowlist.
3. Find your bot (the username BotFather gave you) and send it `/start` to open the chat.
4. After setup, say hi. The first reply takes a few seconds while Ollama warms up.

## Configuration

Config lives in `~/higgins/.env`:

| Variable                    | Description                                                        | Default                  |
| --------------------------- | ------------------------------------------------------------------ | ------------------------ |
| `TELEGRAM_BOT_TOKEN`        | Bot token from @BotFather                                          | *(required)*             |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram user IDs allowed to chat                  | *(required)*             |
| `TELEGRAM_PRIMARY_USER_ID`  | Target for scheduled messages                                      | *(required)*             |
| `LLM_BACKEND`               | `ollama` or `mlx`                                                  | `ollama`                 |
| `LLM_URL`                   | LLM server endpoint                                                | `http://localhost:11434` (Ollama) / `http://localhost:8000` (oMLX) |
| `LLM_MODEL`                 | Model name                                                         | `gemma4:latest`          |
| `LLM_API_KEY`               | API key (required for oMLX)                                        |                          |
| `LLM_API_FORMAT`            | `ollama`, `openai`, or `auto`                                      | `auto`                   |
| `HIGGINS_NAME`              | What Higgins calls himself                                         | `Higgins`                |
| `HIGGINS_TIMEZONE`          | IANA timezone for dates/schedules                                  | `America/New_York`       |
| `HIGGINS_HISTORY_TURNS`     | Chat history turns kept per user                                   | `10`                     |
| `HIGGINS_SKILLS`            | Comma-separated list of enabled skills; empty = all present skills | `calendar,notes,schedule,weather` |

Re-run the wizard any time with `higgins setup`, or edit `.env` directly.

### Calendar URLs

The calendar skill reads `.ics` files under `skills/calendar/data/`, refreshed daily by `skills/calendar/cal-sync.mjs`. To add Google Calendars:

1. In Google Calendar, open the calendar's settings, scroll to **"Secret address in iCal format"** and copy the URL.
2. Run `higgins config calendar` and paste the URL.

Calendar URLs live in `skills/calendar/calendars.json`, which is **gitignored** so your private URLs don't get committed.

### Enabling/disabling skills

```bash
higgins config skills
```

## CLI

```text
higgins setup              Run the setup wizard
higgins start              Start Higgins in the foreground
higgins doctor             Check system prereqs and connectivity
higgins config calendar    Manage calendar URLs
higgins config skills      Enable/disable skills
higgins install-service    Install launchd agents
higgins uninstall-service  Remove launchd agents
higgins logs [app|calsync] Tail a log file
```

## Adding a custom skill

1. Create a directory under `skills/`, e.g. `skills/myskill/`.
2. Add `skill.mjs` exporting a default object with this shape:

```javascript
export default {
  name: "myskill",
  description: "What the skill does. The LLM reads this to decide when to call it.",
  parameters: {
    type: "object",
    properties: {
      thing: { type: "string", description: "what 'thing' means" },
    },
    required: ["thing"],
  },
  async handler(args, ctx) {
    // ctx.config, ctx.userId, ctx.telegram, ctx.scheduler, ctx.skillDir
    return `You asked about ${args.thing}`;
  },
};
```

3. Add `myskill` to `HIGGINS_SKILLS` in `.env` (or run `higgins config skills`).
4. Restart Higgins.

The string your handler returns is what the LLM sees as the tool result. Return JSON strings for structured data or plain text for simple cases. Throw on errors — Higgins will surface the message to the model.

Skills can read their own config files from `ctx.skillDir` (that's where the calendar skill keeps `calendars.json`).

## Running as a background service

```bash
higgins install-service
```

Installs two `launchd` agents to `~/Library/LaunchAgents/`:

- `com.higgins.app` — Higgins itself, starts at login, auto-restarts on crash.
- `com.higgins.calsync` — calendar sync, runs daily at 6 AM.

Logs land in `~/higgins/logs/`. Tail with `higgins logs` or `higgins logs calsync`.

To stop: `higgins uninstall-service`.

> **macOS note:** The first time the calendar sync runs, macOS may ask you to grant Full Disk Access. Open System Settings → Privacy & Security → Full Disk Access → press `+`, then `⌘⇧G` and type `/usr/sbin/cron` — approve.

## Troubleshooting

Run `higgins doctor` first — it'll catch most config issues.

- **"tool-calling for gemma4:latest: false"** — your model doesn't expose tool-calls in its chat template. Try `gemma3:latest`, `qwen2.5:latest`, or `llama3.2:latest`.
- **"API key required" (oMLX)** — set `LLM_API_KEY` in `.env`. Find the key in the oMLX menu bar icon > Settings.
- **Telegram bot doesn't respond** — check `higgins logs` for errors. Most likely: wrong token, or your user ID isn't in `TELEGRAM_ALLOWED_USER_IDS`.
- **Scheduled reminders don't fire** — Higgins must be running at the fire time (as a `launchd` agent, or in a terminal).
- **Morning digest is stale** — check `~/higgins/logs/calsync.log` and `skills/calendar/calendars.json`.

## Architecture

```
higgins/
├── index.mjs                  Main agent entry point
├── bin/higgins.mjs            CLI dispatcher
├── src/
│   ├── agent.mjs              Tool-use loop
│   ├── ollama.mjs             LLM client (Ollama + OpenAI-compat), tool-call probe
│   ├── telegram.mjs           Bot polling + whitelist
│   ├── scheduler.mjs          node-cron + setTimeout
│   ├── skills.mjs             Skill auto-loader
│   ├── history.mjs            In-memory per-user chat history
│   └── config.mjs             .env parsing
├── skills/
│   ├── calendar/              ICS sync + query
│   ├── notes/                 Plain-text capture
│   ├── schedule/              cron + one-time reminders
│   └── weather/               zip → forecast
├── scripts/                   Wizard, doctor, service mgmt
└── launchd/                   Plist templates
```

## Developing

If you have the `launchd` service installed, stop it first so you don't have two instances fighting over the Telegram bot:

```bash
higgins uninstall-service
```

Then run Higgins directly in your terminal:

```bash
npm start
```

This lets you see output in real-time and restart with `Ctrl+C` after making changes. The `launchd` service does **not** watch for file changes — edits to source files won't take effect until the process is restarted.

When you're done developing, re-enable the background service:

```bash
higgins install-service
```

## Contributing

Bug reports and skills PRs welcome. Keep skills self-contained (one directory, no repo-wide coupling) so other users can drop them in cleanly.

## License

MIT. See [LICENSE](./LICENSE).
