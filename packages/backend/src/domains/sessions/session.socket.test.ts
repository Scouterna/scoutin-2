import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const goBack = vi.fn();
const sendNavigationState = vi.fn();
const abortSession = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: { checkinSession: { findUnique } },
}));
vi.mock("../../app/metrics.ts", () => ({
  authAttempts: { inc: vi.fn() },
  activeWebSocketConnections: { inc: vi.fn(), dec: vi.fn() },
  stepMethodCallSeconds: { startTimer: () => vi.fn() },
}));
vi.mock("../../config/config.ts", () => ({
  default: { TOKEN_SECRET: "test-secret" },
}));
vi.mock("../../core/workflow/step.ts", () => ({
  goBack,
  sendNavigationState,
  startStep: vi.fn(),
}));
vi.mock("../../core/workflow/stepContext.ts", () => ({
  createStepContext: vi.fn(),
}));
vi.mock("../workflows/step.service.ts", () => ({
  getCurrentStep: vi.fn(),
  finalizeSession: vi.fn(),
}));
vi.mock("../workflows/steps.ts", () => ({ stepRegistry: { get: vi.fn() } }));
vi.mock("./session.service.ts", () => ({
  abortSession,
  sendSessionInfo: vi.fn(),
}));

const { router } = await import("./session.socket.ts");
const { signJWT } = await import("./tokens.ts");
const { setNavigationLock, clearNavigationLock } = await import(
  "../../core/websocket/sessionRegistry.ts"
);

// Connects a fake socket the way the kiosk would, authenticated with a token.
async function connect(claims: { role?: "kiosk" | "staff" }) {
  const vars: Record<string, unknown> = { connId: "conn" };
  const c = {
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => {
      vars[k] = v;
    },
  } as never;
  const ws = { send: vi.fn() };
  const handle = router.onMessage(c);
  const send = (name: string, data?: object) =>
    handle({ data: JSON.stringify({ name, data }) } as never, ws as never);

  const token = await signJWT({
    "urn:scoutin:sessionId": "s3",
    ...(claims.role ? { "urn:scoutin:role": claims.role } : {}),
  });
  send("auth:authenticate", { token });
  await vi.waitFor(() =>
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"status":"success"'),
    ),
  );
  return { send, vars };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  clearNavigationLock("s3");
  // Already ended, so authenticating doesn't try to start a step.
  findUnique.mockResolvedValue({
    id: "s3",
    completedAt: new Date(),
    abortedAt: null,
  });
  sendNavigationState.mockResolvedValue(undefined);
});

describe("navigation lock enforcement", () => {
  it("rejects goBack and abort from a kiosk while locked", async () => {
    const { send } = await connect({ role: "kiosk" });
    setNavigationLock("s3");

    send("step:goBack");
    send("session:abort");
    await flush();

    expect(goBack).not.toHaveBeenCalled();
    expect(abortSession).not.toHaveBeenCalled();
    expect(sendNavigationState).toHaveBeenCalledTimes(2);
  });

  it("treats a token without a role as a kiosk", async () => {
    const { send, vars } = await connect({});
    setNavigationLock("s3");

    expect(vars.wsRole).toBe("kiosk");
    send("step:goBack");
    await flush();

    expect(goBack).not.toHaveBeenCalled();
  });

  it("lets staff go back and abort while locked", async () => {
    const { send, vars } = await connect({ role: "staff" });
    setNavigationLock("s3");

    expect(vars.wsRole).toBe("staff");
    send("step:goBack");
    send("session:abort");
    await vi.waitFor(() => {
      expect(goBack).toHaveBeenCalledOnce();
      expect(abortSession).toHaveBeenCalledWith("s3");
    });
  });

  it("enforces nothing when the session is not locked", async () => {
    const { send } = await connect({ role: "kiosk" });

    send("step:goBack");
    send("session:abort");
    await vi.waitFor(() => {
      expect(goBack).toHaveBeenCalledOnce();
      expect(abortSession).toHaveBeenCalledWith("s3");
    });
    expect(sendNavigationState).not.toHaveBeenCalled();
  });
});
