// Hands print jobs to printers (docs/printer-proxy-spec.md). A printer asks
// for a job when it's ready; it gets the next one meant for it, leased and
// rendered, as a job:offer over its relay's connection. A lease that isn't
// begun in time goes back to the queue.
//
// The queue lives in the database; what's here in memory is only which
// printers are waiting for a job. That assumes a single backend instance.

import { prisma } from "../../app/prisma.ts";
import { type Logger, logger } from "../../core/logging/logger.ts";
import {
  expiredLeases,
  leaseNext,
  requeue,
  requeueLeased,
  transition,
} from "./jobs.service.ts";
import type { ServerMessage } from "./protocol.ts";
import { PNG_TEMPLATE, RenderError } from "./render.ts";
import { renderJob } from "./render-job.ts";

const log = logger.child({ module: "print-dispatch" });

const SWEEP_INTERVAL_MS = 5_000;

/** A relay's connection, as far as dispatch needs it. */
export type RelayLink = {
  relayId: string;
  closed: boolean;
  log: Logger;
  send(msg: ServerMessage): void;
};

/** Printer serial → the relay link of a printer that asked for a job. */
const waiting = new Map<string, RelayLink>();
/** Printers being leased to right now, and those to look at again after. */
const leasing = new Set<string>();
const leaseAgain = new Set<string>();

/** A printer is ready for a job: offers it one now, or as soon as one is queued. */
export async function printerReady(serial: string, link: RelayLink) {
  waiting.set(serial, link);
  await kick(serial);
}

/** The printer can't take a job any more (not ready, unplugged). */
export function withdraw(serial: string, link: RelayLink) {
  if (waiting.get(serial) === link) waiting.delete(serial);
}

/** The relay's connection ended: none of its printers is waiting any more. */
export function forgetRelay(link: RelayLink) {
  for (const [serial, l] of waiting) {
    if (l === link) waiting.delete(serial);
  }
}

export function isPrinterWaiting(serial: string): boolean {
  return waiting.has(serial);
}

/** Offers waiting printers a job. Call whenever jobs were queued. */
export function dispatch() {
  for (const serial of waiting.keys()) {
    kick(serial).catch((err) => log.error({ err, serial }, "Lease failed"));
  }
}

/** Leases a job to a waiting printer, if there is one for it. */
async function kick(serial: string) {
  if (leasing.has(serial)) {
    leaseAgain.add(serial);
    return;
  }
  leasing.add(serial);
  try {
    do {
      leaseAgain.delete(serial);
      const link = waiting.get(serial);
      if (!link || link.closed) {
        waiting.delete(serial);
        return;
      }
      if (await offer(serial, link)) {
        if (waiting.get(serial) === link) waiting.delete(serial);
        return;
      }
    } while (leaseAgain.has(serial));
  } finally {
    leasing.delete(serial);
  }
}

async function offer(serial: string, link: RelayLink): Promise<boolean> {
  const printer = await prisma.printer.findUnique({
    where: { serial },
    select: {
      id: true,
      poolId: true,
      relayId: true,
      name: true,
      serial: true,
      dpi: true,
      widthDots: true,
      lengthDots: true,
      pool: { select: { name: true } },
      relay: { select: { name: true } },
    },
  });
  if (!printer || printer.relayId !== link.relayId) return false;

  for (;;) {
    const job = await leaseNext(printer.id, printer.poolId, link.relayId);
    if (!job) return false;

    let image: Awaited<ReturnType<typeof renderJob>>;
    try {
      const { dpi, widthDots, lengthDots } = printer;
      if (
        job.template !== PNG_TEMPLATE &&
        (dpi === null || widthDots === null || lengthDots === null)
      ) {
        // Not the job's fault: the printer hasn't reported its label size
        // yet. It's offered again when the printer next reports in.
        link.log.warn(
          { jobId: job.id, serial },
          "Printer size unknown, job stays queued",
        );
        await requeue(job.id, ["leased"], "printer size unknown", job.leaseId);
        return false;
      }
      image = await renderJob({
        template: job.template,
        values: job.values,
        jobId: job.id,
        printer: {
          name: printer.name ?? printer.serial,
          serial: printer.serial,
          pool: printer.pool?.name ?? "-",
          relay: printer.relay?.name ?? "-",
          dpi: dpi as number,
          widthDots: widthDots as number,
          lengthDots: lengthDots as number,
        },
      });
    } catch (err) {
      // Permanent: a broken template or image fails the job, which is never
      // retried. Then on to the next one.
      const reason = err instanceof RenderError ? err.message : "render error";
      if (!(err instanceof RenderError)) {
        link.log.error({ err, jobId: job.id }, "Unexpected render error");
      }
      await transition({
        jobId: job.id,
        from: ["leased"],
        to: "failed",
        leaseId: job.leaseId,
        reason,
        data: { finishedAt: new Date(), failureReason: reason },
      });
      continue;
    }

    if (link.closed) {
      await requeue(job.id, ["leased"], "relay disconnected", job.leaseId);
      return false;
    }
    link.send({
      name: "job:offer",
      data: {
        jobId: job.id,
        leaseId: job.leaseId,
        serial,
        png: image.png.toString("base64"),
        widthDots: image.width,
        heightDots: image.height,
      },
    });
    link.log.info({ jobId: job.id, serial }, "Job offered");
    return true;
  }
}

// ── Lease expiry ────────────────────────────────────────────────────────────

let sweeper: NodeJS.Timeout | undefined;

export function startDispatch() {
  sweeper ??= setInterval(() => {
    expireLeases().catch((err) => log.error({ err }, "Lease sweep failed"));
  }, SWEEP_INTERVAL_MS);
}

export function stopDispatch() {
  clearInterval(sweeper);
  sweeper = undefined;
}

// A lease never begun goes back to the queue. Swept rather than timed, so it
// also covers leases from before a server restart.
async function expireLeases() {
  if (await requeueLeased(await expiredLeases(), "lease expired")) dispatch();
}
