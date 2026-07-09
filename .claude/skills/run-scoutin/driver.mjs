// REPL driver for the scoutin-2 kiosk check-in app (backend + frontend +
// Postgres). Drives a real headless Chromium against the actual dev
// servers — this is not a test-suite runner, it's a hands-on driver.
//
// Usage: node .claude/skills/run-scoutin/driver.mjs
// Then type commands at the `driver>` prompt (see SKILL.md for the list),
// or wrap in tmux and `send-keys` them from an agent.
//
// All paths below are relative to the repo root (three levels up from
// this file: .claude/skills/run-scoutin/driver.mjs -> repo root).

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_DIR = path.join(REPO_ROOT, "packages/backend");
const FRONTEND_DIR = path.join(REPO_ROOT, "packages/frontend");

const BACKEND_URL = "http://localhost:3005"; // packages/backend/.env PORT=3005
const FRONTEND_URL = "http://localhost:5173";

const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/scoutin-shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

let backendProc = null;
let frontendProc = null;
let browser = null;
let page = null;
let registeredKioskId = null;

async function isUp(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

function waitForPort(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (await isUp(url)) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${url}`));
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

// `pnpm dev` runs through an `sh -c` wrapper; killing that wrapper process
// does NOT kill the real tsx/vite process underneath it (confirmed while
// building this driver — `proc.kill()` left orphaned node processes still
// bound to the port). Spawn detached into its own process group so `down`
// can kill the whole group instead.
function spawnDevServer(cwd, extraEnv) {
  const proc = spawn("pnpm", ["dev"], {
    cwd,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, ...extraEnv },
  });
  return proc;
}

function killDevServer(proc) {
  if (!proc || proc.killed) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // Group already gone.
  }
}

const COMMANDS = {
  // --- lifecycle -----------------------------------------------------
  // Idempotent: if the backend/frontend are already serving (e.g. a human
  // developer already has `pnpm dev` running in another terminal), reuses
  // them instead of spawning a duplicate — a duplicate backend on the same
  // port crashes with EADDRINUSE, confirmed while building this driver.
  async up() {
    console.log("starting postgres (docker-compose up -d)...");
    await new Promise((resolve) => {
      const p = spawn("docker-compose", ["up", "-d"], { cwd: REPO_ROOT, stdio: "inherit" });
      p.on("exit", resolve);
    });

    if (await isUp(BACKEND_URL)) {
      console.log("backend already running:", BACKEND_URL);
    } else {
      console.log("starting backend (pnpm dev)...");
      backendProc = spawnDevServer(BACKEND_DIR);
      backendProc.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
      backendProc.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
      await waitForPort(BACKEND_URL, 30_000);
      console.log("backend ready:", BACKEND_URL);
    }

    if (await isUp(FRONTEND_URL)) {
      console.log("frontend already running:", FRONTEND_URL);
    } else {
      console.log("starting frontend (pnpm dev)...");
      // The committed packages/frontend/.env points VITE_API_URL at a LAN IP
      // for real kiosk hardware. Override it here so the driver talks to the
      // backend that's actually running in this container.
      frontendProc = spawnDevServer(FRONTEND_DIR, { VITE_API_URL: BACKEND_URL });
      frontendProc.stdout.on("data", (d) => process.stdout.write(`[frontend] ${d}`));
      frontendProc.stderr.on("data", (d) => process.stderr.write(`[frontend] ${d}`));
      await waitForPort(FRONTEND_URL, 30_000);
      console.log("frontend ready:", FRONTEND_URL);
    }
  },

  async launch() {
    if (browser) return console.log("already launched");
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));
    console.log("browser launched");
  },

  // Only stops servers THIS driver spawned (backendProc/frontendProc are
  // null if `up` found them already running) — never touches a server a
  // human developer started themselves.
  async down() {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
    if (frontendProc) {
      killDevServer(frontendProc);
      frontendProc = null;
    }
    if (backendProc) {
      killDevServer(backendProc);
      backendProc = null;
    }
    console.log("stopped browser + any servers this driver spawned (postgres left running — stop with `docker-compose down` if needed)");
  },

  // --- kiosk-specific setup -------------------------------------------
  // A fresh session (`create()` in src/api/session.ts) requires a
  // `kioskKey` in localStorage that validates against a real Kiosk row.
  // This drives the exact same admin setup-token -> activate flow a real
  // kiosk device goes through, then stores the resulting key.
  async "register-kiosk"() {
    if (!page) return console.log("ERROR: launch first");
    const setupRes = await fetch(`${BACKEND_URL}/api/admin/kiosks`, { method: "POST" });
    const { code } = await setupRes.json();
    const activateRes = await fetch(`${BACKEND_URL}/api/kiosk/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "driver-kiosk" }),
    });
    const activated = await activateRes.json();
    if (!activated.key) return console.log("ERROR: activation failed", activated);

    registeredKioskId = activated.kioskId;
    await page.goto(FRONTEND_URL);
    await page.evaluate((key) => localStorage.setItem("kioskKey", key), activated.key);
    await page.reload();
    console.log("kiosk registered + key stored, kioskId:", registeredKioskId);
  },

  async "unregister-kiosk"() {
    if (!registeredKioskId) return console.log("no kiosk registered this session");
    await fetch(`${BACKEND_URL}/api/admin/kiosks/${registeredKioskId}`, { method: "DELETE" });
    console.log("deleted kiosk", registeredKioskId);
    registeredKioskId = null;
  },

  // --- navigation / inspection -----------------------------------------
  async nav(url) {
    if (!page) return console.log("ERROR: launch first");
    await page.goto(url || FRONTEND_URL);
    console.log("navigated to", page.url());
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`);
    await page.screenshot({ path: f });
    console.log("screenshot:", f);
  },

  // GOTCHA: @scouterna/ui-react's <scout-button> renders a real light-DOM
  // <button> inside itself (no shadow root), but Playwright's `text=`
  // locator resolves to the outer <scout-button> host element, whose own
  // click() is a no-op — the internal click handler is bound to the inner
  // <button>. Search for real interactive elements instead of using
  // Playwright locators.
  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll("button, a, [role='button']")];
      const el =
        els.find((e) => e.textContent?.trim() === t) ??
        els.find((e) => e.textContent?.includes(t));
      if (!el) return "NOT_FOUND";
      el.click();
      return `OK: ${el.tagName}`;
    }, text);
    console.log("click-text", JSON.stringify(text), "->", r);
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 });
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log("found:", sel);
    } catch {
      console.log("TIMEOUT:", sel);
    }
  },

  // Wait for text anywhere in the page body (step screens are plugin
  // components without stable selectors — matching visible text is more
  // reliable than guessing a CSS selector).
  async "wait-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForFunction((t) => document.body.innerText.includes(t), text, {
        timeout: 15_000,
      });
      console.log("found text:", text);
    } catch {
      console.log("TIMEOUT waiting for text:", text);
    }
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)",
        sel || null,
      ),
    );
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async quit() {
    await COMMANDS.down();
    process.exit(0);
  },
  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "driver> " });

rl.on("line", async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unknown:", cmd, "— try: help");
    return rl.prompt();
  }
  try {
    await fn(rest.join(" "));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
  if (cmd === "quit") {
    rl.close();
    return;
  }
  rl.prompt();
});
rl.on("close", async () => {
  process.exit(0);
});

console.log("scoutin-2 driver — \"help\" for commands, \"up\" then \"launch\" to start");
rl.prompt();
