import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Structural subset of Participant.metadata this step reads. The two
// enrichers (safeFromHarm.ts, criminalRecordExtract.ts) always write a
// determinate object under their key, so a missing key here means the
// enricher hasn't run for this person yet (e.g. before their first import
// cycle) rather than "compliant" - handled by the `=== true` checks below,
// which are false for both a missing key and an explicit false.
const Metadata = type({
  "safeFromHarm?": type({ "completed?": "boolean" }),
  "criminalRecordExtract?": type({ "valid?": "boolean" }),
});

/**
 * Compliance gate for the staff self-check-in flow: blocks unless both Safe
 * from Harm (Trygga Möten) and the criminal record extract (registerutdrag)
 * are OK (see enrichers/safeFromHarm.ts, enrichers/criminalRecordExtract.ts
 * for how those statuses are computed at import time). "Block" means route
 * to human handling - the blocked screen offers session:abort, same
 * mechanism used elsewhere for idle-timeout and confirmReCheckin's cancel,
 * plus a `bypass` publicMethod so an admin overseeing the kiosk can
 * override and let the person through anyway (the frontend confirms this
 * with a browser dialog before calling it).
 */
export const complianceGate: StepImplementation = {
  id: "scoutnet:complianceGate",
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

      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: actor.participant.id },
        select: { metadata: true },
      });

      const parsed = Metadata(participant.metadata ?? {});
      // Fail-safe: a parse error blocks rather than silently passing.
      const safeFromHarmOk =
        !(parsed instanceof type.errors) &&
        parsed.safeFromHarm?.completed === true;
      const criminalRecordExtractOk =
        !(parsed instanceof type.errors) &&
        parsed.criminalRecordExtract?.valid === true;

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
