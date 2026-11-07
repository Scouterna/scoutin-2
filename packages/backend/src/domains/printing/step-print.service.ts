// The print API for step plugins (printer:print): one job per item, safe to
// re-run, and a way to find a step's jobs again.
import { prisma } from "../../app/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { createJobs } from "./jobs.service.ts";

export { isFinishedJobState, onJobFinished } from "./jobs.service.ts";

const keyPrefix = (sessionId: string, stepKey: string) =>
  `${sessionId}:${stepKey}:`;

/**
 * Reads a step job's key back into its parts, or null if it isn't one. The
 * stepKey may contain colons; the sessionId (a UUID) never does.
 */
export function parseStepJobKey(
  idempotencyKey: string | null,
): { sessionId: string; stepKey: string; index: number } | null {
  const match = idempotencyKey?.match(/^([^:]+):(.+):(\d+)$/);
  if (!match) return null;
  const [, sessionId = "", stepKey = "", index = ""] = match;
  return { sessionId, stepKey, index: Number(index) };
}

/**
 * The jobs of one step in one session, ordered by item index. The query only
 * narrows by prefix; the exact step is decided by parsing each key, so a step
 * key that contains colons ("badge:extra") never leaks into the jobs of "badge".
 */
export async function listJobsForStep(sessionId: string, stepKey: string) {
  const jobs = await prisma.printJob.findMany({
    where: { idempotencyKey: { startsWith: keyPrefix(sessionId, stepKey) } },
    omit: { values: true },
  });
  return jobs
    .flatMap((job) => {
      const parsed = parseStepJobKey(job.idempotencyKey);
      return parsed?.sessionId === sessionId && parsed.stepKey === stepKey
        ? [{ job, index: parsed.index }]
        : [];
    })
    .sort((a, b) => a.index - b.index)
    .map(({ job }) => job);
}

/**
 * Creates one job per item for the session's print pool (set when the session
 * was created, so admin sessions without a kiosk can print). Items that
 * already have a job (same session, step and index) are skipped, so running
 * the step again never prints a second badge. Returns all of the step's jobs.
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
    select: { kioskId: true, printPoolId: true },
  });
  const kioskId = session?.kioskId ?? undefined;
  const poolId = session?.printPoolId;
  if (!poolId) return { ok: false, reason: "no-pool" } as const;

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
