import { beforeEach, describe, expect, it, vi } from "vitest";

const createJobsForStep = vi.fn();
const listJobsForStep = vi.fn();
const withStepContext = vi.fn();
const getTemplate = vi.fn();
const listStepConfigs = vi.fn();
const findSession = vi.fn();
const findJob = vi.fn();
let finishedListener: (e: {
  jobId: string;
  sessionId: string | null;
  state: string;
}) => Promise<void> | void;

vi.mock("@scouterna/scoutin-backend/plugin-services", () => ({
  createJobsForStep,
  listJobsForStep,
  withStepContext,
  getTemplate,
  listStepConfigs,
  parseStepJobKey: (key: string | null) => {
    const m = key?.match(/^([^:]+):(.+):(\d+)$/);
    return m ? { sessionId: m[1], stepKey: m[2], index: Number(m[3]) } : null;
  },
  isFinishedJobState: (s: string) =>
    ["printed", "unknown", "failed", "canceled"].includes(s),
  onJobFinished: (l: typeof finishedListener) => {
    finishedListener = l;
    return () => {};
  },
  prisma: {
    checkinSession: { findUnique: findSession },
    printJob: { findUnique: findJob },
  },
}));

const { printStep, listenForPrintResults, checkTemplates } = await import(
  "./print.ts"
);

