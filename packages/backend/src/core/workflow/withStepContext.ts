import type { StepMethodContext } from "@scouterna/scoutin-plugin-api/backend";
import { prisma } from "../../app/prisma.ts";
import { getCurrentStep } from "../../domains/workflows/step.service.ts";
import { stepRegistry } from "../../domains/workflows/steps.ts";
import { logger } from "../logging/logger.ts";
import {
  createBroadcastWs,
  getConnectionCount,
} from "../websocket/sessionRegistry.ts";
import type { TypedContext } from "../websocket/types.ts";
import { createStepContext } from "./stepContext.ts";

// One chain per session: two job events for the same session must not both
// act on the same step.
const queues = new Map<string, Promise<unknown>>();

function runExclusive<T>(
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(sessionId, next);
  const cleanup = () => {
    if (queues.get(sessionId) === next) queues.delete(sessionId);
  };
  next.then(cleanup, cleanup);
  return next;
}

/** A Map-backed stand-in for the request context, enough for a step context. */
function standInContext(sessionId: string): TypedContext {
  const vars = new Map<string, unknown>([
    ["wsSessionId", sessionId],
    ["logger", logger.child({ sessionId })],
  ]);
  return {
    get: (key: string) => vars.get(key),
    set: (key: string, value: unknown) => {
      vars.set(key, value);
    },
  } as unknown as TypedContext;
}

/**
 * Runs `fn` with a step context for a session, from outside a request (e.g. a
 * print job event). Does nothing and returns false unless a kiosk is
 * connected, the session is still running, and its current step is
 * `expectedStepId` (the step's `id`, or its `uses` without one). Calls for the
 * same session run one at a time and re-check the step when their turn comes.
 */
export function withStepContext(
  sessionId: string,
  expectedStepId: string,
  fn: (ctx: StepMethodContext) => void | Promise<void>,
): Promise<boolean> {
  return runExclusive(sessionId, async () => {
    if (getConnectionCount(sessionId) === 0) return false;

    const runningSession = await prisma.checkinSession.findFirst({
      where: { id: sessionId, completedAt: null, abortedAt: null },
      select: { id: true },
    });
    if (!runningSession) return false;

    const currentStep = await getCurrentStep(sessionId);
    if (
      !currentStep ||
      (currentStep.id ?? currentStep.uses) !== expectedStepId
    ) {
      return false;
    }

    const impl = stepRegistry.get(currentStep.uses);
    if (!impl) {
      throw new Error(`Step implementation ${currentStep.uses} not found`);
    }

    const ctx = createStepContext(
      standInContext(sessionId),
      createBroadcastWs(sessionId) as never,
      impl,
    );
    await fn(ctx);
    return true;
  });
}
