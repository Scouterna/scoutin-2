import {
  NO_IMPORT_ERROR_WHERE,
  prisma,
} from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";

export const markConfirmedCheckedIn: StepImplementation = {
  id: "base:markConfirmedCheckedIn",
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
                    include: {
                      participants: {
                        select: { id: true },
                        where: { deletedAt: null, ...NO_IMPORT_ERROR_WHERE },
                      },
                    },
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
          data: { confirmedCheckedInAt: new Date() },
        }),
        prisma.participant.updateMany({
          where: { id: { in: unselectedGroupIds } },
          data: { confirmedCheckedInAt: null },
        }),
      ]);

      await ctx.setCompleted();
    },
  },
};
