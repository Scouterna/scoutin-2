---
name: run-scoutin
description: Build, run, and drive the scoutin-2 kiosk check-in app (backend + frontend + Postgres). Use when asked to start the app, run the dev servers, take a screenshot of the kiosk UI, or interact with the running kiosk flow.
---

scoutin-2 is a full-stack app: a Hono backend (`packages/backend`), a
React/Vite kiosk frontend (`packages/frontend`), and Postgres. There's
no `chromium-cli` in this environment, so it's driven via a Playwright
REPL at `.claude/skills/run-scoutin/driver.mjs` — launch it, then send
it commands (`up`, `launch`, `register-kiosk`, `click-text`, `ss`, ...).

All paths below are relative to the repo root.

## Prerequisites

Chromium's shared libs were already present in this container (no
`apt-get` was needed to launch it here). If a genuinely clean machine
hits missing `.so` errors on `launch`, run:

```bash
cd .claude/skills/run-scoutin && npx playwright install-deps chromium
```

## Setup

```bash
pnpm install                                    # from repo root, once
cd .claude/skills/run-scoutin && npm install    # driver's own deps (isolated from the pnpm workspace)
npx playwright install chromium                 # downloads the matching browser build if not already cached
```

`packages/backend` needs a `.env` (see `.env.example`) with at minimum
`DATABASE_URL`, `TOKEN_SECRET`, `DATASOURCE_HASHING_SECRET`,
`DATASOURCE_HASHING_SALT` — check it exists before `up`; the driver
doesn't create it.

## Run (agent path)

```bash
tmux new-session -d -s scoutin -x 200 -y 50
tmux send-keys -t scoutin 'cd /path/to/scoutin-2 && node .claude/skills/run-scoutin/driver.mjs' Enter
timeout 15 bash -c 'until tmux capture-pane -t scoutin -p | grep -q "driver>"; do sleep 0.3; done'
```

Send commands with `send-keys -l '<command>'` (the `-l` **literal**
flag matters — see Gotchas) followed by a separate `send-keys ... Enter`:

```bash
tmux send-keys -t scoutin -l 'up'
tmux send-keys -t scoutin Enter
timeout 40 bash -c 'until tmux capture-pane -t scoutin -p | grep -qE "frontend (already running|ready)"; do sleep 1; done'

tmux send-keys -t scoutin -l 'launch'; tmux send-keys -t scoutin Enter
sleep 2
tmux send-keys -t scoutin -l 'register-kiosk'; tmux send-keys -t scoutin Enter
sleep 2
tmux send-keys -t scoutin -l 'click-text Checka in'; tmux send-keys -t scoutin Enter
tmux send-keys -t scoutin -l 'wait-text Gå tillbaka'; tmux send-keys -t scoutin Enter
tmux send-keys -t scoutin -l 'ss 01-step-screen'; tmux send-keys -t scoutin Enter
tmux capture-pane -t scoutin -p
```

Screenshots land in `/tmp/scoutin-shots/` (override with
`SCREENSHOT_DIR`).

| command | what it does |
|---|---|
| `up` | Starts Postgres (`docker-compose up -d`) + backend + frontend. **Idempotent** — reuses already-running servers instead of spawning duplicates (see Gotchas). |
| `launch` | Launches headless Chromium. |
| `register-kiosk` | Runs the real kiosk setup-token → activate flow against the backend admin API, stores the resulting `kioskKey` in the page's `localStorage`, reloads. Required before "Checka in" will work — a fresh page has no kiosk key. |
| `unregister-kiosk` | Deletes the kiosk this session registered (cleanup). |
| `nav [url]` | Navigate (defaults to the frontend URL). |
| `click-text <text>` | Finds a real `button`/`a`/`[role=button]` whose text matches and calls `.click()` on it directly — see Gotchas for why this beats Playwright's `text=` locator here. |
| `type <text>` / `press <key>` | Keyboard input. |
| `wait <css-sel>` | Wait for a selector, 10s timeout. |
| `wait-text <text>` | Wait for text anywhere in `document.body.innerText`, 15s timeout — step screens are plugin components with no stable selectors, so this is usually the right one. |
| `ss [name]` | Screenshot → `/tmp/scoutin-shots/<name>.png`. |
| `text [css-sel]` | Print `innerText` (whole body if no selector). |
| `eval <js>` | Evaluate in the page, print JSON. |
| `down` | Closes the browser and stops **only** servers this driver itself spawned (never touches a server a human already had running). |
| `quit` | `down`, then exit. |

