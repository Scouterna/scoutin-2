import { prisma } from "../../app/prisma.ts";
import type { StepDefinition } from "../../config/stepConfig.ts";
import {
  deleteStepData,
  findLastCompletedStep,
  getCurrentStep,
} from "../../domains/workflows/step.service.ts";
import { stepRegistry } from "../../domains/workflows/steps.ts";
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
  c.set("stepMeta", {
    idInFlow: stepDef.id,
    evaluatedInputs: stepDef.with,
  });

  await ws.send({ name: "stepStarted" });
  await step.hooks?.onStepStart?.(ctx);
}

export async function goBack(
  c: TypedContext,
  ws: TypedWSContext<unknown>,
): Promise<void> {
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }

  const session = await prisma.checkinSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new Error("Session not found");
  }

  const lastCompleted = await findLastCompletedStep(session);
  if (!lastCompleted) {
    throw new Error("No completed steps to go back to");
  }

  const step = stepRegistry.get(lastCompleted.def.uses);
  if (!step) {
    throw new Error(`Step implementation ${lastCompleted.def.uses} not found`);
  }

  const ctx = createStepContext(c, ws, step);
  await step.hooks?.onStepRollback?.(ctx);
  await deleteStepData(lastCompleted.data.id);

  const updatedSession = await prisma.checkinSession.findUnique({
    where: { id: sessionId },
  });
  if (!updatedSession) {
    throw new Error("Session not found after rollback");
  }

  const currentStep = await getCurrentStep(updatedSession);
  await startStep(c, ws, currentStep);
}
