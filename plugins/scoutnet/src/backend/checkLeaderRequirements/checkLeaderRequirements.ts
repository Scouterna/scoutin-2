import { createHash } from "node:crypto";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { typedMethod } from "@scouterna/scoutin-plugin-api/backend";

function hasWarningForParticipant(participantId: string): boolean {
  const hash = createHash("sha256").update(participantId).digest("hex");
  // Use the first byte of the hash to get a stable 50/50 split
  return Number.parseInt(hash[0], 16) < 8;
}

export const checkLeaderRequirements: StepImplementation = {
  id: "scoutnet:checkLeaderRequirements",
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();
      const hasWarning = actor
        ? hasWarningForParticipant(actor.participant.id)
        : false;

      if (!hasWarning) {
        await ctx.setCompleted();
        return;
      }

      await ctx.showScreen("scoutnet:checkLeaderRequirements:warning");
    },
  },
  publicMethods: {
    confirm: typedMethod({
      async handler(ctx) {
        await ctx.setCompleted();
      },
    }),
  },
};
