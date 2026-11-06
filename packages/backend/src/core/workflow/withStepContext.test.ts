import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const getCurrentStep = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: { checkinSession: { findFirst } },
}));
vi.mock("../../domains/workflows/step.service.ts", () => ({ getCurrentStep }));
vi.mock("../../domains/workflows/steps.ts", () => ({
  stepRegistry: { get: () => ({ id: "t:step" }) },
}));
vi.mock("./stepContext.ts", () => ({
  createStepContext: (c: { get(k: string): unknown }) => ({
    sessionId: c.get("wsSessionId"),
  }),
}));

const { withStepContext } = await import("./withStepContext.ts");
const { registerConnection } = await import("../websocket/sessionRegistry.ts");

let n = 0;
let sid: string;
beforeEach(() => {
  vi.clearAllMocks();
  sid = `ws-${n++}`;
  findFirst.mockResolvedValue({ id: sid });
  getCurrentStep.mockResolvedValue({ uses: "printer:print", id: "badge" });
});

describe("withStepContext", () => {
  it("runs fn on the expected step when connected", async () => {
    registerConnection(sid, vi.fn());
    const fn = vi.fn();
    expect(await withStepContext(sid, "badge", fn)).toBe(true);
    expect(fn).toHaveBeenCalledWith({ sessionId: sid });
  });

  it("matches on uses when the step has no id", async () => {
    registerConnection(sid, vi.fn());
    getCurrentStep.mockResolvedValue({ uses: "printer:print" });
    const fn = vi.fn();
    expect(await withStepContext(sid, "printer:print", fn)).toBe(true);
  });

  it("does nothing without a connection", async () => {
    const fn = vi.fn();
    expect(await withStepContext(sid, "badge", fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does nothing when the current step differs", async () => {
    registerConnection(sid, vi.fn());
    getCurrentStep.mockResolvedValue({ uses: "printer:print", id: "other" });
    const fn = vi.fn();
    expect(await withStepContext(sid, "badge", fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does nothing when completed, aborted or past the last step", async () => {
    registerConnection(sid, vi.fn());
    const fn = vi.fn();
    // A completed or aborted session is filtered out by the query itself.
    findFirst.mockResolvedValue(null);
    expect(await withStepContext(sid, "badge", fn)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sid, completedAt: null, abortedAt: null },
      }),
    );
    findFirst.mockResolvedValue({ id: sid });
    getCurrentStep.mockResolvedValue(null);
    expect(await withStepContext(sid, "badge", fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs concurrent calls one at a time; the second sees the step completed", async () => {
    registerConnection(sid, vi.fn());
    let current = { uses: "printer:print", id: "badge" } as {
      uses: string;
      id?: string;
    } | null;
    getCurrentStep.mockImplementation(async () => current);
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      current = null; // the step completed
    });
    const results = await Promise.all([
      withStepContext(sid, "badge", fn),
      withStepContext(sid, "badge", fn),
    ]);
    expect(results).toEqual([true, false]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps working after fn throws", async () => {
    registerConnection(sid, vi.fn());
    await expect(
      withStepContext(sid, "badge", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await withStepContext(sid, "badge", vi.fn())).toBe(true);
  });
});
