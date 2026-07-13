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
 */
const Inputs = type({
  "safeFromHarmValidYears?": "number | null",
  "criminalRecordExtractValidYears?": "number | null",
  "checkDate?": "string",
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

/**
 * Compliance gate for the staff self-check-in flow: blocks unless both Safe
 * from Harm (Trygga Möten) and the criminal record extract (registerutdrag)
 * are OK - which now means not just present (see enrichers/safeFromHarm.ts,
 * enrichers/criminalRecordExtract.ts) but also within a configurable validity
 * period (see the Inputs schema above). "Block" means route to human
 * handling - the blocked screen offers session:abort, same mechanism used
 * elsewhere for idle-timeout and confirmReCheckin's cancel, plus a `bypass`
 * publicMethod so an admin overseeing the kiosk can override and let the
 * person through anyway (the frontend confirms this with a browser dialog
 * before calling it).
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
  },
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting scoutnet:complianceGate step",
        );
      }

      const inputs = ctx.getInputs() as typeof Inputs.infer;
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

      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: actor.participant.id },
        select: { metadata: true },
      });

      const parsed = Metadata(participant.metadata ?? {});
      const isError = parsed instanceof type.errors;
      // Fail-safe: a parse error blocks rather than silently passing.
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

      if (safeFromHarmOk && criminalRecordExtractOk) {
        await ctx.setCompleted();
        return;
      }

      await ctx.showScreen("scoutnet:complianceGate:blocked", {
        safeFromHarmOk,
        criminalRecordExtractOk,
      });
    },
  },
};
