import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";

export const confirmReCheckin: StepImplementation = {
  id: "base:confirmReCheckin",
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting confirmReCheckin step",
        );
      }

      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: actor.participant.id },
        select: { confirmedCheckedInAt: true },
      });

      if (participant.confirmedCheckedInAt == null) {
        // Not previously checked in - nothing to confirm.
        await ctx.setCompleted();
        return;
      }

      await ctx.showScreen("base:confirmReCheckin:confirm", {
        checkedInAt: participant.confirmedCheckedInAt.toISOString(),
      });
    },
  },
  publicMethods: {
    confirm: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
};