function makeCtx(inputs: Record<string, unknown>, stepKey = "printer:print") {
  return {
    sessionId: "s1",
    stepKey,
    getInputs: vi.fn().mockReturnValue(inputs),
    setCompleted: vi.fn(),
    showScreen: vi.fn(),
    lockNavigation: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}

const jobs = (...states: string[]) => states.map((state) => ({ state }));
const start = (ctx: ReturnType<typeof makeCtx>) =>
  printStep.hooks?.onStepStart?.(ctx);

beforeEach(() => {
  vi.resetAllMocks();
  createJobsForStep.mockResolvedValue({ ok: true, jobs: [] });
  listJobsForStep.mockResolvedValue([]);
});

describe("printer:print", () => {
  it("shows no-printer with the kiosk name when there is no pool", async () => {
    createJobsForStep.mockResolvedValue({ ok: false, reason: "no-pool" });
    findSession.mockResolvedValue({ kiosk: { name: "Entrance" } });
    const ctx = makeCtx({ template: "badge", values: [{}] });

    await start(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith("printer:status", {
      state: "no-printer",
      kioskName: "Entrance",
    });
    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.lockNavigation).not.toHaveBeenCalled();
  });

  it("queue completes at once without a screen or lock", async () => {
    // The engine applies the schema's default before the step sees its inputs.
    const ctx = makeCtx({
      template: "badge",
      values: [{}],
      behavior: "queue",
    });

    await start(ctx);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.showScreen).not.toHaveBeenCalled();
    expect(ctx.lockNavigation).not.toHaveBeenCalled();
  });

  it("wait locks and shows progress while jobs are pending", async () => {
    listJobsForStep.mockResolvedValue(jobs("printed", "sending"));
    const ctx = makeCtx({
      template: "badge",
      values: [{}, {}],
      behavior: "wait",
    });

    await start(ctx);

    expect(ctx.lockNavigation).toHaveBeenCalledTimes(1);
    expect(ctx.showScreen).toHaveBeenCalledWith("printer:status", {
      state: "printing",
      total: 2,
      finished: 1,
    });
    expect(ctx.setCompleted).not.toHaveBeenCalled();
  });

  it("wait completes when all jobs are printed (also on reconnect)", async () => {
    listJobsForStep.mockResolvedValue(jobs("printed", "printed"));
    const ctx = makeCtx({
      template: "badge",
      values: [{}, {}],
      behavior: "wait",
    });

    await start(ctx);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.showScreen).not.toHaveBeenCalled();
  });

  it("wait shows needs-help on a failed job, and acknowledge completes", async () => {
    listJobsForStep.mockResolvedValue(jobs("printed", "failed"));
    const ctx = makeCtx({
      template: "badge",
      values: [{}, {}],
      behavior: "wait",
    });

    await start(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith("printer:status", {
      state: "needs-help",
      total: 2,
      problems: 1,
    });
    expect(ctx.setCompleted).not.toHaveBeenCalled();

    await printStep.publicMethods?.acknowledge?.handler(ctx, {});
    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("acknowledge does nothing while jobs are still printing", async () => {
    listJobsForStep.mockResolvedValue(jobs("sending"));
    const ctx = makeCtx({});

    await printStep.publicMethods?.acknowledge?.handler(ctx, {});

    expect(ctx.setCompleted).not.toHaveBeenCalled();
  });

  it("empty values complete the step", async () => {
    const ctx = makeCtx({ template: "badge", values: [], behavior: "wait" });

    await start(ctx);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("keys jobs by the step's own id", async () => {
    listJobsForStep.mockResolvedValue(jobs("sending"));
    const ctx = makeCtx(
      { template: "badge", values: [{}], behavior: "wait" },
      "badge",
    );

    await start(ctx);

    expect(createJobsForStep).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", stepKey: "badge" }),
    );
    expect(listJobsForStep).toHaveBeenCalledWith("s1", "badge");
  });

  describe("job listener", () => {
    beforeEach(() => {
      listenForPrintResults();
    });

    it("re-evaluates the step for one of its jobs", async () => {
      findJob.mockResolvedValue({
        source: "step",
        idempotencyKey: "s1:printer:print:0",
      });
      withStepContext.mockImplementation(async (_s, _k, fn) => {
        listJobsForStep.mockResolvedValue(jobs("printed"));
        await fn(ctx);
        return true;
      });
      const ctx = makeCtx({});

      await finishedListener({
        jobId: "j1",
        sessionId: "s1",
        state: "printed",
      });

      expect(withStepContext).toHaveBeenCalledWith(
        "s1",
        "printer:print",
        expect.any(Function),
      );
      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("uses the step key parsed from the job", async () => {
      findJob.mockResolvedValue({
        source: "step",
        idempotencyKey: "s1:badge:0",
      });

      await finishedListener({
        jobId: "j1",
        sessionId: "s1",
        state: "printed",
      });

      expect(withStepContext).toHaveBeenCalledWith(
        "s1",
        "badge",
        expect.any(Function),
      );
    });

    it("ignores a job of another session", async () => {
      findJob.mockResolvedValue({
        source: "step",
        idempotencyKey: "s2:badge:0",
      });

      await finishedListener({
        jobId: "j1",
        sessionId: "s1",
        state: "printed",
      });

      expect(withStepContext).not.toHaveBeenCalled();
    });

    it("ignores jobs without a session or from other steps", async () => {
      await finishedListener({
        jobId: "j1",
        sessionId: null,
        state: "printed",
      });
      findJob.mockResolvedValue({ source: "admin", idempotencyKey: null });
      await finishedListener({ jobId: "j2", sessionId: "s1", state: "failed" });
      findJob.mockResolvedValue({
        source: "step",
        idempotencyKey: "not-a-step-key",
      });
      await finishedListener({ jobId: "j3", sessionId: "s1", state: "failed" });

      expect(withStepContext).not.toHaveBeenCalled();
    });
  });
});

describe("checkTemplates", () => {
  const config = (...steps: object[]) => ({ steps });
  const printStepDef = (template: unknown, id?: string) => ({
    uses: "printer:print",
    id,
    with: { template, values: [] },
  });

  beforeEach(() => {
    getTemplate.mockImplementation((name: string) =>
      name.startsWith("ok") ? {} : undefined,
    );
  });

  it("passes when all templates exist", async () => {
    listStepConfigs.mockResolvedValue([
      { file: "stepConfig.yml", config: config(printStepDef("ok1")) },
    ]);

    await expect(checkTemplates()).resolves.toBeUndefined();
  });

  it("lists every missing template across files", async () => {
    listStepConfigs.mockResolvedValue([
      {
        file: "stepConfig.yml",
        config: config({ uses: "other" }, printStepDef("nope", "badge")),
      },
      { file: "stepConfig.b.yml", config: config(printStepDef("gone")) },
    ]);

    const error = await checkTemplates().catch((e: Error) => e);

    expect((error as Error).message).toBe(
      'stepConfig.yml, step badge: template "nope" does not exist\n' +
        'stepConfig.b.yml, step 0: template "gone" does not exist',
    );
  });

  it("skips expression and non-string templates", async () => {
    listStepConfigs.mockResolvedValue([
      {
        file: "stepConfig.yml",
        config: config(
          printStepDef(`\${{ session.params.t }}`),
          printStepDef({ sv: "x" }),
        ),
      },
    ]);

    await expect(checkTemplates()).resolves.toBeUndefined();
  });

  it("ignores other steps", async () => {
    listStepConfigs.mockResolvedValue([
      {
        file: "stepConfig.yml",
        config: config({ uses: "other", with: { template: "nope" } }),
      },
    ]);

    await expect(checkTemplates()).resolves.toBeUndefined();
  });
});
