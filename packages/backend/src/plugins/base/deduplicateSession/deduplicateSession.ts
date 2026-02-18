import { prisma } from "../../../app/prisma.ts";
import type { StepImplementation } from "../../../core/workflow/stepImplementation.ts";
import { typedMethod } from "../../../plugin-utils/implementation.ts";

export const deduplicateSession: StepImplementation = {
  id: "base:deduplicateSession",
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
        // No actor associated with the session, so no deduplication needed.
        console.log("No actor associated with session, skipping deduplication");
        await ctx.setCompleted();
        return;
      }

      const sessions = await prisma.checkinSession.findMany({
        where: {
          actor: {
            participantId: currentSession.actor?.participantId,
          },
        },
      });

      if (sessions.length > 1) {
        await ctx.showScreen("base:deduplicateSession:startOverPrompt");
        return;
      }

      console.log("alles gut");
      await ctx.setCompleted();
    },
  },
  publicMethods: {
    startOver: typedMethod({
      async handler(ctx) {
        const currentSession = await prisma.checkinSession.findUnique({
          where: { id: ctx.sessionId },
          include: { actor: true },
        });

        if (!currentSession) {
          throw new Error(`Session with ID ${ctx.sessionId} not found`);
        }

        // Delete all other sessions for the same participant
        await prisma.checkinSession.deleteMany({
          where: {
            actor: { participantId: currentSession.actor?.participantId },
            NOT: { id: ctx.sessionId },
          },
        });

        await ctx.setCompleted();
      },
    }),
    continue: typedMethod({
      async handler(ctx) {
        const currentSession = await prisma.checkinSession.findUnique({
          where: { id: ctx.sessionId },
          include: { actor: true },
        });

        if (!currentSession) {
          throw new Error(`Session with ID ${ctx.sessionId} not found`);
        }

        const newestPreviousSession = await prisma.checkinSession.findFirst({
          where: {
            actor: { participantId: currentSession.actor?.participantId },
            NOT: { id: ctx.sessionId },
          },
          orderBy: { createdAt: "desc" },
        });

        if (!newestPreviousSession) {
          throw new Error(
            `No previous session found for participant ${currentSession.actor?.participantId}`,
          );
        }

        // Delete all other sessions for the same participant
        await prisma.checkinSession.deleteMany({
          where: {
            actor: { participantId: currentSession.actor?.participantId },
            NOT: { id: newestPreviousSession.id },
          },
        });

        ctx.overrideSession(newestPreviousSession.id);

        await ctx.setCompleted();
      },
    }),
  },
};
