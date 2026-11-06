// Print jobs and their lifecycle (docs/printer-proxy-spec.md). Every
// transition is a compare-and-set on (id, state, leaseId) and is recorded as a
// PrintJobEvent.
import { prisma } from "../../app/prisma.ts";
import { logger } from "../../core/logging/logger.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { dispatch } from "./dispatch.service.ts";

export const JOB_STATES = [
  "queued",
  "leased",
  "sending",
  "printed",
  "unknown",
  "failed",
  "canceled",
] as const;
export type JobState = (typeof JOB_STATES)[number];

const FINISHED_STATES: readonly string[] = [
  "printed",
  "unknown",
  "failed",
  "canceled",
];

/** A job in one of these states will not change again by itself. */
export function isFinishedJobState(state: string): boolean {
  return FINISHED_STATES.includes(state);
}

export type JobFinishedEvent = {
  jobId: string;
  sessionId: string | null;
  state: JobState;
};
type JobFinishedListener = (event: JobFinishedEvent) => void | Promise<void>;

const finishedListeners = new Set<JobFinishedListener>();

/**
 * Registers an in-process listener for jobs reaching a finished state.
 * Returns an unsubscribe function.
 */
export function onJobFinished(listener: JobFinishedListener): () => void {
  finishedListeners.add(listener);
  return () => finishedListeners.delete(listener);
}

async function emitJobFinished(event: JobFinishedEvent) {
  for (const listener of [...finishedListeners]) {
    try {
      await listener(event);
    } catch (err) {
      logger.error({ err, ...event }, "Job finished listener failed");
    }
  }
}

// A lease that isn't begun within this goes back to the queue.
const LEASE_TTL_MS = 15_000;

type Tx = Prisma.TransactionClient;

type Transition = {
  jobId: string;
  from: JobState[];
  to: JobState;
  /** Only if the job still carries this lease. */
  leaseId?: string;
  data?: Prisma.PrintJobUncheckedUpdateManyInput;
  reason?: string;
  actor?: string;
};

/**
 * Moves a job from one of `from` to `to`, if it's still there (and still
 * carries `leaseId`). Returns whether it moved. A stale message changes
 * nothing.
 *
 * Finished listeners (`onJobFinished`) fire after the transaction this call
 * opens has committed. No caller passes `tx` today; if one does, the listeners
 * would fire before the caller's own transaction commits, so a caller that
 * passes `tx` must not rely on listeners seeing the committed state.
 */
export async function transition(t: Transition, tx?: Tx): Promise<boolean> {
  const run = async (db: Tx) => {
    const before = await db.printJob.findFirst({
      where: {
        id: t.jobId,
        state: { in: t.from },
        ...(t.leaseId !== undefined && { leaseId: t.leaseId }),
      },
      select: { state: true, printerId: true, leaseId: true, sessionId: true },
    });
    if (!before) return { moved: false as const };
    const { count } = await db.printJob.updateMany({
      where: {
        id: t.jobId,
        state: before.state,
        leaseId: before.leaseId,
      },
      data: { ...t.data, state: t.to },
    });
    if (count !== 1) return { moved: false as const };
    await db.printJobEvent.create({
      data: {
        jobId: t.jobId,
        from: before.state,
        to: t.to,
        printerId: before.printerId,
        leaseId: before.leaseId,
        reason: t.reason ?? null,
        actor: t.actor ?? null,
      },
    });
    return { moved: true as const, sessionId: before.sessionId };
  };
  const result = tx ? await run(tx) : await prisma.$transaction(run);
  if (!result.moved) return false;
  if (isFinishedJobState(t.to)) {
    await emitJobFinished({
      jobId: t.jobId,
      sessionId: result.sessionId,
      state: t.to,
    });
  }
  return true;
}

/** Back to the queue: proven not written. */
export function requeue(
  jobId: string,
  from: JobState[],
  reason: string,
  leaseId?: string,
  tx?: Tx,
) {
  return transition(
    {
      jobId,
      from,
      to: "queued",
      leaseId,
      reason,
      data: {
        leaseId: null,
        leaseExpiresAt: null,
        printerId: null,
        relayId: null,
      },
    },
    tx,
  );
}

/**
 * Requeues each of these leased jobs, if it still holds the lease we saw.
 * Returns whether any moved.
 */
export async function requeueLeased(
  jobs: { id: string; leaseId: string | null }[],
  reason: string,
) {
  let moved = false;
  for (const job of jobs) {
    if (!job.leaseId) continue;
    if (await requeue(job.id, ["leased"], reason, job.leaseId)) moved = true;
  }
  return moved;
}

