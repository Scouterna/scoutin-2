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
  inputs = {},
}: {
  getActor?: ReturnType<typeof vi.fn>;
  inputs?: Record<string, unknown>;
} = {}) {
  return {
    getActor,
    getInputs: vi.fn().mockReturnValue(inputs),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    setCompleted: vi.fn(),
    showScreen: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}

// Fixed reference date so tests don't depend on the real clock.
const CHECK_DATE = "2026-07-13";

beforeEach(() => {
  findUniqueOrThrow.mockReset();
});

describe("scoutnet:complianceGate", () => {
  it("completes silently when both Safe from Harm and the criminal record extract are OK", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: {
        safeFromHarm: { completed: true, completedAt: "2026-01-15" },
        criminalRecordExtract: {
          valid: true,
          shownAt: "2023-01-15",
          source: "scoutnet",
        },
      },
    });
    const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.showScreen).not.toHaveBeenCalled();
  });

  it("blocks and names Safe from Harm when only it has failed", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: {
        safeFromHarm: { completed: false, completedAt: null },
        criminalRecordExtract: {
          valid: true,
          shownAt: null,
          source: "scoutnet",
        },
      },
    });
    const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

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
        criminalRecordExtract: { valid: false, shownAt: null, source: null },
      },
    });
    const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

    await complianceGate.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "scoutnet:complianceGate:blocked",
      { safeFromHarmOk: true, criminalRecordExtractOk: false },
    );
  });

  it("blocks on both when metadata is entirely missing (never enriched yet)", async () => {
    findUniqueOrThrow.mockResolvedValue({ metadata: null });
    const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

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
    const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

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

  describe("validity periods", () => {
    it("blocks Safe from Harm when the completion is older than the default 3 years", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          safeFromHarm: { completed: true, completedAt: "2023-01-15" },
          criminalRecordExtract: {
            valid: true,
            shownAt: "2026-01-15",
            source: "scoutnet",
          },
        },
      });
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { safeFromHarmOk: false, criminalRecordExtractOk: true },
      );
    });

    it("keeps Safe from Harm valid on the exact expiry date (inclusive)", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          safeFromHarm: { completed: true, completedAt: "2023-07-13" },
          criminalRecordExtract: {
            valid: true,
            shownAt: null,
            source: "scoutnet",
          },
        },
      });
      // 2023-07-13 + 3 years = 2026-07-13 == checkDate.
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("treats registerutdrag as valid regardless of age when no expiry is configured", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          safeFromHarm: { completed: true, completedAt: "2026-01-15" },
          criminalRecordExtract: {
            valid: true,
            shownAt: "2010-01-15",
            source: "scoutnet",
          },
        },
      });
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("blocks registerutdrag shown too long ago once an expiry is configured", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          safeFromHarm: { completed: true, completedAt: "2026-01-15" },
          criminalRecordExtract: {
            valid: true,
            shownAt: "2023-01-15",
            source: "scoutnet",
          },
        },
      });
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, criminalRecordExtractValidYears: 1 },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { safeFromHarmOk: true, criminalRecordExtractOk: false },
      );
    });

    it("blocks when an expiry is configured but the date is unknown", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          // Backfill entry: completed but no completion date on file.
          safeFromHarm: { completed: true, completedAt: null },
          criminalRecordExtract: {
            valid: true,
            shownAt: "2026-01-15",
            source: "scoutnet",
          },
        },
      });
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { safeFromHarmOk: false, criminalRecordExtractOk: true },
      );
    });

    it("can disable the Safe from Harm expiry with an explicit null", async () => {
      findUniqueOrThrow.mockResolvedValue({
        metadata: {
          safeFromHarm: { completed: true, completedAt: "2010-01-15" },
          criminalRecordExtract: {
            valid: true,
            shownAt: null,
            source: "scoutnet",
          },
        },
      });
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, safeFromHarmValidYears: null },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });
  });
});
