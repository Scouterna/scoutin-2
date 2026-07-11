import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrow = vi.fn();

vi.mock("@scouterna/scoutin-backend/plugin-services", () => ({
  prisma: {
    participant: { findUniqueOrThrow },
  },
}));

const { complianceGate } = await import("./complianceGate.ts");

const actor = {
  actor: { id: "actor-1" },
  participant: {
    id: "p1",
    firstName: "Alice",
    lastName: "Andersson",
    dataSource: "staff",
  },
};

function makeCtx({
  getActor = vi.fn().mockResolvedValue(actor),
}: {
  getActor?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getActor,
    setCompleted: vi.fn(),
    showScreen: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}

beforeEach(() => {
  findUniqueOrThrow.mockReset();
});

describe("scoutnet:complianceGate", () => {
  it("completes silently when both Safe from Harm and the criminal record extract are OK", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: {
        safeFromHarm: { completed: true, completedAt: "2026-01-15" },
        criminalRecordExtract: { valid: true, source: "scoutnet" },
      },
    });
    const ctx = makeCtx();

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.showScreen).not.toHaveBeenCalled();
  });

  it("blocks and names Safe from Harm when only it has failed", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: {
        safeFromHarm: { completed: false, completedAt: null },
        criminalRecordExtract: { valid: true, source: "scoutnet" },
      },
    });
    const ctx = makeCtx();

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenCalledWith(
      "scoutnet:complianceGate:blocked",
      { safeFromHarmOk: false, criminalRecordExtractOk: true },
    );
  });

  it("blocks and names the criminal record extract when only it has failed", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: {
        safeFromHarm: { completed: true, completedAt: "2026-01-15" },
        criminalRecordExtract: { valid: false, source: null },
      },
    });
    const ctx = makeCtx();

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "scoutnet:complianceGate:blocked",
      { safeFromHarmOk: true, criminalRecordExtractOk: false },
    );
  });

  it("blocks on both when metadata is entirely missing (never enriched yet)", async () => {
    findUniqueOrThrow.mockResolvedValue({ metadata: null });
    const ctx = makeCtx();

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenCalledWith(
      "scoutnet:complianceGate:blocked",
      { safeFromHarmOk: false, criminalRecordExtractOk: false },
    );
  });

  it("blocks (fail-safe) when metadata doesn't match the expected shape", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: { safeFromHarm: "not-an-object" },
    });
    const ctx = makeCtx();

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenCalledWith(
      "scoutnet:complianceGate:blocked",
      { safeFromHarmOk: false, criminalRecordExtractOk: false },
    );
  });

  it("throws when there is no actor in context", async () => {
    const ctx = makeCtx({ getActor: vi.fn().mockResolvedValue(null) });

    await expect(complianceGate.hooks?.onStepStart?.(ctx)).rejects.toThrow(
      /No actor found/,
    );
  });

  it("completes the step when bypass is called", async () => {
    const ctx = makeCtx();

    await complianceGate.publicMethods?.bypass?.handler(ctx, undefined);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });
});