## Run (human path)

```bash
docker-compose up -d
cd packages/backend && pnpm dev    # http://localhost:3005
cd packages/frontend && pnpm dev   # http://localhost:5173 — Ctrl-C to stop
```

Useless for an agent (opens nothing headless-visible) but this is what
a person does.

## Test

```bash
cd packages/backend && pnpm build         # typecheck
cd packages/frontend && pnpm test         # Vitest
pnpm biome check .                        # from repo root
```

## Gotchas

- **`tmux send-keys` without `-l` treats plain words as key names.**
  Sending `up` (no `-l`) was silently interpreted as the **Up arrow**
  key (`^[[A`) instead of the literal string "up" — the command never
  ran. Always use `send-keys -l '<text>'` then a separate
  `send-keys Enter` for driver commands.

- **`@scouterna/ui-react`'s `<scout-button>` renders a real light-DOM
  `<button>` inside itself (no shadow root), but Playwright's `text=`
  locator resolves to the outer `<scout-button>` host** — whose own
  `.click()` is a no-op, since the library's click handler is bound to
  the inner `<button>`. `page.click('text=Checka in')` silently did
  nothing (no request, no navigation). Fix: search
  `document.querySelectorAll('button, a, [role="button"]')` for the
  matching text and call `.click()` on that element directly — this is
  what the driver's `click-text` command does.

- **A duplicate `pnpm dev` collides with an already-running one, loudly.**
  If the backend port (3005) or frontend port (5173) is already
  serving — e.g. a developer has their own `pnpm dev` running in
  another terminal — blindly spawning another one crashes the backend
  with `EADDRINUSE` and silently shifts the frontend to a fallback
  port (5174), which then doesn't match `VITE_API_URL` overrides or
  registered kiosk state. The driver's `up` checks `fetch()` against
  both URLs first and reuses whatever's already there instead of
  spawning — do the same in any replacement script.

- **Killing a `pnpm dev` child process doesn't kill the real server.**
  `pnpm dev` runs through an `sh -c` wrapper; calling `.kill()` on that
  immediate child process leaves the actual `tsx`/`vite` node process
  underneath it still running and still bound to the port (confirmed:
  had to manually `kill -9` orphaned processes after the naive
  version). The driver spawns with `detached: true` and kills the
  whole process group (`process.kill(-pid, 'SIGTERM')`) instead.

- **`packages/frontend/.env` points `VITE_API_URL` at a LAN IP**
  (for real kiosk hardware on-site), not `localhost`. The driver
  overrides `VITE_API_URL=http://localhost:3005` when it spawns the
  frontend itself — but if you instead reuse an already-running
  frontend (see idempotent `up` above), that already-running instance
  is using whatever `VITE_API_URL` it started with, not the override.

- **A fresh page has no session credentials.** `create()` in
  `src/api/session.ts` POSTs to `/api/session` with a `kioskKey` from
  `localStorage`, validated against a real `Kiosk` DB row — without
  `register-kiosk` first, clicking "Checka in" gets a silent 401 and
  nothing visibly happens.

## Troubleshooting

- **`click-text` returns `NOT_FOUND`**: the button's visible text
  doesn't exactly match and doesn't substring-match either — check
  `text` (no selector) to see the current `innerText` and adjust.
- **`wait-text` times out on `Gå tillbaka` after `click-text Checka in`
  reported `OK`**: `register-kiosk` probably wasn't run first (silent
  401 on session create — the click "succeeds" as a DOM click but
  nothing happens app-side).
- **Backend `EADDRINUSE` on port 3005 right after `up`**: something
  raced ahead of the `isUp()` check, or a previous driver run's server
  wasn't cleanly stopped. `ps aux | grep "tsx --watch"` and manually
  `kill -9` any orphan not started by an active human terminal (check
  `who` / `pstree -p` before killing anything — see the driver's
  `down` comment for why this matters).
