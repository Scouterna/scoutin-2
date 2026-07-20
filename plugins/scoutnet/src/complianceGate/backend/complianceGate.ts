import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Structural subset of Participant.metadata this step reads. The two
// enrichers (safeFromHarm.ts, criminalRecordExtract.ts) always write a
// determinate object under their key, so a missing key here means the
// enricher hasn't run for this person yet (e.g. before their first import
// cycle) rather than "compliant" - handled by the `=== true` checks below,
// which are false for both a missing key and an explicit false. The date
// fields (completedAt / shownAt) drive the configurable validity period.
const Metadata = type({
  "safeFromHarm?": type({
    "completed?": "boolean",
    "completedAt?": "string | null",
  }),
  "criminalRecordExtract?": type({
    "valid?": "boolean",
    "shownAt?": "string | null",
  }),
});

/**
 * `with` config for the step:
 * - `safeFromHarmValidYears`: how many years a Trygga Möten completion stays
 *   valid. Defaults to 3 when omitted; set to `null` to disable expiry.
 * - `criminalRecordExtractValidYears`: how many years a registerutdrag stays
 *   valid. Defaults to no expiry (`null`); set a number to enforce one.
 * - `checkDate`: the date (YYYY-MM-DD) validity is checked against, e.g. an
 *   event's end date so records must be valid *until then*. Defaults to today.
 * - `mode`: `single` (default) checks exactly one subject and renders a
 *   single-person screen; `multiple` checks every applicable subject and
 *   renders a list report.
 * - `block`: whether a failure blocks the flow (default `true`). `single`
 *   supports both; `multiple` + `block: true` is not implemented yet and throws.
 * - `subGroups`: only subjects whose `subGroup` is in this list are checked;
 *   others are ignored entirely. Omitted means all subjects are checked. Used
 *   by the groups flow to check only leaders (`[leader, leaderstaff]`), not the
 *   scouts a leader also selects.
 * - `title` / `message`: heading and body text for the `multiple`-mode report
 *   screen. `message` is required in `mode: multiple`; `title` is optional and
 *   falls back to a default heading.
 */
const Inputs = type({
  "safeFromHarmValidYears?": "number | null",
  "criminalRecordExtractValidYears?": "number | null",
  "checkDate?": "string",
  "mode?": "'single' | 'multiple'",
  "block?": "boolean",
  "subGroups?": "string[]",
  "title?": "string",
  "message?": "string",
});

