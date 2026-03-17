import { readFile } from "node:fs/promises";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import type { StepDefinition } from "../../config/stepConfig.ts";
import { loadStepConfig } from "../../config/stepConfigLoader.ts";
import {
  evaluateExpressionsInString,
  recursivelyEvaluateExpressionsInObject,
} from "../../core/expressions/expressions.ts";
import type {
  CheckinSessionModel,
  CheckinSessionStepDataModel,
} from "../../generated/prisma/models.ts";

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

export async function getCurrentStep(
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

/**
 * Iterates through the step definitions in order and finds the next step that
 * should be executed based on the provided context and step data.
 */
function findNextStepDefinition(
  context: Context,
  stepData: CheckinSessionStepDataModel[],
): StepDefinition | null {
  for (const stepDefinition of stepConfig.steps) {
    const data = stepData.find((s) => s.stepId === stepDefinition.uses);
    const completed = data?.completedAt != null;

    if (completed) continue;

    if (stepDefinition.if) {
      const result = evaluateExpressionsInString(stepDefinition.if, context);
      if (typeof result === "string") {
        throw new Error(
          `Step condition for step ${stepDefinition.uses} did not evaluate to a boolean.`,
        );
      }

      // Expressions use integers for booleans. We're lax about it here and
      // coerce by checking for truthiness.
      if (!result.number()) {
        continue;
      }
    }

    return stepDefinition;
  }

  return null;
}

export type SessionStepStatus = {
  uses: string;
  id?: string;
  if?: string;
  status: "completed" | "active" | "skipped" | "pending";
  completedAt?: Date;
  outputs?: Record<string, unknown>;
};

/**
 * Gets the status of all steps for a given session. This is used to render the
 * session details page in the admin interface.
 */
export async function getStepStatuses(
  session: CheckinSessionModel,
): Promise<SessionStepStatus[]> {
  const sessionStepData = await prisma.checkinSessionStepData.findMany({
    where: { sessionId: session.id },
  });

  const context = createContext(session, sessionStepData);
  const statuses: SessionStepStatus[] = [];
  let foundActive = false;

  for (const stepDef of stepConfig.steps) {
    const data = sessionStepData.find((s) => s.stepId === stepDef.uses);

    if (data?.completedAt != null) {
      statuses.push({
        uses: stepDef.uses,
        id: stepDef.id,
        if: stepDef.if,
        status: "completed",
        completedAt: data.completedAt,
        outputs:
          data.outputs != null
            ? (data.outputs as Record<string, unknown>)
            : undefined,
      });
      continue;
    }

    if (!foundActive) {
      if (stepDef.if) {
        try {
          const result = evaluateExpressionsInString(stepDef.if, context);
          if (typeof result === "string" || !result.number()) {
            statuses.push({
              uses: stepDef.uses,
              id: stepDef.id,
              if: stepDef.if,
              status: "skipped",
            });
            continue;
          }
        } catch {
          // If the condition can't be evaluated, conservatively treat as active
        }
      }
      foundActive = true;
      statuses.push({
        uses: stepDef.uses,
        id: stepDef.id,
        if: stepDef.if,
        status: "active",
      });
      continue;
    }

    statuses.push({
      uses: stepDef.uses,
      id: stepDef.id,
      if: stepDef.if,
      status: "pending",
    });
  }

  return statuses;
}

export async function completeStep(
  sessionId: string,
  stepId: string,
  idInFlow: string | null | undefined,
  inputs: Record<string, unknown> | null | undefined,
  outputs: Record<string, unknown>,
) {
  // Making sure that what we try to store in the database is actually serializable.
  const jsonifiedInputs = JSON.parse(JSON.stringify(inputs));
  const jsonifiedOutputs = JSON.parse(JSON.stringify(outputs));

  const { session } = await prisma.checkinSessionStepData.create({
    data: {
      sessionId,
      stepId,
      idInFlow,
      evaluatedInputs: jsonifiedInputs,
      outputs: jsonifiedOutputs,
      completedAt: new Date(),
    },
    include: {
      session: true,
    },
  });

  return { session };
}

/**
 * Creates the context object for the given session and step data from all
 * previous steps. This function is pure and only creates a represtentation of
 * the context without any side effects.
 */
function createContext(
  session: CheckinSessionModel,
  stepData: CheckinSessionStepDataModel[],
): Context {
  const steps: Record<string, ContextStepData> = {};

  for (const data of stepData) {
    if (!data.idInFlow) {
      continue;
    }

    const stepData = {
      outputs: {},
    };
    steps[data.idInFlow] = stepData;

    const validatedOutputs = StepOutputs(data.outputs);
    if (validatedOutputs instanceof type.errors) {
      throw new Error(
        `Invalid step outputs for step data ${data.id}: \n${validatedOutputs.summary}`,
      );
    }

    stepData.outputs = validatedOutputs;
  }

  return {
    session,
    steps,
  };
}
