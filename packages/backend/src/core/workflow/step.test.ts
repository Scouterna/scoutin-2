import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrow = vi.fn();
const listCompletedSteps = vi.fn();
const deleteStepData = vi.fn();
const getCurrentStep = vi.fn();
const registryGet = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: { checkinSession: { findUniqueOrThrow } },
}));

vi.mock("../../domains/workflows/step.service.ts", () => ({
  listCompletedSteps,
  deleteStepData,
  getCurrentStep,
}));

vi.mock("../../domains/workflows/steps.ts", () => ({
  stepRegistry: { get: registryGet },
}));

vi.mock("./stepContext.ts", () => ({
  createStepContext: () => ({ clearState: vi.fn() }),
}));

const { type } = await import("arktype");
const { canGoBack, goBack, startStep } = await import("./step.ts");
const {
  getStepMeta,
  isNavigationLocked,
  registerConnection,
  setNavigationLock,
  setStepMeta,
} = await import("../websocket/sessionRegistry.ts");

type Impl = {
  id: string;
  skipOnGoBack?: boolean;
  preventGoBack?: boolean;
  hooks: { onStepRollback: ReturnType<typeof vi.fn> };
};

const impls = new Map<string, Impl>();

function impl(id: string, flags: Partial<Impl> = {}): Impl {
  const i: Impl = {
    id,
    hooks: { onStepRollback: vi.fn() },
    ...flags,
  };
  impls.set(id, i);
  return i;
}

function completed(uses: string, extra: { autoCompleted?: boolean } = {}) {
  return {
    def: { uses },
    data: { id: `data-${uses}`, autoCompleted: extra.autoCompleted ?? false },
  };
}

const c = {
  get: (key: string) => (key === "wsSessionId" ? "s1" : undefined),
} as never;
const ws = { send: vi.fn() } as never;

let received: { name: string; data?: unknown }[];
let unregister: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  impls.clear();
  impl("target");
  registryGet.mockImplementation((id: string) => impls.get(id) ?? null);
  findUniqueOrThrow.mockResolvedValue({ completedAt: null, abortedAt: null });
  getCurrentStep.mockResolvedValue({ uses: "target", language: "sv" });
  received = [];
  unregister = registerConnection("s1", (m) => received.push(m));
});

afterEach(() => unregister());

function navigationMessages() {
  return received.filter((m) => m.name === "session:navigation");
}

describe("goBack with barriers", () => {
  it("refuses and rolls nothing back when a barrier is behind skip steps", async () => {
    const barrier = impl("barrier", { preventGoBack: true });
    const skip1 = impl("skip1", { skipOnGoBack: true });
    const skip2 = impl("skip2", { skipOnGoBack: true });
    const normal = impl("normal");
    listCompletedSteps.mockResolvedValue([
      completed("barrier"),
      completed("skip1"),
      completed("skip2"),
    ]);

    await goBack(c, ws);

    for (const i of [barrier, skip1, skip2, normal]) {
      expect(i.hooks.onStepRollback).not.toHaveBeenCalled();
    }
    expect(deleteStepData).not.toHaveBeenCalled();
    expect(getCurrentStep).not.toHaveBeenCalled();
    expect(navigationMessages()).toEqual([
      {
        name: "session:navigation",
        data: { canGoBack: false, locked: false },
      },
    ]);
  });

  it("refuses when the target step itself is a barrier", async () => {
    impl("barrier", { preventGoBack: true });
    listCompletedSteps.mockResolvedValue([completed("barrier")]);

    await goBack(c, ws);

    expect(deleteStepData).not.toHaveBeenCalled();
  });

  it("refuses on an auto-completed barrier", async () => {
    impl("barrier", { preventGoBack: true });
    impl("normal");
    listCompletedSteps.mockResolvedValue([
      completed("normal"),
      completed("barrier", { autoCompleted: true }),
    ]);

    await goBack(c, ws);

    expect(deleteStepData).not.toHaveBeenCalled();
  });

  it("ignores a barrier that sits before the target", async () => {
    impl("barrier", { preventGoBack: true });
    const skip = impl("skip", { skipOnGoBack: true });
    const target = impl("target");
    listCompletedSteps.mockResolvedValue([
      completed("barrier"),
      completed("target"),
      completed("skip"),
    ]);

    await goBack(c, ws);

    expect(skip.hooks.onStepRollback).toHaveBeenCalledOnce();
    expect(target.hooks.onStepRollback).toHaveBeenCalledOnce();
    expect(deleteStepData.mock.calls).toEqual([["data-skip"], ["data-target"]]);
    expect(getCurrentStep).toHaveBeenCalled();
  });

  it("rolls back in order and restarts the target when no barrier exists", async () => {
    impl("first");
    impl("skip", { skipOnGoBack: true });
    impl("auto");
    listCompletedSteps.mockResolvedValue([
      completed("first"),
      completed("auto", { autoCompleted: true }),
      completed("skip"),
    ]);

    await goBack(c, ws);

    expect(deleteStepData.mock.calls).toEqual([
      ["data-skip"],
      ["data-auto"],
      ["data-first"],
    ]);
  });

  it("terminates the session when nothing is left to go back to", async () => {
    impl("skip", { skipOnGoBack: true });
    listCompletedSteps.mockResolvedValue([completed("skip")]);
    const send = vi.fn();

    await goBack(c, { send } as never);

    expect(deleteStepData).toHaveBeenCalledWith("data-skip");
    expect(send).toHaveBeenCalledWith({ name: "session:terminated" });
  });

  it("ignores completed and aborted sessions", async () => {
    impl("normal");
    listCompletedSteps.mockResolvedValue([completed("normal")]);
    findUniqueOrThrow.mockResolvedValue({
      completedAt: new Date(),
      abortedAt: null,
    });

    await goBack(c, ws);

    expect(deleteStepData).not.toHaveBeenCalled();
  });
});

