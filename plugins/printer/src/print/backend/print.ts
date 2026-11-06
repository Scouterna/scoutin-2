import {
  createJobsForStep,
  getTemplate,
  isFinishedJobState,
  listJobsForStep,
  listStepConfigs,
  onJobFinished,
  parseStepJobKey,
  prisma,
  withStepContext,
} from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

const SCREEN = "printer:status";

const Inputs = type({
  template: "string",
  values: "unknown[]",
  behavior: "'queue' | 'wait' = 'queue'",
});
type Inputs = typeof Inputs.infer;

type Payload =
  | { state: "printing"; total: number; finished: number }
  | { state: "needs-help"; total: number; problems: number }
  | { state: "no-printer"; kioskName: string | null };

type StepState =
  | { kind: "empty" }
  | { kind: "done" }
  | Extract<Payload, { state: "printing" | "needs-help" }>;

async function readState(
  sessionId: string,
  stepKey: string,
): Promise<StepState> {
  const jobs = await listJobsForStep(sessionId, stepKey);
  if (jobs.length === 0) return { kind: "empty" };
  const finished = jobs.filter((job) => isFinishedJobState(job.state));
  if (finished.length < jobs.length) {
    return { state: "printing", total: jobs.length, finished: finished.length };
  }
  const problems = finished.filter((job) => job.state !== "printed").length;
  if (problems === 0) return { kind: "done" };
  return { state: "needs-help", total: jobs.length, problems };
}

// Runs from onStepStart (so a reconnect resumes) and from the job listener.
async function evaluate(ctx: StepMethodContext) {
  const state = await readState(ctx.sessionId, ctx.stepKey);
  if ("kind" in state) {
    await ctx.setCompleted();
    return;
  }
  await ctx.showScreen(SCREEN, state satisfies Payload);
}

async function showNoPrinter(ctx: StepMethodContext) {
  const session = await prisma.checkinSession.findUnique({
    where: { id: ctx.sessionId },
    select: { kiosk: { select: { name: true } } },
  });
  await ctx.showScreen(SCREEN, {
    state: "no-printer",
    kioskName: session?.kiosk?.name ?? null,
  } satisfies Payload);
}

export const printStep: StepImplementation = {
  id: "printer:print",
  preventGoBack: true,
  inputs: Inputs,
  hooks: {
    async onStepStart(ctx) {
      const { template, values, behavior } = ctx.getInputs() as Inputs;

      const result = await createJobsForStep({
        sessionId: ctx.sessionId,
        stepKey: ctx.stepKey,
        template,
        // biome-ignore lint/suspicious/noExplicitAny: values are arbitrary JSON from the step config
        items: values as any[],
      });
      if (!result.ok) {
        await showNoPrinter(ctx);
        return;
      }

      if (behavior === "queue") {
        await ctx.setCompleted();
        return;
      }

      await ctx.lockNavigation();
      await evaluate(ctx);
    },
  },
  publicMethods: {
    acknowledge: {
      async handler(ctx) {
        const state = await readState(ctx.sessionId, ctx.stepKey);
        // Ignore a stale or early press: only the needs-help state may leave.
        if ("state" in state && state.state === "needs-help") {
          await ctx.setCompleted();
        }
      },
    },
  },
};

/**
 * Re-evaluates the step when one of its jobs finishes. The event only carries
 * the job id, so the key of the job says which step it belongs to. Step keys
 * are unique within a flow and withStepContext only runs the callback when
 * that exact step is current, so a job of another plugin's step is harmless.
 */
export function listenForPrintResults(): () => void {
  return onJobFinished(async ({ jobId, sessionId }) => {
    if (!sessionId) return;
    const job = await prisma.printJob.findUnique({
      where: { id: jobId },
      select: { source: true, idempotencyKey: true },
    });
    if (job?.source !== "step") return;
    const parsed = parseStepJobKey(job.idempotencyKey);
    if (!parsed || parsed.sessionId !== sessionId) return;
    await withStepContext(sessionId, parsed.stepKey, evaluate);
  });
}

/**
 * Startup check: every static template name in a printer:print step must
 * exist, so a typo fails at deploy time and not on the first badge. Names that
 * are not plain strings or contain an expression can't be checked here.
 */
export async function checkTemplates(): Promise<void> {
  const problems: string[] = [];
  for (const { file, config } of await listStepConfigs()) {
    config.steps.forEach((step, index) => {
      if (step.uses !== "printer:print") return;
      const name = step.with?.template;
      if (typeof name !== "string" || name.includes("${{")) return;
      if (getTemplate(name) === undefined) {
        problems.push(
          `${file}, step ${step.id ?? index}: template "${name}" does not exist`,
        );
      }
    });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
