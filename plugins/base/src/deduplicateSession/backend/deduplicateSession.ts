import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { typedMethod } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

async function doStartOver(ctx: StepMethodContext) {
  const currentSession = await prisma.checkinSession.findUnique({
    where: { id: ctx.sessionId },
    include: { actor: true },
  });

  if (!currentSession) {
    throw new Error(`Session with ID ${ctx.sessionId} not found`);
  }

  await prisma.checkinSession.deleteMany({
    where: {
      actor: { participantId: currentSession.actor?.participantId },
      NOT: { id: ctx.sessionId },
    },
  });

  await ctx.setCompleted();
}

async function doResume(ctx: StepMethodContext) {
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

  await prisma.checkinSession.deleteMany({
    where: {
      actor: { participantId: currentSession.actor?.participantId },
      NOT: { id: newestPreviousSession.id },
    },
  });

  ctx.overrideSession(newestPreviousSession.id);

  await ctx.setCompleted();
}

export const deduplicateSession: StepImplementation = {
  id: "base:deduplicateSession",
  inputs: type({
    "force?": "'new' | 'resume'",
  }),
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
        console.log("No actor associated with session, skipping deduplication");
        await ctx.setCompleted();
        return;
      }

      const sessions = await prisma.checkinSession.findMany({
        where: {
          actor: {
            participantId: currentSession.actor.participantId,
          },
        },
      });

      if (sessions.length <= 1) {
        await ctx.setCompleted();
        return;
      }

      const { force } = ctx.getInputs();

      if (force === "new") {
        await doStartOver(ctx);
      } else if (force === "resume") {
        await doResume(ctx);
      } else {
        await ctx.showScreen("base:deduplicateSession:startOverPrompt");
      }
    },
  },
  publicMethods: {
    startOver: typedMethod({
      async handler(ctx) {
        await doStartOver(ctx);
      },
    }),
    continue: typedMethod({
      async handler(ctx) {
        await doResume(ctx);
      },
    }),
  },
};
