import { prisma } from "../../app/prisma.ts";
import {
  type CompletedStep,
  deleteStepData,
  getCurrentStep,
  listCompletedSteps,
  type ResolvedStepDefinition,
} from "../../domains/workflows/step.service.ts";
import { stepRegistry } from "../../domains/workflows/steps.ts";
import { getLogger } from "../logging/logger.ts";
import {
  clearNavigationLock,
  clearScreenTracking,
  createBroadcastWs,
  isNavigationLocked,
  setStepMeta,
} from "../websocket/sessionRegistry.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import { createStepContext } from "./stepContext.ts";

type GoBackPlan =
  | {
      allowed: true;
      /** Steps to roll back, nearest first, ending with the target step. */
      steps: CompletedStep[];
      /** Nothing left to land on: the whole session unwinds. */
      terminates: boolean;
    }
  | { allowed: false; barrier: CompletedStep };

/**
 * Works out what a goBack would roll back without touching anything. Rolling
 * back as we walk would leave the session half-unwound when a barrier turns up
 * behind skipOnGoBack steps, so the decision is made up front.
 */
async function planGoBack(sessionId: string): Promise<GoBackPlan> {
  const completed = await listCompletedSteps(sessionId);
  const steps: CompletedStep[] = [];

  for (const entry of [...completed].reverse()) {
    const impl = stepRegistry.get(entry.def.uses);
    if (!impl) {
      throw new Error(`Step implementation ${entry.def.uses} not found`);
    }
    // If we find a step that prevents going back, stop here and prevent going
    // back entirely.
    if (impl.preventGoBack) {
      return { allowed: false, barrier: entry };
    }
    steps.push(entry);
    // If we find a step that should not be skipped, we can go there assuming
    // it's not been auto completed since that would mean the user never
    // interacted with it in the first place.
    if (!impl.skipOnGoBack && !entry.data.autoCompleted) {
      return { allowed: true, steps, terminates: false };
    }
  }
  // We did not find any steps and got to the start. Terminate.
  return { allowed: true, steps, terminates: true };
}

/**
 * Whether a goBack would currently be allowed by barriers. Shares the planner
 * with goBack so the flag sent to clients can't disagree with the action.
 */
export async function canGoBack(sessionId: string): Promise<boolean> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { completedAt: true, abortedAt: true },
  });
  if (session.completedAt || session.abortedAt) return false;
  const { allowed } = await planGoBack(sessionId);
  return allowed;
}

/**
 * The navigation state for a session, derived on demand so it can't go stale.
 * The flag is computed first and the lock read afterwards, so overlapping calls
 * all report the latest lock.
 */
export async function getNavigationState(sessionId: string) {
  const allowed = await canGoBack(sessionId);
  return { canGoBack: allowed, locked: isNavigationLocked(sessionId) };
}

export async function sendNavigationState(sessionId: string): Promise<void> {
  createBroadcastWs(sessionId).send({
    name: "session:navigation",
    data: await getNavigationState(sessionId),
  });
}

// TODO: I'm unsure if this should live here or in the domains/workflows
export async function startStep(
  c: TypedContext,
  ws: TypedWSContext<unknown>,
  stepDef: ResolvedStepDefinition,
) {
  const step = stepRegistry.get(stepDef.uses);

  if (!step) {
    throw new Error(`Step implementation ${stepDef.uses} not found`);
  }

  const ctx = createStepContext(c, ws, step);
  ctx.clearState();

  // Store metadata that will later be written to the database if the step completes.
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }
  setStepMeta(sessionId, {
    idInFlow: stepDef.id,
    evaluatedInputs: stepDef.with,
    language: stepDef.language,
  });
  clearScreenTracking(sessionId);
  // A lock belongs to the step that took it; never carry it into the next one.
  clearNavigationLock(sessionId);

  ws.send({ name: "step:started" });
  await sendNavigationState(sessionId);
  await step.hooks?.onStepStart?.(ctx);
}

export async function restartStep(
  c: TypedContext,
  ws: TypedWSContext<unknown>,
): Promise<void> {
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }

  const currentStep = await getCurrentStep(sessionId);
  if (!currentStep) {
    getLogger(c).warn("No current step found for session");
    return;
  }

  const step = stepRegistry.get(currentStep.uses);
  if (!step) {
    throw new Error(`Step implementation ${currentStep.uses} not found`);
  }

  const ctx = createStepContext(c, ws, step);
  await step.hooks?.onStepRollback?.(ctx);
  await startStep(c, ws, currentStep);
}

export async function goBack(
  c: TypedContext,
  ws: TypedWSContext<unknown>,
): Promise<void> {
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }

  // A finished session is a durable record, not something to unwind: rollback
  // hooks undo real side effects (subject links, check-in timestamps), so
  // walking backwards through one would quietly damage a completed check-in.
  // The kiosk hides its back button once `session:completed` arrives, but
  // `step:goBack` can still be sent directly (see the admin debug panel), so
  // the guard belongs here rather than in the UI. Use undoCheckin to reverse a
  // finished check-in.
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { completedAt: true, abortedAt: true },
  });
  if (session.completedAt || session.abortedAt) {
    getLogger(c).warn(
      { completedAt: session.completedAt, abortedAt: session.abortedAt },
      "Ignoring goBack for a session that is already completed or aborted",
    );
    return;
  }

  const plan = await planGoBack(sessionId);
  if (!plan.allowed) {
    getLogger(c).warn(
      { barrier: plan.barrier.def.id ?? plan.barrier.def.uses },
      "Refusing goBack: a completed step is a barrier",
    );
    await sendNavigationState(sessionId);
    return;
  }

  for (const { def, data } of plan.steps) {
    // biome-ignore lint/style/noNonNullAssertion: planGoBack verified it exists
    const step = stepRegistry.get(def.uses)!;
    const ctx = createStepContext(c, ws, step);
    await step.hooks?.onStepRollback?.(ctx);
    await deleteStepData(data.id);
  }

  if (plan.terminates) {
    ws.send({ name: "session:terminated" });
    return;
  }

  const currentStep = await getCurrentStep(sessionId);
  if (!currentStep) {
    getLogger(c).warn("No current step found for session");
    return;
  }
  await startStep(c, ws, currentStep);
}
