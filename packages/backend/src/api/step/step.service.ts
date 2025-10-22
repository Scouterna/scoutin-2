import { readFile } from "node:fs/promises";
import { type } from "arktype";
import type {
  CheckinSessionModel,
  CheckinSessionStepDataModel,
} from "../../generated/prisma/models.ts";
import { prisma } from "../../prisma.ts";
import {
  evaluateExpressionsInString,
  recursivelyEvaluateExpressionsInObject,
} from "../../steps/expression.ts";
import type { StepDefinition } from "../../steps/stepConfig.ts";
import { loadStepConfig } from "../../steps/stepConfigLoader.ts";

// TODO: Move this somewhere else
const stepConfig = loadStepConfig(await readFile("./stepConfig.yml", "utf-8"));

export const StepOutputs = type("Record<string, unknown>");
export type StepOutputs = typeof StepOutputs.infer;

export const ContextStepData = type({
  outputs: StepOutputs,
});
export type ContextStepData = typeof ContextStepData.infer;

export const Context = type({
  session: type({
    id: type.string,
  }),
  steps: type.Record(type.string, ContextStepData),
});
export type Context = typeof Context.infer;

export async function getNextStep(
  session: CheckinSessionModel,
): Promise<StepDefinition> {
  const sessionStepData = await prisma.checkinSessionStepData.findMany({
    where: { sessionId: session.id },
  });

  const context = createContext(session, sessionStepData);

  const nextStepDefinition = findNextStepDefinition(context, sessionStepData);

  if (!nextStepDefinition) {
    throw new Error(
      `No next step found for session ${session.id}. Something might be misconfigured.`,
    );
  }

  return {
    uses: nextStepDefinition.uses,
    id: nextStepDefinition.id,
    with: nextStepDefinition.with
      ? recursivelyEvaluateExpressionsInObject(nextStepDefinition.with, context)
      : {},
  };
}

function findNextStepDefinition(
  context: Context,
  stepData: CheckinSessionStepDataModel[],
): StepDefinition | null {
  for (const stepDefinition of stepConfig.steps) {
    const data = stepData.find((s) => s.stepId === stepDefinition.id);
    const completed = data?.completedAt != null;

    if (completed) continue;

    if (stepDefinition.if) {
      const result = evaluateExpressionsInString(stepDefinition.if, context);
      if (typeof result === "string") {
        throw new Error(
          `Step condition for step ${stepDefinition.id} did not evaluate to a boolean.`,
        );
      }

      if (!result.number()) {
        continue;
      }
    }

    return stepDefinition;
  }

  return null;
}

function createContext(
  session: CheckinSessionModel,
  stepData: CheckinSessionStepDataModel[],
): Context {
  const steps: Record<string, ContextStepData> = {};

  for (const data of stepData) {
    if (data.idInFlow) {
      steps[data.idInFlow] = {
        outputs: {},
      };

      const validatedOutputs = StepOutputs(data.outputs);
      if (validatedOutputs instanceof type.errors) {
        throw new Error(
          `Invalid step outputs for step data ${data.id}: \n${validatedOutputs.summary}`,
        );
      }

      steps[data.idInFlow].outputs = validatedOutputs;
    }
  }

  return {
    session,
    steps,
  };
}
