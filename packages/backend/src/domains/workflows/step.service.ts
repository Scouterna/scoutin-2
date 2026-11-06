import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import type { StepConfig, StepDefinition } from "../../config/stepConfig.ts";
import { loadStepConfig } from "../../config/stepConfigLoader.ts";
import {
  evaluateExpressionsInString,
  recursivelyEvaluateExpressionsInObject,
} from "../../core/expressions/expressions.ts";
import {
  coerceLanguage,
  type Language,
  resolveLocalizedInputs,
} from "../../core/i18n/localized.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { CheckinSessionStepDataModel } from "../../generated/prisma/models.ts";

/** What `createContext` needs loaded on the session. */
const CONTEXT_INCLUDE = {
  stepData: true,
  subjects: {
    include: { participant: true },
    orderBy: { createdAt: "asc" },
  },
} as const;

const configCache = new Map<string, StepConfig>();

async function getStepConfig(configFile: string): Promise<StepConfig> {
  if (!configCache.has(configFile)) {
    const raw = await readFile(join("config", configFile), "utf-8");
    configCache.set(configFile, loadStepConfig(raw));
  }
  // biome-ignore lint/style/noNonNullAssertion: We just set it
  return configCache.get(configFile)!;
}

/** Every stepConfig*.yml in the config directory, loaded (and validated). */
export async function listStepConfigs(): Promise<
  { file: string; config: StepConfig }[]
> {
  const files = (await readdir("config"))
    .filter((name) => /^stepConfig.*\.yml$/.test(name))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      try {
        return { file, config: await getStepConfig(file) };
      } catch (error) {
        throw new Error(
          `${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

export const StepOutputs = type("Record<string, unknown>");
export type StepOutputs = typeof StepOutputs.infer;

export const ContextStepData = type({
  outputs: StepOutputs,
});
export type ContextStepData = typeof ContextStepData.infer;

/**
 * A subject as expressions see it: the participant's own columns, without
 * lookup hashes or timestamps (the context is serialized to JSON).
 */
export const ContextSubject = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  subGroup: "string | null",
  dataSource: "string",
  idInDataSource: "string",
  metadata: "unknown",
  resultData: "unknown",
});

export const Context = type({
  sessionId: type.string,
  session: type({
    params: "Record<string, unknown>",
    subjects: ContextSubject.array(),
  }),
  steps: type.Record(type.string, ContextStepData),
});
export type Context = typeof Context.infer;

/**
 * Matches a step completion record against a step definition. When the
 * definition has an `id`, we match by `idInFlow` so the same implementation
 * can appear multiple times in a flow with distinct identifiers.
 */
function matchesStepData(
  data: CheckinSessionStepDataModel,
  stepDefinition: StepDefinition,
): boolean {
  if (stepDefinition.id) {
    return data.idInFlow === stepDefinition.id;
  }
  return data.stepId === stepDefinition.uses;
}

/**
 * A step definition whose `with` block has been fully evaluated: expressions
 * substituted and localized `{ sv, en }` text maps collapsed for the session's
 * language. `language` travels along so the step implementation can localize
 * text it generates itself (see `ctx.language`).
 */
export type ResolvedStepDefinition = StepDefinition & { language: Language };

export async function getCurrentStep(
  sessionId: string,
): Promise<ResolvedStepDefinition | null> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: CONTEXT_INCLUDE,
  });
  const language = coerceLanguage(session.language);
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(session);

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
    language,
    with: nextStepDefinition.with
      ? resolveLocalizedInputs(
          recursivelyEvaluateExpressionsInObject(
            nextStepDefinition.with,
            context,
          ),
          language,
        )
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
    const data = stepData.find((s) => matchesStepData(s, stepDefinition));
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
    include: CONTEXT_INCLUDE,
  });
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(session);
  const statuses: SessionStepStatus[] = [];
  let foundActive = false;

  for (const stepDef of stepConfig.steps) {
    const data = session.stepData.find((s) => matchesStepData(s, stepDef));

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

export type CompletedStep = {
  def: StepDefinition;
  data: CheckinSessionStepDataModel;
};

/**
 * All completed steps for a session, in stepConfig order. Read-only: used to
 * plan a goBack before anything is rolled back.
 */
export async function listCompletedSteps(
  sessionId: string,
): Promise<CompletedStep[]> {
  const session = await prisma.checkinSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { stepData: true },
  });
  const stepConfig = await getStepConfig(session.configFile);

  const result: CompletedStep[] = [];
  for (const stepDefinition of stepConfig.steps) {
    const data = session.stepData.find(
      (s) => matchesStepData(s, stepDefinition) && s.completedAt != null,
    );
    if (data) result.push({ def: stepDefinition, data });
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
    include: CONTEXT_INCLUDE,
  });
  const stepConfig = await getStepConfig(session.configFile);
  const context = createContext(session);

  const unmet: string[] = [];

  for (const stepDef of stepConfig.steps) {
    if (!stepDef.required) continue;

    const completed = session.stepData.some(
      (d) => matchesStepData(d, stepDef) && d.completedAt != null,
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
  session: Prisma.CheckinSessionGetPayload<{
    include: typeof CONTEXT_INCLUDE;
  }>,
): Context {
  const steps: Record<string, ContextStepData> = {};

  for (const data of session.stepData) {
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
    sessionId: session.id,
    session: {
      params: session.params as Record<string, unknown>,
      subjects: session.subjects.map(({ participant: p }) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        subGroup: p.subGroup,
        dataSource: p.dataSource,
        idInDataSource: p.idInDataSource,
        metadata: p.metadata,
        resultData: p.resultData,
      })),
    },
    steps,
  };
}
