// Relay enrollment: a 4-color code on the Pi's LEDs that staff enter in admin
// (docs/printer-proxy-spec.md).
//
// Pending enrollments live in memory: they're short-lived, and there's one
// backend instance. A restart forgets them; the relay's next poll gets a 404
// and it starts over with new colors.
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "../../app/prisma.ts";
import type { PrinterInfo } from "./protocol.ts";

// The colors that read clearly on the desk LEDs. The relay knows the
// same names; keep them in sync with printer-proxy/internal/desk/leds.go.
export const PAIRING_COLORS = [
  "red",
  "green",
  "yellow",
  "white",
  "pink",
] as const;

// A pending enrollment is dropped this long after its last poll. The relay
// polls every 5 s, so this only has to bridge a Pi reboot or a short network
// drop; an abandoned enrollment shouldn't hold its colors any longer.
const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
// Caps against floods. The pending cap also keeps the 625 color codes
// from running out.
const MAX_PENDING = 20;
const MAX_PER_IP = 10;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function newKey(): string {
  return randomBytes(32).toString("hex");
}

/** Picks a 4-color code that none of the taken ones equals. */
export function pickColors(taken: Set<string>): string[] {
  for (;;) {
    const colors = Array.from(
      { length: 4 },
      () => PAIRING_COLORS[randomInt(PAIRING_COLORS.length)] as string,
    );
    if (!taken.has(colors.join(","))) return colors;
  }
}

type Enrollment = {
  id: string;
  colors: string;
  secretHash: string;
  hostname: string;
  ip: string | null;
  printers: PrinterInfo[];
  createdAt: Date;
  lastPolledAt: number;
  // Set while staff pair it, so two admins entering the same colors at once
  // pair it once.
  pairing: boolean;
  // Set once paired: the relay collects it on its next poll, which ends the
  // enrollment.
  key: string | null;
};

const enrollments = new Map<string, Enrollment>();

// Recent enrollment requests per IP, for rate limiting. In memory: one backend
// instance, and a restart forgetting it is harmless.
const recentByIp = new Map<string, number[]>();

function dropExpired(now = Date.now()) {
  for (const [id, e] of enrollments) {
    if (now - e.lastPolledAt > ENROLLMENT_TTL_MS) enrollments.delete(id);
  }
  // Idle IPs would otherwise stay until they call again.
  for (const [ip, times] of recentByIp) {
    if (times.every((t) => now - t >= PER_IP_WINDOW_MS)) recentByIp.delete(ip);
  }
}

function pending(): Enrollment[] {
  dropExpired();
  return [...enrollments.values()].filter((e) => !e.pairing && !e.key);
}

function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (recentByIp.get(ip) ?? []).filter(
    (t) => now - t < PER_IP_WINDOW_MS,
  );
  if (recent.length >= MAX_PER_IP) {
    recentByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  recentByIp.set(ip, recent);
  return false;
}

type StartedEnrollment = {
  enrollmentId: string;
  secret: string;
  colors: string[];
};

export function startEnrollment(input: {
  hostname: string;
  printers: PrinterInfo[];
  ip: string | null;
}): StartedEnrollment | "rate_limited" {
  if (input.ip && rateLimited(input.ip)) return "rate_limited";
  const taken = pending();
  if (taken.length >= MAX_PENDING) return "rate_limited";

  const colors = pickColors(new Set(taken.map((e) => e.colors)));
  const secret = newKey();
  const e: Enrollment = {
    id: randomUUID(),
    colors: colors.join(","),
    secretHash: hashSecret(secret),
    hostname: input.hostname,
    ip: input.ip,
    printers: input.printers,
    createdAt: new Date(),
    lastPolledAt: Date.now(),
    pairing: false,
    key: null,
  };
  enrollments.set(e.id, e);
  return { enrollmentId: e.id, secret, colors };
}

type PollResult =
  | { status: "pending" }
  | { status: "paired"; key: string }
  | "not_found"
  | "unauthorized";

/** The relay polling its enrollment. */
export function pollEnrollment(id: string, secret: string): PollResult {
  dropExpired();
  const e = enrollments.get(id);
  if (!e) return "not_found";
  const given = Buffer.from(hashSecret(secret), "hex");
  if (!timingSafeEqual(given, Buffer.from(e.secretHash, "hex"))) {
    return "unauthorized";
  }
  if (e.key) {
    // Collected: the enrollment is done with, and the key is only kept as
    // its hash from now on.
    enrollments.delete(id);
    return { status: "paired", key: e.key };
  }
  e.lastPolledAt = Date.now();
  return { status: "pending" };
}

/** What admin enters: the colors in LED order. */
function findPending(colors: string[]): Enrollment | undefined {
  const want = colors.join(",");
  return pending().find((e) => e.colors === want);
}

/**
 * Looks up a pending enrollment by its colors, for admin to confirm before
 * pairing. Shows what the relay reported, never the colors themselves.
 */
export function lookupEnrollment(colors: string[]) {
  const e = findPending(colors);
  if (!e) return null;
  return {
    hostname: e.hostname,
    ip: e.ip,
    printers: e.printers,
    createdAt: e.createdAt,
  };
}

/** Pairs the enrollment matching the colors: creates the relay and its key. */
export async function pairEnrollment(colors: string[], name: string) {
  const e = findPending(colors);
  if (!e) return null;
  e.pairing = true;
  try {
    const key = newKey();
    const relay = await prisma.printRelay.create({
      data: { name, hostname: e.hostname, keyHash: hashSecret(key) },
    });
    e.key = key;
    return { id: relay.id, name: relay.name, hostname: relay.hostname };
  } finally {
    e.pairing = false;
  }
}

/** Pending enrollments, for spotting a flood. No colors. */
export function listPendingEnrollments() {
  return pending()
    .map((e) => ({
      hostname: e.hostname,
      ip: e.ip,
      createdAt: e.createdAt,
      lastPolledAt: new Date(e.lastPolledAt),
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
