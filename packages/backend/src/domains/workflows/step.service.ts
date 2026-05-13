import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import type { StepConfig, StepDefinition } from "../../config/stepConfig.ts";
import { loadStepConfig } from "../../config/stepConfigLoader.ts";
import {
  evaluateExpressionsInString,
  recursivelyEvaluateExpressionsInObject,
} from "../../core/expressions/expressions.ts";
import type { CheckinSessionStepDataModel } from "../../generated/prisma/models.ts";

const configCache = new Map<string, StepConfig>();

async function getStepConfig(configFile: string): Promise<StepConfig> {
  if (!configCache.has(configFile)) {
    const raw = await readFile(join("config", configFile), "utf-8");
    configCache.set(configFile, loadStepConfig(raw));
  }
  // biome-ignore lint/style/noNonNullAssertion: We just set it
  return configCache.get(configFile)!;
}

export const StepOutputs = type("Record<string, unknown>");
export type StepOutputs = typeof StepOutputs.infer;

export const ContextStepData = type({
  outputs: StepOutputs,
});
export type ContextStepData = typeof ContextStepData.infer;

export const Context = type({
  sessionId: type.string,
  session: type({
    params: "Record<string, unknown>",
  }),
  steps: type.Record(type.string, ContextStepData),
});
export type Context = typeof Context.infer;

export async function getCurrentStep(
  sessionId: string,
): Promise<StepDefinition | null> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { stepData: true },
  });
  const params = session.params as Record<string, unknown>;
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(sessionId, session.stepData, params);

  const nextStepDefinition = findNextStepDefinition(
    context,
    session.stepData,
    stepConfig,
  );

  if (!nextStepDefinition) {
    return null;
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
  stepConfig: StepConfig,
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
  sessionId: string,
): Promise<SessionStepStatus[]> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { stepData: true },
  });
  const params = session.params as Record<string, unknown>;
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(sessionId, session.stepData, params);
  const statuses: SessionStepStatus[] = [];
  let foundActive = false;

  for (const stepDef of stepConfig.steps) {
    const data = session.stepData.find((s) => s.stepId === stepDef.uses);

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

/**
 * Finds the last completed step for a session, in stepConfig order.
 * Returns null if no steps have been completed.
 */
export async function findLastCompletedStep(
  sessionId: string,
): Promise<{ def: StepDefinition; data: CheckinSessionStepDataModel } | null> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { stepData: true },
  });
  const stepConfig = await getStepConfig(session.configFile);

  let result: {
    def: StepDefinition;
    data: CheckinSessionStepDataModel;
  } | null = null;

  for (const stepDefinition of stepConfig.steps) {
    const data = session.stepData.find(
      (s) => s.stepId === stepDefinition.uses && s.completedAt != null,
    );
    if (data) {
      result = { def: stepDefinition, data };
    }
  }

  return result;
}

export async function deleteStepData(id: string): Promise<void> {
  await prisma.checkinSessionStepData.delete({ where: { id } });
}

/**
 * Checks required steps and marks the session as complete in the database.
 * Throws if any required steps were not satisfied.
 * Safe to call on an already-completed session (no-op if completedAt is set).
 */
export async function finalizeSession(sessionId: string): Promise<void> {
  const unmet = await findUnmetRequiredSteps(sessionId);
  if (unmet.length > 0) {
    throw new Error(
      `Session ${sessionId} cannot complete: required steps not satisfied: ${unmet.join(", ")}`,
    );
  }
  await prisma.checkinSession.update({
    where: { id: sessionId },
    data: { completedAt: new Date() },
  });
}

/**
 * Returns the `uses` IDs of required steps that have not been completed and
 * whose `if` condition was not false at the time of the call. An empty array
 * means all required steps were satisfied and the session may be completed.
 */
export async function findUnmetRequiredSteps(
  sessionId: string,
): Promise<string[]> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { stepData: true },
  });
  const params = session.params as Record<string, unknown>;
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(sessionId, session.stepData, params);

  const unmet: string[] = [];

  for (const stepDef of stepConfig.steps) {
    if (!stepDef.required) continue;

    const completed = session.stepData.some(
      (d) => d.stepId === stepDef.uses && d.completedAt != null,
    );
    if (completed) continue;

    if (stepDef.if) {
      const result = evaluateExpressionsInString(stepDef.if, context);
      if (typeof result !== "string" && !result.number()) continue;
    }

    unmet.push(stepDef.uses);
  }

  return unmet;
}

export async function completeStep(
  sessionId: string,
  stepId: string,
  idInFlow: string | null | undefined,
  inputs: Record<string, unknown> | null | undefined,
  outputs: Record<string, unknown>,
  autoCompleted = false,
) {
  // Making sure that what we try to store in the database is actually serializable.
  const jsonifiedInputs = JSON.parse(JSON.stringify(inputs));
  const jsonifiedOutputs = JSON.parse(JSON.stringify(outputs));

  await prisma.checkinSessionStepData.create({
    data: {
      sessionId,
      stepId,
      idInFlow,
      evaluatedInputs: jsonifiedInputs,
      outputs: jsonifiedOutputs,
      completedAt: new Date(),
      autoCompleted,
    },
  });
}

/**
 * Creates the context object for the given session and step data from all
 * previous steps. This function is pure and only creates a represtentation of
 * the context without any side effects.
 */
function createContext(
  sessionId: string,
  stepData: CheckinSessionStepDataModel[],
  params: Record<string, unknown>,
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
    sessionId,
    session: { params },
    steps,
  };
}
