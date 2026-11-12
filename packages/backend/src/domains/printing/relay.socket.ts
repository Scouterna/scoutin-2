// The print relay WebSocket, /ws/print-relay (docs/printer-proxy-spec.md):
// one connection per paired relay. Handles what the relays report (printers,
// their states, job progress and results) and sends them maintenance actions.
// Handing jobs to ready printers is dispatch.service.ts.
//
// What's here in memory is only who is connected. That assumes a single
// backend instance.
import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import { logger } from "../../core/logging/logger.ts";
import type { AppEnv, UpgradeWebSocket } from "../../core/websocket/types.ts";
import {
  dispatch,
  forgetRelay,
  printerReady,
  type RelayLink,
  withdraw,
} from "./dispatch.service.ts";
import { hashSecret } from "./enrollment.service.ts";
import { requeue, requeueLeased, transition } from "./jobs.service.ts";
import {
  type PrinterActionKind,
  type PrinterActionResult,
  type PrinterInfo,
  type RelayActionKind,
  type RelayActionResult,
  type RelayMessage,
  type RelayMessageName,
  relayMessages,
  type ServerMessage,
} from "./protocol.ts";

const log = logger.child({ module: "print-relay" });

// The relay pings every 10 s; a connection silent for this long is
// dead (half-open TCP) and is dropped.
const DEAD_AFTER_MS = 45_000;
const CHECK_INTERVAL_MS = 5_000;
const ACTION_TIMEOUT_MS = 2 * 60_000;

type Conn = RelayLink & {
  ws: WSContext;
  epoch: number;
  welcomed: boolean;
  lastSeen: number;
  // Messages from one relay are handled strictly in order: a release after a
  // lost beginAck must see the job:begin before it.
  queue: Promise<void>;
};

/** Relay id → its live connection. */
const conns = new Map<string, Conn>();
/** Printer serial → the connection reporting it. */
const owner = new Map<string, Conn>();

// Epochs keep increasing across server restarts.
let lastEpoch = Date.now();

// Action ids are UUIDs, so printer and relay actions share one map.
const pendingActions = new Map<string, (res: never) => void>();

/** A maintenance action couldn't be run: not connected, or no answer. */
export class RelayActionError extends Error {}

function sendTo(conn: Conn, msg: ServerMessage) {
  if (conn.closed) return;
  try {
    conn.ws.send(JSON.stringify(msg));
  } catch (err) {
    conn.log.warn({ err, msg: msg.name }, "Failed to send to relay");
  }
}

// ── Route ───────────────────────────────────────────────────────────────────

export function printRelaySocket(upgradeWebSocket: UpgradeWebSocket) {
  return new Hono<AppEnv>().get(
    "/",
    // The key is checked before the upgrade, so a rejected relay gets a plain
    // 401 and starts enrollment over.
    async (c, next) => {
      const relayId = await authenticateRelay(c.req.header("authorization"));
      if (!relayId) return c.text("relay key rejected", 401);
      c.set("printRelayId", relayId);
      await next();
    },
    upgradeWebSocket((c) => {
      const relayId = c.get("printRelayId");
      if (!relayId) throw new Error("print relay upgrade without a relay");
      let conn: Conn | undefined;
      return {
        onOpen(_evt, ws) {
          conn = openConnection(relayId, ws);
        },
        onMessage(evt) {
          if (conn) receive(conn, evt.data);
        },
        onClose() {
          if (conn) closeConnection(conn);
        },
      };
    }),
  );
}

// ── Connection ──────────────────────────────────────────────────────────────

/** The relay a bearer key belongs to, or null (→ 401). */
async function authenticateRelay(
  authorization: string | undefined,
): Promise<string | null> {
  const key = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!key) return null;
  const relay = await prisma.printRelay.findUnique({
    where: { keyHash: hashSecret(key) },
    select: { id: true, revokedAt: true },
  });
  return relay && !relay.revokedAt ? relay.id : null;
}

function openConnection(relayId: string, ws: WSContext): Conn {
  const conn: Conn = {
    relayId,
    ws,
    log: log.child({ relayId }),
    epoch: 0,
    welcomed: false,
    closed: false,
    lastSeen: Date.now(),
    queue: Promise.resolve(),
    send: (msg) => sendTo(conn, msg),
  };
  // The relay's pings count as signs of life (the ws library answers them).
  const raw = ws.raw as { on?: (e: string, f: () => void) => void };
  raw.on?.("ping", () => {
    conn.lastSeen = Date.now();
  });
  conn.log.info("Relay connected");
  return conn;
}

