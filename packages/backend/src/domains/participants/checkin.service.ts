import { prisma } from "../../app/prisma.ts";

/**
 * Undoes a participant's check-in, making it as if they were never checked in.
 *
 * Check-in state is a durable pair of timestamps on the Participant
 * (`confirmedCheckedInAt` / `preliminaryCheckedInAt`) that does not cascade
 * with sessions, so clearing it is step one. Step progress
 * (CheckinSessionStepData) is per-session, not per-participant: a single groups
 * session can check in several members at once, so we only remove this
 * participant's subject link and delete the whole session (cascading its step
 * data / actor) when they were its sole subject - other members keep their
 * status and history.
 *
 * Throws if the participant does not exist (surfaced as 404 by the route).
 */
export async function undoCheckin(participantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Throws P2025 if the participant does not exist.
    await tx.participant.update({
      where: { id: participantId },
      data: { confirmedCheckedInAt: null, preliminaryCheckedInAt: null },
    });

    const subjectLinks = await tx.checkinSubject.findMany({
      where: { participantId },
      select: { checkinSessionId: true },
    });
    const affectedSessionIds = [
      ...new Set(subjectLinks.map((s) => s.checkinSessionId)),
    ];

    await tx.checkinSubject.deleteMany({ where: { participantId } });

    // A session left with no subjects has nothing to check in, so drop it -
    // this cascades its CheckinSessionStepData and CheckinActor, removing the
    // step progress. Sessions that still have other subjects are left intact.
    for (const sessionId of affectedSessionIds) {
      const remaining = await tx.checkinSubject.count({
        where: { checkinSessionId: sessionId },
      });
      if (remaining === 0) {
        await tx.checkinSession.delete({ where: { id: sessionId } });
      }
    }
  });
}
