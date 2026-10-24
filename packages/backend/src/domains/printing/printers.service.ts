// Relays, printers and pools, for admin (docs/printer-proxy-spec.md).
import { prisma } from "../../app/prisma.ts";
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace.ts";
import { isPrinterWaiting } from "./dispatch.service.ts";
import { disconnectRelay, isRelayConnected } from "./relay.socket.ts";

function isNotFound(e: unknown): boolean {
  return (
    e instanceof PrismaClientKnownRequestError &&
    (e.code === "P2025" || e.code === "P2023")
  );
}

/** Runs a single-row update or delete; null if the row doesn't exist. */
async function orNull<T>(op: Promise<T>): Promise<T | null> {
  try {
    return await op;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function listRelays() {
  const relays = await prisma.printRelay.findMany({
    where: { revokedAt: null },
    select: {
      id: true,
      name: true,
      hostname: true,
      version: true,
      lastSeenAt: true,
      createdAt: true,
      printers: { select: { id: true, serial: true, name: true, port: true } },
    },
    orderBy: { name: "asc" },
  });
  return relays.map((r) => ({ ...r, connected: isRelayConnected(r.id) }));
}

export function renameRelay(id: string, name: string) {
  return orNull(
    prisma.printRelay.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    }),
  );
}

/**
 * Revokes a relay's key and drops its connection. The relay then starts
 * enrollment over, so it can be paired again without touching it.
 */
export async function revokeRelay(id: string) {
  const relay = await orNull(
    prisma.printRelay.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true },
    }),
  );
  if (relay) disconnectRelay(id, "revoked");
  return relay;
}

export async function listPrinters() {
  const printers = await prisma.printer.findMany({
    select: {
      id: true,
      serial: true,
      name: true,
      model: true,
      port: true,
      dpi: true,
      widthDots: true,
      lengthDots: true,
      state: true,
      stateDetail: true,
      config: true,
      configAt: true,
      lastSeenAt: true,
      relay: { select: { id: true, name: true } },
      pool: { select: { id: true, name: true } },
    },
    orderBy: [{ relayId: "asc" }, { port: "asc" }, { serial: "asc" }],
  });
  return printers.map((p) => ({
    ...p,
    relay: p.relay && { ...p.relay, connected: isRelayConnected(p.relay.id) },
    waiting: isPrinterWaiting(p.serial),
  }));
}

export function getPrinter(id: string) {
  return orNull(
    prisma.printer.findUniqueOrThrow({
      where: { id },
      select: { id: true, serial: true },
    }),
  );
}

/**
 * Renames a printer or moves it to a pool. A printer moved mid-job finishes
 * that job first: leasing always looks at its current pool.
 */
export function updatePrinter(
  id: string,
  data: { name?: string | null; poolId?: string | null },
) {
  return orNull(
    prisma.printer.update({
      where: { id },
      data,
      select: { id: true, name: true, poolId: true },
    }),
  );
}

export async function listPools() {
  const pools = await prisma.printPool.findMany({
    select: {
      id: true,
      name: true,
      profile: true,
      createdAt: true,
      printers: { select: { id: true, serial: true, name: true, state: true } },
      kiosks: { select: { id: true, name: true } },
      _count: { select: { jobs: { where: { state: "queued" } } } },
    },
    orderBy: { name: "asc" },
  });
  return pools.map(({ _count, ...p }) => ({
    ...p,
    queued: _count.jobs,
    // Stalled: badges waiting and no printer able to take them.
    healthyPrinters: p.printers.filter(
      (pr) => pr.state === "ready" || pr.state === "printing",
    ).length,
  }));
}

export function createPool(data: { name: string; profile?: string | null }) {
  return prisma.printPool.create({ data, select: { id: true, name: true } });
}

export function updatePool(
  id: string,
  data: { name?: string; profile?: string | null },
) {
  return orNull(
    prisma.printPool.update({
      where: { id },
      data,
      select: { id: true, name: true, profile: true },
    }),
  );
}

/**
 * Deletes a pool. Its printers and kiosks become unassigned; refused while it
 * still has queued jobs, which would otherwise be stranded.
 */
export async function deletePool(id: string) {
  const queued = await prisma.printJob.count({
    where: { poolId: id, state: { in: ["queued", "leased", "sending"] } },
  });
  if (queued > 0) return "has_jobs" as const;
  return orNull(
    prisma.printPool.delete({ where: { id }, select: { id: true } }),
  );
}

export function setKioskPool(kioskId: string, poolId: string | null) {
  return orNull(
    prisma.kiosk.update({
      where: { id: kioskId },
      data: { printPoolId: poolId },
      select: { id: true, printPoolId: true },
    }),
  );
}