/** Parse a `YYYY-MM-DD` string into a UTC-midnight Date, or null if invalid. */
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Today at UTC midnight, for day-granularity comparisons. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Whether a compliance item is still valid on `checkDate`.
 * - `validYears == null` -> no expiry configured, always current.
 * - a validity period is configured but no date is known -> cannot prove it's
 *   current, so treat as expired (the gate's fail-safe stance).
 * - otherwise valid until `date + validYears` inclusive.
 */
function isWithinValidity(
  date: string | null | undefined,
  validYears: number | null,
  checkDate: Date,
): boolean {
  if (validYears == null) return true;
  if (!date) return false;
  const expiry = parseIsoDate(date);
  if (expiry == null) return false;
  expiry.setUTCFullYear(expiry.getUTCFullYear() + validYears);
  return expiry.getTime() >= checkDate.getTime();
}

type ComplianceResult = {
  safeFromHarmOk: boolean;
  criminalRecordExtractOk: boolean;
};

/**
 * Pure per-participant evaluation: given a participant's raw `metadata` and the
 * validity config, decide whether each requirement is OK. Fail-safe: a parse
 * error (metadata not matching the expected shape) yields both false rather
 * than silently passing.
 */
function evaluateCompliance(
  metadata: unknown,
  safeFromHarmValidYears: number | null,
  criminalRecordExtractValidYears: number | null,
  checkDate: Date,
): ComplianceResult {
  const parsed = Metadata(metadata ?? {});
  const isError = parsed instanceof type.errors;
  const safeFromHarmOk =
    !isError &&
    parsed.safeFromHarm?.completed === true &&
    isWithinValidity(
      parsed.safeFromHarm?.completedAt,
      safeFromHarmValidYears,
      checkDate,
    );
  const criminalRecordExtractOk =
    !isError &&
    parsed.criminalRecordExtract?.valid === true &&
    isWithinValidity(
      parsed.criminalRecordExtract?.shownAt,
      criminalRecordExtractValidYears,
      checkDate,
    );
  return { safeFromHarmOk, criminalRecordExtractOk };
}

/**
 * Compliance gate: blocks or reports unless both Safe from Harm (Trygga Möten)
 * and the criminal record extract (registerutdrag) are OK - which means not
 * just present (see enrichers/safeFromHarm.ts, enrichers/criminalRecordExtract.ts)
 * but also within a configurable validity period (see the Inputs schema above).
 *
 * It always operates on the session's *subjects*, never the actor directly: in
 * the staff self-check-in flow `base:setActorAsSubject` runs first, so the sole
 * subject *is* the actor; in the groups flow the subjects are the selected
 * members (filtered to leaders via `subGroups`). This keeps a single code path
 * for both.
 *
 * `single` + `block` is the classic staff gate: the blocked screen offers
 * session:abort plus a `bypass` publicMethod so an admin can override. `single`
 * / `multiple` without `block` renders an informational screen with a `confirm`
 * publicMethod that just advances. `multiple` + `block` is not implemented yet
 * and throws a clear configuration error.
 */
export const complianceGate: StepImplementation = {
  id: "scoutnet:complianceGate",
  inputs: Inputs,
  publicMethods: {
    bypass: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
    confirm: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
  hooks: {
    async onStepStart(ctx) {
      const inputs = ctx.getInputs() as typeof Inputs.infer;
      const mode = inputs.mode ?? "single";
      const block = inputs.block ?? true;

      // Invalid configuration: rendering a per-person list *and* blocking the
      // flow isn't implemented yet. Fail loud so a misconfigured step is caught
      // immediately rather than silently doing the wrong thing.
      if (mode === "multiple" && block) {
        throw new Error(
          "scoutnet:complianceGate: `mode: multiple` with `block: true` is not implemented yet. " +
            "Use `block: false` for a multi-subject (informational) report, or `mode: single` to block.",
        );
      }

      // Check `undefined` specifically, not `== null`: an omitted value falls
      // back to the 3-year default, but an explicit `null` is a meaningful
      // value here (disable the expiry check), so it must be preserved.
      const safeFromHarmValidYears =
        inputs.safeFromHarmValidYears === undefined
          ? 3
          : inputs.safeFromHarmValidYears;
      const criminalRecordExtractValidYears =
        inputs.criminalRecordExtractValidYears ?? null;

      let checkDate = todayUtc();
      if (inputs.checkDate) {
        const parsed = parseIsoDate(inputs.checkDate);
        if (parsed) {
          checkDate = parsed;
        } else {
          ctx.logger.warn(
            `scoutnet:complianceGate: invalid checkDate "${inputs.checkDate}", falling back to today`,
          );
        }
      }

      const session = await prisma.checkinSession.findUniqueOrThrow({
        where: { id: ctx.sessionId },
        include: {
          subjects: {
            include: {
              participant: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  subGroup: true,
                  metadata: true,
                },
              },
            },
          },
        },
      });

      const subjects = session.subjects.map((s) => s.participant);

      // The single-subject UI shows one person; enforce that invariant on the
      // raw subject list (before the subGroups filter, which is about
      // applicability, not flow shape).
      if (mode === "single" && subjects.length !== 1) {
        throw new Error(
          `scoutnet:complianceGate: mode 'single' expects exactly one subject but found ${subjects.length}. ` +
            "This flow must set the actor (or a single subject) before the gate - see base:setActorAsSubject.",
        );
      }

      // Only these subgroups are subject to the requirements; the rest (e.g.
      // scouts a leader checks in) are ignored entirely.
      const applicable = inputs.subGroups
        ? subjects.filter((p) => inputs.subGroups?.includes(p.subGroup ?? ""))
        : subjects;

      const evaluated = applicable.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        ...evaluateCompliance(
          p.metadata,
          safeFromHarmValidYears,
          criminalRecordExtractValidYears,
          checkDate,
        ),
      }));

      const nonCompliant = evaluated.filter(
        (e) => !(e.safeFromHarmOk && e.criminalRecordExtractOk),
      );

      // Everyone applicable passes (or nobody was applicable) - advance.
      if (nonCompliant.length === 0) {
        await ctx.setCompleted();
        return;
      }

      if (mode === "single") {
        const { safeFromHarmOk, criminalRecordExtractOk } = nonCompliant[0];
        await ctx.showScreen("scoutnet:complianceGate:blocked", {
          block,
          safeFromHarmOk,
          criminalRecordExtractOk,
        });
        return;
      }

      // mode === "multiple" (block is false here, guaranteed by the guard).
      // `message` is mandatory for the report screen; fail loud on a config that
      // omits it rather than showing a report with no explanation.
      if (!inputs.message) {
        throw new Error(
          "scoutnet:complianceGate: `message` is required when `mode: multiple`.",
        );
      }
      await ctx.showScreen("scoutnet:complianceGate:report", {
        subjects: nonCompliant,
        title: inputs.title,
        message: inputs.message,
      });
    },
  },
};
