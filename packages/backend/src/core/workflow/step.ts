import type { StepDefinition } from "../../config/stepConfig.ts";
import {
  deleteStepData,
  findLastCompletedStep,
  getCurrentStep,
} from "../../domains/workflows/step.service.ts";
import { stepRegistry } from "../../domains/workflows/steps.ts";
import { getLogger } from "../logging/logger.ts";
import {
  clearScreenTracking,
  setStepMeta,
} from "../websocket/sessionRegistry.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import { createStepContext } from "./stepContext.ts";

// TODO: I'm unsure if this should live here or in the domains/workflows
export async function startStep(
  c: TypedContext,
  ws: TypedWSContext<unknown>,
  stepDef: StepDefinition,
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
  });
  clearScreenTracking(sessionId);

  ws.send({ name: "step:started" });
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

  // Walk backwards, skipping steps marked skipOnGoBack.
  const maxSteps = 100;
  for (let i = 0; i < maxSteps; i++) {
    const lastCompleted = await findLastCompletedStep(sessionId);
    if (!lastCompleted) {
      ws.send({ name: "session:terminated" });
      return;
    }

    const step = stepRegistry.get(lastCompleted.def.uses);
    if (!step) {
      throw new Error(
        `Step implementation ${lastCompleted.def.uses} not found`,
      );
    }

    const ctx = createStepContext(c, ws, step);
    await step.hooks?.onStepRollback?.(ctx);
    await deleteStepData(lastCompleted.data.id);

    if (step.skipOnGoBack || lastCompleted.data.autoCompleted) {
      continue;
    }

    const currentStep = await getCurrentStep(sessionId);
    if (!currentStep) {
      getLogger(c).warn("No current step found for session");
      return;
    }
    await startStep(c, ws, currentStep);
    return;
  }
  throw new Error(`goBack exceeded ${maxSteps} steps — possible infinite loop`);
}