type LeasedJob = {
  id: string;
  leaseId: string;
  template: string;
  values: unknown;
};

/**
 * Leases the next job for a printer: jobs targeted at it first, then the
 * oldest in its pool. Never while the printer has a job in flight.
 */
export async function leaseNext(
  printerId: string,
  poolId: string | null,
  relayId: string,
): Promise<LeasedJob | null> {
  return prisma.$transaction(async (tx) => {
    // Timestamps in UTC, like Prisma writes them: the columns have no time
    // zone, and plain now() would be in the session's.
    const rows = await tx.$queryRaw<LeasedJob[]>`
      UPDATE "PrintJob"
      SET state = 'leased', "printerId" = ${printerId}::uuid,
          "relayId" = ${relayId}::uuid,
          "leaseId" = gen_random_uuid(),
          "leaseExpiresAt" = (now() AT TIME ZONE 'utc')
            + ${`${LEASE_TTL_MS} milliseconds`}::interval,
          "leasedAt" = now() AT TIME ZONE 'utc'
      WHERE id = (
        SELECT id FROM "PrintJob"
        WHERE state = 'queued'
          AND ("targetPrinterId" = ${printerId}::uuid
               OR (${poolId}::uuid IS NOT NULL AND "poolId" = ${poolId}::uuid))
        ORDER BY ("targetPrinterId" IS NULL), "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM "PrintJob"
        WHERE "printerId" = ${printerId}::uuid AND state IN ('leased', 'sending')
      )
      RETURNING id, "leaseId", template, "values"`;
    const job = rows[0];
    if (!job) return null;
    await tx.printJobEvent.create({
      data: {
        jobId: job.id,
        from: "queued",
        to: "leased",
        printerId,
        leaseId: job.leaseId,
      },
    });
    return job;
  });
}

/** Leases past their expiry, e.g. after a server restart. */
export async function expiredLeases() {
  return prisma.printJob.findMany({
    where: { state: "leased", leaseExpiresAt: { lt: new Date() } },
    select: { id: true, leaseId: true },
  });
}

export type NewJob = {
  template: string;
  values: Prisma.InputJsonValue;
  source: "step" | "reprint" | "admin";
  createdById?: string;
  sessionId?: string;
  kioskId?: string;
  reprintOfId?: string;
  idempotencyKey?: string;
} & ({ poolId: string } | { targetPrinterId: string });

/** Queues the jobs, then offers them to any printer already waiting. */
export async function createJobs(jobs: NewJob[], actor?: string) {
  const created = await insertJobs(jobs, actor);
  dispatch();
  return created;
}

async function insertJobs(jobs: NewJob[], actor?: string) {
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const job of jobs) {
      const row = await tx.printJob.create({ data: job });
      await tx.printJobEvent.create({
        data: { jobId: row.id, to: "queued", reason: job.source, actor },
      });
      created.push(row);
    }
    return created;
  });
}

export function cancelJob(jobId: string, actor: string) {
  return transition({
    jobId,
    from: ["queued"],
    to: "canceled",
    reason: "canceled by staff",
    actor,
    data: { finishedAt: new Date() },
  });
}

/**
 * Staff settle an `unknown` job: it did print, or it's dismissed.
 * Reprinting is a new job.
 */
export function resolveUnknown(
  jobId: string,
  resolution: "printed" | "dismissed",
  actor: string,
) {
  const [to, reason] =
    resolution === "printed"
      ? (["printed", "marked printed by staff"] as const)
      : (["canceled", "dismissed by staff"] as const);
  return transition({ jobId, from: ["unknown"], to, reason, actor });
}

export async function listJobs(filter: {
  state?: JobState;
  poolId?: string;
  printerId?: string;
  limit?: number;
}) {
  return prisma.printJob.findMany({
    where: {
      state: filter.state,
      poolId: filter.poolId,
      ...(filter.printerId && {
        OR: [
          { printerId: filter.printerId },
          { targetPrinterId: filter.printerId },
        ],
      }),
    },
    // values can hold a whole PNG (the png template); leave it out of lists.
    omit: { values: true },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 100,
  });
}

export async function getJob(id: string) {
  return prisma.printJob
    .findUnique({
      where: { id },
      omit: { values: true },
      include: { events: { orderBy: { at: "asc" } } },
    })
    .catch(() => null);
}
