// The print API for step plugins (printer:print): one job per item, safe to
// re-run, and a way to find a step's jobs again.
import { prisma } from "../../app/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { createJobs } from "./jobs.service.ts";

export { isTerminalJobState, onJobTerminal } from "./jobs.service.ts";

const keyPrefix = (sessionId: string, stepKey: string) =>
  `${sessionId}:${stepKey}:`;

/**
 * The jobs of one step in one session, ordered by item index. The key format
 * is `<sessionId>:<stepKey>:<index>`; matching the trailing digits keeps a step
 * "badge" from matching the jobs of "badge2".
 */
export async function listJobsForStep(sessionId: string, stepKey: string) {
  const prefix = keyPrefix(sessionId, stepKey);
  const jobs = await prisma.printJob.findMany({
    where: { idempotencyKey: { startsWith: prefix } },
    omit: { values: true },
  });
  const itemIndexFromKey = (key: string | null) => {
    const rest = key?.slice(prefix.length) ?? "";
    return /^\d+$/.test(rest) ? Number(rest) : null;
  };
  return jobs
    .filter((job) => itemIndexFromKey(job.idempotencyKey) !== null)
    .sort(
      (a, b) =>
        (itemIndexFromKey(a.idempotencyKey) ?? 0) -
        (itemIndexFromKey(b.idempotencyKey) ?? 0),
    );
}

/**
 * Creates one job per item for the session's kiosk pool. Items that already
 * have a job (same session, step and index) are skipped, so running the step
 * again never prints a second badge. Returns all of the step's jobs.
 */
export async function createJobsForStep(args: {
  sessionId: string;
  stepKey: string;
  template: string;
  items: Prisma.InputJsonValue[];
}) {
  const { sessionId, stepKey, template, items } = args;
  const session = await prisma.checkinSession.findUnique({
    where: { id: sessionId },
    select: { kioskId: true, kiosk: { select: { printPoolId: true } } },
  });
  const kioskId = session?.kioskId;
  const poolId = session?.kiosk?.printPoolId;
  if (!kioskId || !poolId) return { ok: false, reason: "no-pool" } as const;

  const existing = await listJobsForStep(sessionId, stepKey);
  const taken = new Set(existing.map((job) => job.idempotencyKey));
  const prefix = keyPrefix(sessionId, stepKey);
  const fresh = items.flatMap((item, index) =>
    taken.has(`${prefix}${index}`)
      ? []
      : [
          {
            template,
            values: item,
            source: "step" as const,
            poolId,
            sessionId,
            kioskId,
            idempotencyKey: `${prefix}${index}`,
          },
        ],
  );
  if (fresh.length > 0) {
    await createJobs(fresh);
  }

  return {
    ok: true,
    jobs: await listJobsForStep(sessionId, stepKey),
  } as const;
}