const parseEnvelope = type("string.json.parse").to({
  name: "string",
  "data?": "unknown",
});

function receive(conn: Conn, raw: unknown) {
  conn.lastSeen = Date.now();
  const env = parseEnvelope(raw);
  if (env instanceof type.errors) {
    conn.log.warn({ issues: env.summary }, "Unparsable relay message");
    return;
  }
  const name = env.name as RelayMessageName;
  if (!Object.hasOwn(relayMessages, name)) {
    conn.log.warn({ name: env.name }, "Unknown relay message");
    return;
  }
  const data = relayMessages[name](env.data);
  if (data instanceof type.errors) {
    conn.log.warn({ name, issues: data.summary }, "Invalid relay message");
    return;
  }
  if (!conn.welcomed && name !== "hello") {
    conn.log.warn({ name }, "Relay message before hello; ignored");
    return;
  }
  enqueue(conn, () => handlers[name](conn, data as never));
}

function enqueue(conn: Conn, fn: () => Promise<void>) {
  conn.queue = conn.queue.then(fn).catch((err) => {
    conn.log.error({ err }, "Error handling relay message");
  });
}

function closeConnection(conn: Conn) {
  if (conn.closed) return;
  conn.closed = true;
  enqueue(conn, () => dropConnection(conn));
}

/**
 * A relay's connection ended: its leased jobs go back to the queue, jobs in
 * sending stay until it says what happened.
 */
async function dropConnection(conn: Conn) {
  for (const [serial, c] of owner) {
    if (c === conn) owner.delete(serial);
  }
  forgetRelay(conn);
  // A newer connection of the same relay has taken over (and reconciled).
  if (conns.get(conn.relayId) !== conn) {
    conn.log.info("Superseded relay connection closed");
    return;
  }
  conns.delete(conn.relayId);
  conn.log.info("Relay disconnected");

  const leased = await prisma.printJob.findMany({
    where: { state: "leased", relayId: conn.relayId },
    select: { id: true, leaseId: true },
  });
  const requeued = await requeueLeased(leased, "relay disconnected");
  await prisma.printer.updateMany({
    where: { relayId: conn.relayId },
    data: { state: "offline", stateDetail: null },
  });
  if (requeued) dispatch();
}

// ── Handlers ────────────────────────────────────────────────────────────────

type Handlers = {
  [N in RelayMessageName]: (conn: Conn, data: RelayMessage<N>) => Promise<void>;
};

