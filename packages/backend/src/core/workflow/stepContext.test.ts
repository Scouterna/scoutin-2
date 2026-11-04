import { beforeEach, describe, expect, it, vi } from "vitest";

const completeStep = vi.fn();
const finalizeSession = vi.fn();
const getCurrentStep = vi.fn();
const startStep = vi.fn();
const sendNavigationState = vi.fn();

vi.mock("../../app/prisma.ts", () => ({ prisma: {} }));
vi.mock("../../app/metrics.ts", () => ({
  stepCompletions: { inc: vi.fn() },
}));
vi.mock("../../domains/participants/data.service.ts", () => ({
  mergeJsonKey: vi.fn(),
}));
vi.mock("../../domains/sessions/session.service.ts", () => ({
  sendSessionInfo: vi.fn(),
}));
vi.mock("../../domains/workflows/step.service.ts", () => ({
  completeStep,
  finalizeSession,
  getCurrentStep,
}));
vi.mock("./step.ts", () => ({
  restartStep: vi.fn(),
  startStep,
  sendNavigationState,
}));

const { createStepContext } = await import("./stepContext.ts");
const { isNavigationLocked, setStepMeta } = await import(
  "../websocket/sessionRegistry.ts"
);

const c = {
  get: (key: string) => (key === "wsSessionId" ? "s2" : undefined),
} as never;
const ws = { send: vi.fn() } as never;

function ctx() {
  return createStepContext(c, ws, { id: "t:step" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendNavigationState.mockResolvedValue(undefined);
  setStepMeta("s2", {});
});

describe("ctx.lockNavigation", () => {
  it("holds the lock and has broadcast by the time it resolves", async () => {
    const context = ctx();

    await context.lockNavigation();
    expect(isNavigationLocked("s2")).toBe(true);
    expect(sendNavigationState).toHaveBeenCalledTimes(1);

    await context.unlockNavigation();
    expect(isNavigationLocked("s2")).toBe(false);
    expect(sendNavigationState).toHaveBeenCalledTimes(2);
  });

  it("is cleared when the step completes, even if no step follows", async () => {
    getCurrentStep.mockResolvedValue(null);
    const context = ctx();
    await context.lockNavigation();

    await context.setCompleted();

    expect(isNavigationLocked("s2")).toBe(false);
    expect(finalizeSession).toHaveBeenCalled();
  });
});
