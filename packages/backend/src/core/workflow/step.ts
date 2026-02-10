import type { StepDefinition } from "../../config/stepConfig.ts";
import { stepRegistry } from "../../domains/workflows/steps.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import { createStepContext } from "./stepContext.ts";

// TODO: I'm unsure if this should live here or in the domains/workflows folder
export async function executeStep(
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

  await step.hooks?.onStepStart?.(ctx);
}