describe("canGoBack", () => {
  const scenarios: [string, ReturnType<typeof completed>[]][] = [
    ["a barrier behind skip steps", [completed("barrier"), completed("skip")]],
    ["a normal step", [completed("normal")]],
    [
      "a barrier before the target",
      [completed("barrier"), completed("normal")],
    ],
    ["nothing completed", []],
  ];

  for (const [name, steps] of scenarios) {
    it(`agrees with goBack for ${name}`, async () => {
      impl("barrier", { preventGoBack: true });
      impl("skip", { skipOnGoBack: true });
      impl("normal");
      listCompletedSteps.mockResolvedValue(steps);

      const predicted = await canGoBack("s1");
      await goBack(c, ws);

      expect(deleteStepData.mock.calls.length > 0 || steps.length === 0).toBe(
        predicted,
      );
    });
  }

  it("is false for a finished session", async () => {
    impl("normal");
    listCompletedSteps.mockResolvedValue([completed("normal")]);
    findUniqueOrThrow.mockResolvedValue({
      completedAt: null,
      abortedAt: new Date(),
    });

    expect(await canGoBack("s1")).toBe(false);
  });
});

describe("navigation lock lifecycle", () => {
  it("startStep clears a lock and sends the navigation state after step:started", async () => {
    listCompletedSteps.mockResolvedValue([completed("target")]);
    setNavigationLock("s1");
    const send = vi.fn((m) => received.push(m));

    await startStep(
      c,
      { send } as never,
      {
        uses: "target",
        language: "sv",
      } as never,
    );

    expect(isNavigationLocked("s1")).toBe(false);
    const names = received.map((m) => m.name);
    expect(names.indexOf("session:navigation")).toBe(
      names.indexOf("step:started") + 1,
    );
    expect(navigationMessages()[0]?.data).toEqual({
      canGoBack: true,
      locked: false,
    });
  });
});

describe("startStep inputs", () => {
  const start = (def: object) =>
    startStep(
      c,
      { send: vi.fn() } as never,
      { language: "sv", ...def } as never,
    );

  const seen = () => getStepMeta("s1")?.evaluatedInputs;

  beforeEach(() => setStepMeta("s1", {}));

  it("applies the schema's defaults to the inputs the step sees", async () => {
    Object.assign(impl("print"), {
      inputs: type({
        template: "string",
        behavior: "'queue' | 'wait' = 'queue'",
      }),
    });

    await start({ uses: "print", with: { template: "badge" } });

    expect(seen()).toEqual({
      template: "badge",
      behavior: "queue",
    });
  });

  it("fails before the step starts when the inputs do not match", async () => {
    Object.assign(impl("print"), { inputs: type({ template: "string" }) });

    await expect(
      start({ uses: "print", id: "badges", with: { template: 3 } }),
    ).rejects.toThrow(
      /Invalid inputs for step badges: template must be a string/,
    );
    expect(seen()).toBeUndefined();
  });

  it("passes the block through for a step without a schema", async () => {
    await start({ uses: "target", with: { anything: 1 } });

    expect(seen()).toEqual({ anything: 1 });
  });
});
