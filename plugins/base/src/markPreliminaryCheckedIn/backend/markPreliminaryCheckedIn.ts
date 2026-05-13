import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";

export const markPreliminaryCheckedIn: StepImplementation = {
  id: "base:markPreliminaryCheckedIn",
  hooks: {
    async onStepStart(ctx) {
      const session = await prisma.checkinSession.findUniqueOrThrow({
        where: { id: ctx.sessionId },
        include: {
          subjects: { select: { participantId: true } },
          actor: {
            include: {
              participant: {
                include: {
                  participantGroup: {
                    include: { participants: { select: { id: true } } },
                  },
                },
              },
            },
          },
        },
      });

      const selectedIds = session.subjects.map((s) => s.participantId);
      const selectedSet = new Set(selectedIds);
      const groupIds =
        session.actor?.participant?.participantGroup?.participants.map(
          (p) => p.id,
        ) ?? [];
      const unselectedGroupIds = groupIds.filter((id) => !selectedSet.has(id));

      await prisma.$transaction([
        prisma.participant.updateMany({
          where: { id: { in: selectedIds } },
          data: { preliminaryCheckedInAt: new Date() },
        }),
        prisma.participant.updateMany({
          where: { id: { in: unselectedGroupIds } },
          data: { preliminaryCheckedInAt: null },
        }),
      ]);

      await ctx.setCompleted();
    },
  },
};
