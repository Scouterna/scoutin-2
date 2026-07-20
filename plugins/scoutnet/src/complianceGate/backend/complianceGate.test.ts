import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrow = vi.fn();

vi.mock("@scouterna/scoutin-backend/plugin-services", () => ({
  prisma: {
    checkinSession: { findUniqueOrThrow },
  },
}));

const { complianceGate } = await import("./complianceGate.ts");

type ParticipantLike = {
  id?: string;
  firstName?: string;
  lastName?: string;
  subGroup?: string | null;
  metadata: unknown;
};

/** Mock the session lookup to return the given subjects (as participants). */
function mockSubjects(participants: ParticipantLike[]) {
  findUniqueOrThrow.mockResolvedValue({
    subjects: participants.map((participant, i) => ({
      participant: {
        id: participant.id ?? `p${i + 1}`,
        firstName: participant.firstName ?? "Alice",
        lastName: participant.lastName ?? "Andersson",
        subGroup: participant.subGroup ?? "leader",
        metadata: participant.metadata,
      },
    })),
  });
}

function makeCtx({ inputs = {} }: { inputs?: Record<string, unknown> } = {}) {
  return {
    sessionId: "session-1",
    getInputs: vi.fn().mockReturnValue(inputs),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    setCompleted: vi.fn(),
    showScreen: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}

// Fixed reference date so tests don't depend on the real clock.
const CHECK_DATE = "2026-07-13";

// Report text: `message` is required in multiple mode, `title` optional.
const TITLE = "Saknar krav";
const MSG = "Följande ledare saknar krav.";

const OK_METADATA = {
  safeFromHarm: { completed: true, completedAt: "2026-01-15" },
  criminalRecordExtract: {
    valid: true,
    shownAt: "2023-01-15",
    source: "scoutnet",
  },
};

beforeEach(() => {
  findUniqueOrThrow.mockReset();
});

describe("scoutnet:complianceGate", () => {
  describe("single mode (default, blocking)", () => {
    it("completes silently when both Safe from Harm and the criminal record extract are OK", async () => {
      mockSubjects([{ metadata: OK_METADATA }]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
      expect(ctx.showScreen).not.toHaveBeenCalled();
    });

    it("blocks and names Safe from Harm when only it has failed", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: false, completedAt: null },
            criminalRecordExtract: {
              valid: true,
              shownAt: null,
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).not.toHaveBeenCalled();
      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: false, criminalRecordExtractOk: true },
      );
    });

    it("blocks and names the criminal record extract when only it has failed", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2026-01-15" },
            criminalRecordExtract: {
              valid: false,
              shownAt: null,
              source: null,
            },
          },
        },
      ]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: true, criminalRecordExtractOk: false },
      );
    });

    it("blocks on both when metadata is entirely missing (never enriched yet)", async () => {
      mockSubjects([{ metadata: null }]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).not.toHaveBeenCalled();
      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: false, criminalRecordExtractOk: false },
      );
    });

    it("blocks (fail-safe) when metadata doesn't match the expected shape", async () => {
      mockSubjects([{ metadata: { safeFromHarm: "not-an-object" } }]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).not.toHaveBeenCalled();
      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: false, criminalRecordExtractOk: false },
      );
    });

    it("throws when the flow left more than one subject", async () => {
      mockSubjects([{ metadata: OK_METADATA }, { metadata: OK_METADATA }]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await expect(complianceGate.hooks?.onStepStart?.(ctx)).rejects.toThrow(
        /expects exactly one subject/,
      );
    });
  });

  describe("single mode, non-blocking", () => {
    it("shows the informational single screen (block: false) on failure", async () => {
      mockSubjects([{ metadata: null }]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE, block: false } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: false, safeFromHarmOk: false, criminalRecordExtractOk: false },
      );
    });
  });

  describe("multiple mode (informational report)", () => {
    it("throws when block is true (not implemented)", async () => {
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, mode: "multiple", block: true },
      });

      await expect(complianceGate.hooks?.onStepStart?.(ctx)).rejects.toThrow(
        /not implemented/,
      );
    });

    it("reports only the non-compliant subjects", async () => {
      mockSubjects([
        { firstName: "Ok", lastName: "Person", metadata: OK_METADATA },
        {
          firstName: "Bad",
          lastName: "One",
          metadata: {
            safeFromHarm: { completed: false, completedAt: null },
            criminalRecordExtract: {
              valid: false,
              shownAt: null,
              source: null,
            },
          },
        },
      ]);
      const ctx = makeCtx({
        inputs: {
          checkDate: CHECK_DATE,
          mode: "multiple",
          block: false,
          title: TITLE,
          message: MSG,
        },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).not.toHaveBeenCalled();
      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:report",
        {
          title: TITLE,
          message: MSG,
          subjects: [
            {
              firstName: "Bad",
              lastName: "One",
              safeFromHarmOk: false,
              criminalRecordExtractOk: false,
            },
          ],
        },
      );
    });

    it("throws when message is missing", async () => {
      mockSubjects([{ metadata: null }]);
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, mode: "multiple", block: false },
      });

      await expect(complianceGate.hooks?.onStepStart?.(ctx)).rejects.toThrow(
        /`message` is required/,
      );
    });

    it("completes silently when every applicable subject passes", async () => {
      mockSubjects([{ metadata: OK_METADATA }, { metadata: OK_METADATA }]);
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, mode: "multiple", block: false },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
      expect(ctx.showScreen).not.toHaveBeenCalled();
    });
  });

  describe("subGroups filter", () => {
    it("ignores subjects outside the configured subgroups", async () => {
      mockSubjects([
        { firstName: "Leader", subGroup: "leader", metadata: OK_METADATA },
        // A non-compliant scout: must NOT block or appear in the report.
        { firstName: "Scout", subGroup: "member", metadata: null },
      ]);
      const ctx = makeCtx({
        inputs: {
          checkDate: CHECK_DATE,
          mode: "multiple",
          block: false,
          subGroups: ["leader", "leaderstaff"],
        },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
      expect(ctx.showScreen).not.toHaveBeenCalled();
    });

    it("reports a non-compliant leader while ignoring a non-compliant scout", async () => {
      mockSubjects([
        {
          firstName: "Leader",
          lastName: "Bad",
          subGroup: "leader",
          metadata: null,
        },
        {
          firstName: "Scout",
          lastName: "Bad",
          subGroup: "member",
          metadata: null,
        },
      ]);
      const ctx = makeCtx({
        inputs: {
          checkDate: CHECK_DATE,
          mode: "multiple",
          block: false,
          subGroups: ["leader", "leaderstaff"],
          message: MSG,
        },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:report",
        {
          title: undefined,
          message: MSG,
          subjects: [
            {
              firstName: "Leader",
              lastName: "Bad",
              safeFromHarmOk: false,
              criminalRecordExtractOk: false,
            },
          ],
        },
      );
    });
  });

  describe("public methods", () => {
    it("completes the step when bypass is called", async () => {
      const ctx = makeCtx();

      await complianceGate.publicMethods?.bypass?.handler(ctx, undefined);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("completes the step when confirm is called", async () => {
      const ctx = makeCtx();

      await complianceGate.publicMethods?.confirm?.handler(ctx, undefined);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe("validity periods", () => {
    it("blocks Safe from Harm when the completion is older than the default 3 years", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2023-01-15" },
            criminalRecordExtract: {
              valid: true,
              shownAt: "2026-01-15",
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: false, criminalRecordExtractOk: true },
      );
    });

    it("keeps Safe from Harm valid on the exact expiry date (inclusive)", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2023-07-13" },
            criminalRecordExtract: {
              valid: true,
              shownAt: null,
              source: "scoutnet",
            },
          },
        },
      ]);
      // 2023-07-13 + 3 years = 2026-07-13 == checkDate.
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("treats registerutdrag as valid regardless of age when no expiry is configured", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2026-01-15" },
            criminalRecordExtract: {
              valid: true,
              shownAt: "2010-01-15",
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("blocks registerutdrag shown too long ago once an expiry is configured", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2026-01-15" },
            criminalRecordExtract: {
              valid: true,
              shownAt: "2023-01-15",
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, criminalRecordExtractValidYears: 1 },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: true, criminalRecordExtractOk: false },
      );
    });

    it("blocks when an expiry is configured but the date is unknown", async () => {
      mockSubjects([
        {
          metadata: {
            // Backfill entry: completed but no completion date on file.
            safeFromHarm: { completed: true, completedAt: null },
            criminalRecordExtract: {
              valid: true,
              shownAt: "2026-01-15",
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({ inputs: { checkDate: CHECK_DATE } });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "scoutnet:complianceGate:blocked",
        { block: true, safeFromHarmOk: false, criminalRecordExtractOk: true },
      );
    });

    it("can disable the Safe from Harm expiry with an explicit null", async () => {
      mockSubjects([
        {
          metadata: {
            safeFromHarm: { completed: true, completedAt: "2010-01-15" },
            criminalRecordExtract: {
              valid: true,
              shownAt: null,
              source: "scoutnet",
            },
          },
        },
      ]);
      const ctx = makeCtx({
        inputs: { checkDate: CHECK_DATE, safeFromHarmValidYears: null },
      });

      await complianceGate.hooks?.onStepStart?.(ctx);

      expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
    });
  });
});
