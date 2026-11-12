import { beforeEach, describe, expect, it, vi } from "vitest";

const findParticipant = vi.fn();
const recordAudit = vi.fn();
const listStepConfigs = vi.fn();

vi.mock("@scouterna/scoutin-backend/plugin-services", () => ({
  prisma: { participant: { findUnique: findParticipant } },
  recordAudit,
  listStepConfigs,
}));

const { grantVoterRoleStep, checkConfig } = await import("./grantVoterRole.ts");

const mkInvite = (over: Record<string, unknown> = {}) => ({
  pk: 7,
  state: "open",
  user_data: { member_id: "3001" },
  roles: ["pa"],
  ...over,
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function makeCtx(role: "kiosk" | "staff" = "staff") {
  const state: Record<string, unknown> = {};
  return {
    sessionId: "s1",
    role,
    getInputs: () => ({ participantId: "p1" }),
    setState: (k: string, v: unknown) => {
      state[k] = v;
    },
    getState: (k: string) => state[k],
    showScreen: vi.fn(),
    setCompleted: vi.fn(),
    writeResultData: vi.fn(),
    logger: { warn: vi.fn() },
    state,
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}
// Attempts hold the working screen for a minimum time; fake timers skip it.
async function settle(run: unknown) {
  await vi.runAllTimersAsync();
  await run;
}
const start = (ctx: ReturnType<typeof makeCtx>) =>
  settle(grantVoterRoleStep.hooks?.onStepStart?.(ctx));
const call = (name: string, ctx: ReturnType<typeof makeCtx>) =>
  settle(grantVoterRoleStep.publicMethods?.[name].handler(ctx, undefined));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("VOTEIT_BASE_URL", "https://v.example");
  vi.stubEnv("VOTEIT_API_KEY", "k");
  findParticipant.mockResolvedValue({ idInDataSource: "3001" });
});

async function failWith(ctx: ReturnType<typeof makeCtx>) {
  fetchMock.mockResolvedValueOnce(json([]));
  await start(ctx);
}

describe("voteit:grantVoterRole", () => {
  it("holds the working screen for at least two seconds", async () => {
    fetchMock.mockResolvedValueOnce(json([mkInvite({ roles: ["pv"] })]));
    const ctx = makeCtx();
    const run = grantVoterRoleStep.hooks?.onStepStart?.(ctx);
    await vi.advanceTimersByTimeAsync(1999);
    expect(ctx.setCompleted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("fails with notInvited on zero invites", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const ctx = makeCtx();
    await start(ctx);
    expect(ctx.showScreen).toHaveBeenNthCalledWith(1, "voteit:status", {
      state: "working",
    });
    expect(ctx.showScreen).toHaveBeenLastCalledWith("voteit:status", {
      state: "failed",
      reason: "notInvited",
    });
    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with ambiguous on several invites", async () => {
    fetchMock.mockResolvedValueOnce(json([mkInvite(), mkInvite({ pk: 8 })]));
    const ctx = makeCtx();
    await start(ctx);
    expect(ctx.showScreen).toHaveBeenLastCalledWith("voteit:status", {
      state: "failed",
      reason: "ambiguous",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("completes right away for alreadyGranted without a POST", async () => {
    fetchMock.mockResolvedValueOnce(json([mkInvite({ roles: ["pa", "pv"] })]));
    const ctx = makeCtx();
    await start(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "voteit.alreadyGranted",
        actor: null,
      }),
    );
    expect(ctx.showScreen).toHaveBeenCalledTimes(1);
    expect(ctx.setCompleted).toHaveBeenCalledWith({
      status: "alreadyGranted",
      invitePk: 7,
    });
  });

  it("grants, audits, writes result data and completes right away", async () => {
    fetchMock
      .mockResolvedValueOnce(json([mkInvite()]))
      .mockResolvedValueOnce(json(mkInvite({ roles: ["pa", "pv"] })));
    const ctx = makeCtx();
    await start(ctx);
    expect(fetchMock.mock.calls[1][0].toString()).toContain(
      "/token-api/invites/7/add-roles/",
    );
    expect(recordAudit).toHaveBeenCalledWith({
      actor: null,
      action: "voteit.grant",
      details: {
        sessionId: "s1",
        participantId: "p1",
        memberId: "3001",
        invitePk: 7,
        rolesBefore: ["pa"],
        rolesAfter: ["pa", "pv"],
      },
    });
    expect(ctx.writeResultData).toHaveBeenCalledWith("p1", {
      status: "granted",
      invitePk: 7,
      at: expect.any(String),
    });
    expect(ctx.showScreen).toHaveBeenCalledTimes(1);
    expect(ctx.setCompleted).toHaveBeenCalledWith({
      status: "granted",
      invitePk: 7,
    });
  });

  it.each([
    [
      "wrong member id",
      { user_data: { member_id: "9999" }, roles: ["pa", "pv"] },
    ],
    ["dropped role", { roles: ["pv"] }],
    ["missing pv", { roles: ["pa"] }],
    ["wrong pk", { pk: 8, roles: ["pa", "pv"] }],
  ])("fails on a response mismatch: %s", async (_name, over) => {
    fetchMock
      .mockResolvedValueOnce(json([mkInvite()]))
      .mockResolvedValueOnce(json(mkInvite(over)));
    const ctx = makeCtx();
    await start(ctx);
    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenLastCalledWith("voteit:status", {
      state: "failed",
      reason: "error",
    });
  });

  it("fails with error on an HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const ctx = makeCtx();
    await start(ctx);
    expect(ctx.showScreen).toHaveBeenLastCalledWith("voteit:status", {
      state: "failed",
      reason: "error",
    });
    expect(ctx.state.attempt).toMatchObject({ status: "failed" });
    expect((ctx.state.attempt as { error: string }).error).toContain("500");
  });

  it("fails when the participant is missing", async () => {
    findParticipant.mockResolvedValue(null);
    const ctx = makeCtx();
    await start(ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.state.attempt).toMatchObject({ status: "failed" });
  });

  it("retry from failed runs the attempt again", async () => {
    const ctx = makeCtx();
    await failWith(ctx);
    fetchMock.mockResolvedValueOnce(json([mkInvite({ roles: ["pv"] })]));
    await call("retry", ctx);
    expect(ctx.setCompleted).toHaveBeenCalledWith({
      status: "alreadyGranted",
      invitePk: 7,
    });
  });

  it("skip from failed audits, records and completes", async () => {
    const ctx = makeCtx();
    await failWith(ctx);
    await call("skip", ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "voteit.skip",
        details: expect.objectContaining({
          reason: "notInvited",
          error: expect.any(String),
        }),
      }),
    );
    expect(ctx.writeResultData).toHaveBeenCalledWith("p1", {
      status: "skipped",
      reason: "notInvited",
      at: expect.any(String),
    });
    expect(ctx.setCompleted).toHaveBeenCalledWith({ status: "skipped" });
  });

  it("ignores skip from the kiosk", async () => {
    const ctx = makeCtx("kiosk");
    await failWith(ctx);
    await call("skip", ctx);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(ctx.writeResultData).not.toHaveBeenCalled();
    expect(ctx.setCompleted).not.toHaveBeenCalled();
  });

  it("ignores retry and skip unless the step is failed", async () => {
    for (const attempt of [undefined, { status: "working" }]) {
      const ctx = makeCtx();
      ctx.state.attempt = attempt;
      await call("retry", ctx);
      await call("skip", ctx);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(ctx.setCompleted).not.toHaveBeenCalled();
      expect(ctx.showScreen).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    }
  });

  it("ignores retry and skip when granted", async () => {
    fetchMock.mockResolvedValueOnce(json([mkInvite({ roles: ["pv"] })]));
    const ctx = makeCtx();
    await start(ctx);
    fetchMock.mockClear();
    ctx.showScreen.mockClear();
    ctx.setCompleted.mockClear();
    recordAudit.mockClear();
    await call("retry", ctx);
    await call("skip", ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.showScreen).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(ctx.setCompleted).not.toHaveBeenCalled();
  });

  it("a second skip press after the first is ignored", async () => {
    const ctx = makeCtx();
    await failWith(ctx);
    await call("skip", ctx);
    await call("skip", ctx);
    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });
});

describe("checkConfig", () => {
  const configs = [
    { file: "a.yml", config: { steps: [{ uses: "voteit:grantVoterRole" }] } },
  ];
  it("throws when a voteit step is used and a variable is missing", async () => {
    listStepConfigs.mockResolvedValue(configs);
    vi.stubEnv("VOTEIT_API_KEY", "");
    await expect(checkConfig()).rejects.toThrow(/VOTEIT_BASE_URL/);
  });
  it("passes when configured or when unused", async () => {
    listStepConfigs.mockResolvedValue(configs);
    await expect(checkConfig()).resolves.toBeUndefined();
    vi.stubEnv("VOTEIT_API_KEY", "");
    listStepConfigs.mockResolvedValue([
      { file: "b.yml", config: { steps: [{ uses: "base:x" }] } },
    ]);
    await expect(checkConfig()).resolves.toBeUndefined();
  });
});
