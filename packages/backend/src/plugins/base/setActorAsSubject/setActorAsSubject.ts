import { prisma } from "../../../app/prisma.ts";
import type { StepImplementation } from "../../../core/workflow/stepImplementation.ts";

export const setActorAsSubject: StepImplementation = {
  id: "base:setActorAsSubject",
  hooks: {
    async onStepStart(ctx) {
      const currentSession = await prisma.checkinSession.findUnique({
        where: { id: ctx.sessionId },
        include: { actor: true },
      });

      if (!currentSession) {
        throw new Error(`Session with ID ${ctx.sessionId} not found`);
      }

      if (!currentSession.actor?.participantId) {
        // TODO: Handle this gracefully. Assuming this is because it's an
        // administrator, we probably want to let them choose a participant to
        // impersonate.
        throw new Error(
          "No actor associated with session, cannot set actor as subject",
        );
      }

      await ctx.setSubjects({
        participantIds: [currentSession.actor.participantId],
      });

      await ctx.setCompleted();
    },
  },
};