const handlers: Handlers = {
  async hello(conn, h) {
    const previous = conns.get(conn.relayId);
    if (previous && previous !== conn) {
      // A new connection supersedes the old one, e.g. a half-open TCP
      // connection the relay already gave up on.
      previous.ws.close(4000, "superseded");
      previous.closed = true;
      enqueue(previous, () => dropConnection(previous));
    }
    conns.set(conn.relayId, conn);

    await prisma.printRelay.update({
      where: { id: conn.relayId },
      data: {
        version: h.version,
        hostname: h.hostname,
        lastSeenAt: new Date(),
      },
    });
    const expected = config.PRINT_RELAY_VERSION;
    if (expected && h.version !== expected) {
      conn.log.warn(
        { version: h.version, expected },
        "Relay runs another version than this server expects; it updates on its next restart",
      );
    }

    await Promise.all(h.printers.map((p) => attach(conn, p)));

    await reconcile(conn, h.journal);

    conn.welcomed = true;
    conn.epoch = ++lastEpoch;
    conn.send({
      name: "welcome",
      data: { relayId: conn.relayId, epoch: conn.epoch },
    });
    conn.log.info(
      {
        hostname: h.hostname,
        version: h.version,
        printers: h.printers.length,
        journal: h.journal.length,
      },
      "Relay welcomed",
    );
  },

  async "printer:attached"(conn, p) {
    await attach(conn, p);
  },

  async "printer:detached"(conn, { serial }) {
    if (owner.get(serial) === conn) owner.delete(serial);
    withdraw(serial, conn);
    await prisma.printer.updateMany({
      where: { serial, relayId: conn.relayId },
      data: { state: "offline", stateDetail: null, lastSeenAt: new Date() },
    });
  },

  async "printer:status"(conn, st) {
    owner.set(st.serial, conn);
    // Any status but ready withdraws a pending printer:ready.
    if (st.state !== "ready") withdraw(st.serial, conn);
    const seq = BigInt(st.seq);
    const base = {
      relayId: conn.relayId,
      state: st.state,
      stateDetail: st.detail ?? null,
      stateSeq: seq,
      lastSeenAt: new Date(),
    };
    const { count } = await prisma.printer.updateMany({
      where: { serial: st.serial, stateSeq: { lt: seq } },
      data: {
        ...base,
        ...(st.dpi && { dpi: st.dpi }),
        ...(st.widthDots && { widthDots: st.widthDots }),
        ...(st.lengthDots && { lengthDots: st.lengthDots }),
      },
    });
    if (count === 0) {
      // First sight of this printer, or an out-of-order status.
      await prisma.printer.upsert({
        where: { serial: st.serial },
        create: { serial: st.serial, ...base },
        update: {},
      });
    }
  },

  async "printer:ready"(conn, { serial }) {
    owner.set(serial, conn);
    await printerReady(serial, conn);
  },

  async "job:begin"(conn, b) {
    // Idempotent: leased with this lease → sending; already sending
    // with this lease → ok as well.
    let ok = await transition({
      jobId: b.jobId,
      from: ["leased"],
      to: "sending",
      leaseId: b.leaseId,
      data: { sendingAt: new Date() },
    }).catch(() => false); // e.g. a malformed id: just not ok
    if (!ok) {
      const job = await prisma.printJob
        .findUnique({
          where: { id: b.jobId },
          select: { state: true, leaseId: true },
        })
        .catch(() => null);
      ok = job?.state === "sending" && job.leaseId === b.leaseId;
    }
    conn.send({
      name: "job:beginAck",
      data: { jobId: b.jobId, leaseId: b.leaseId, ok },
    });
  },

  async "job:release"(conn, rel) {
    // A release is the relay's word that nothing was written, so it's
    // accepted in sending too: the beginAck never arrived.
    const moved = await requeue(
      rel.jobId,
      ["leased", "sending"],
      `released: ${rel.reason}`,
      rel.leaseId,
    ).catch(() => false);
    if (moved) {
      conn.log.info({ jobId: rel.jobId, reason: rel.reason }, "Job released");
      dispatch();
    }
  },

  async "job:result"(conn, res) {
    await applyResult(conn, res).catch((err) => {
      conn.log.error({ err, jobId: res.jobId }, "Failed to apply job result");
    });
    // Always acked, even when stale: it only means "you may forget this".
    conn.send({
      name: "job:resultAck",
      data: { jobId: res.jobId, leaseId: res.leaseId },
    });
  },

  async "printer:config"(conn, c) {
    await prisma.printer.updateMany({
      where: { serial: c.serial },
      data: { config: c.settings, configAt: new Date(), relayId: conn.relayId },
    });
  },

  async "printer:actionResult"(_conn, res) {
    settleAction(res);
  },

  async "relay:actionResult"(_conn, res) {
    settleAction(res);
  },
};

function settleAction(res: { actionId: string }) {
  const settle = pendingActions.get(res.actionId);
  pendingActions.delete(res.actionId);
  (settle as ((r: typeof res) => void) | undefined)?.(res);
}

async function attach(conn: Conn, p: PrinterInfo) {
  owner.set(p.serial, conn);
  const data = {
    relayId: conn.relayId,
    model: p.product || null,
    port: p.port || null,
    lastSeenAt: new Date(),
  };
  await prisma.printer.upsert({
    where: { serial: p.serial },
    create: { serial: p.serial, ...data },
    update: data,
  });
}

/**
 * Settles every job this relay's printers had in flight, before the relay may
 * do anything else.
 */
async function reconcile(
  conn: Conn,
  journal: RelayMessage<"hello">["journal"],
) {
  const entries = new Map(journal.map((e) => [e.jobId, e]));
  const jobs = await prisma.printJob.findMany({
    where: { state: { in: ["leased", "sending"] }, relayId: conn.relayId },
    select: { id: true, state: true, leaseId: true },
  });
  await requeueLeased(
    jobs.filter((j) => j.state === "leased"),
    "relay reconnected",
  );
  for (const job of jobs) {
    if (!job.leaseId || job.state !== "sending") continue;
    const e = entries.get(job.id);
    if (!e || e.leaseId !== job.leaseId) {
      await requeue(
        job.id,
        ["sending"],
        "never written (not in the relay's journal)",
        job.leaseId,
      );
    } else if (e.phase === "result" && e.outcome) {
      await applyResult(conn, {
        jobId: job.id,
        leaseId: e.leaseId,
        outcome: e.outcome,
        reason: "from the relay's journal",
      });
    }
    // Intent only: the relay settles it from the label counter once the
    // printer is back, and sends job:result.
  }
  if (jobs.length > 0) {
    conn.log.info({ jobs: jobs.length }, "Reconciled in-flight jobs");
  }
}

async function applyResult(conn: Conn, res: RelayMessage<"job:result">) {
  const from: ("sending" | "leased")[] = ["sending", "leased"];
  if (res.outcome === "not_sent") {
    if (
      await requeue(
        res.jobId,
        from,
        `not sent: ${res.reason ?? ""}`.trim(),
        res.leaseId,
      )
    ) {
      dispatch();
    }
    return;
  }
  const outcome =
    res.outcome === "printed" || res.outcome === "failed"
      ? res.outcome
      : "unknown";
  const moved = await transition({
    jobId: res.jobId,
    from,
    to: outcome,
    leaseId: res.leaseId,
    reason: res.reason,
    data: {
      finishedAt: new Date(),
      failureReason: outcome === "printed" ? null : (res.reason ?? outcome),
    },
  });
  if (moved) {
    conn.log.info(
      { jobId: res.jobId, outcome, reason: res.reason },
      "Job finished",
    );
  }
}

// ── Housekeeping ────────────────────────────────────────────────────────────

let checker: NodeJS.Timeout | undefined;

/**
 * Marks every printer offline, then starts dropping connections that went
 * silent. Printer states are only true while their relay is connected, and no
 * relay is connected yet at startup: a state left over from before a restart
 * or crash would otherwise stay forever. Relays report fresh states when they
 * reconnect. Run before the server accepts connections.
 */
export async function startRelaySockets() {
  await prisma.printer.updateMany({
    data: { state: "offline", stateDetail: null },
  });
  checker ??= setInterval(dropSilent, CHECK_INTERVAL_MS);
}

export function stopRelaySockets() {
  clearInterval(checker);
  checker = undefined;
  for (const conn of conns.values())
    conn.ws.close(1001, "server shutting down");
}

function dropSilent() {
  const now = Date.now();
  for (const conn of conns.values()) {
    if (now - conn.lastSeen > DEAD_AFTER_MS) {
      conn.log.warn("Relay silent too long; dropping the connection");
      (conn.ws.raw as { terminate?: () => void }).terminate?.();
      closeConnection(conn);
    }
  }
}

// ── For admin ───────────────────────────────────────────────────────────────

export function isRelayConnected(relayId: string): boolean {
  return conns.get(relayId)?.welcomed ?? false;
}

/** Drops a relay's connection, e.g. after revoking its key. */
export function disconnectRelay(relayId: string, reason: string) {
  const conn = conns.get(relayId);
  if (!conn) return;
  conn.ws.close(4001, reason);
  closeConnection(conn);
}

/** Runs a maintenance action on a printer and waits for the result. */
export function printerAction(
  serial: string,
  kind: PrinterActionKind,
  settings?: Record<string, string>,
): Promise<PrinterActionResult> {
  return request(owner.get(serial), "printer is not connected", (actionId) => ({
    name: "printer:action",
    data: { actionId, serial, kind, ...(settings && { settings }) },
  }));
}

/** Reboots or powers off a relay. Resolves on its first answer. */
export function relayAction(
  relayId: string,
  kind: RelayActionKind,
): Promise<RelayActionResult> {
  return request(conns.get(relayId), "relay is not connected", (actionId) => ({
    name: "relay:action",
    data: { actionId, kind },
  }));
}

/** Sends an action message and waits for its answer, or a timeout. */
function request<T>(
  conn: Conn | undefined,
  notConnected: string,
  build: (actionId: string) => Parameters<Conn["send"]>[0],
): Promise<T> {
  if (!conn || conn.closed || !conn.welcomed) {
    return Promise.reject(new RelayActionError(notConnected));
  }
  const actionId = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingActions.delete(actionId);
      reject(new RelayActionError("no answer from the relay"));
    }, ACTION_TIMEOUT_MS);
    pendingActions.set(actionId, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
    conn.send(build(actionId));
  });
}
