import { prisma } from "../../app/prisma.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import type { TypedWSContext } from "../../core/websocket/socketRouter.ts";
import type { CheckinSessionModel } from "../../generated/prisma/models.ts";
import { signJWT } from "./tokens.ts";

export type SessionTokenPayload = {
  sessionId: string;
};

const DEFAULT_CONFIG_FILE = "stepConfig.yml";

export async function createSession(options?: {
  configFile?: string;
  params?: Record<string, unknown>;
}): Promise<CheckinSessionModel> {
  // Simulate delay for testing purposes
  // await new Promise((resolve) => setTimeout(resolve, 1500));

  return await prisma.checkinSession.create({
    data: {
      configFile: options?.configFile ?? DEFAULT_CONFIG_FILE,
      params: JSON.parse(JSON.stringify(options?.params ?? {})),
    },
  });
}

export async function createSessionToken(sessionId: string): Promise<string> {
  return await signJWT({
    "urn:scoutid:sessionId": sessionId,
  });
}

export async function abortSession(sessionId: string): Promise<void> {
  // Idempotent, and a no-op if the session already reached a terminal state
  // (completed or already aborted) — avoids clobbering a session that
  // finished in the same window the abort was triggered.
  await prisma.checkinSession.updateMany({
    where: { id: sessionId, completedAt: null, abortedAt: null },
    data: { abortedAt: new Date() },
  });
}

type ParticipantHistoryEntry = {
  sessionId: string;
  createdAt: Date;
  completedAt: Date | null;
  abortedAt: Date | null;
};

type ParticipantContext = {
  id: string;
  firstName: string;
  lastName: string;
  subGroup: string | null;
  confirmedCheckedInAt: Date | null;
  preliminaryCheckedInAt: Date | null;
  importErrors: unknown;
  metadata: unknown;
  history: ParticipantHistoryEntry[];
};

export type SessionContext = {
  actor: ParticipantContext | null;
  group: { name: string; metadata: unknown; importErrors: unknown } | null;
  subjects: ParticipantContext[];
};

/**
 * Recent prior check-ins for a participant, excluding the session this is
 * being requested for. Deliberately unfiltered by import errors/deletion -
 * this is staff-facing history, not a lookup used to drive the flow.
 */
async function getParticipantHistory(
  participantId: string,
  excludeSessionId: string,
): Promise<ParticipantHistoryEntry[]> {
  const rows = await prisma.checkinSubject.findMany({
    where: {
      participantId,
      checkinSessionId: { not: excludeSessionId },
    },
    include: {
      checkinSession: {
        select: {
          id: true,
          createdAt: true,
          completedAt: true,
          abortedAt: true,
        },
      },
    },
    orderBy: { checkinSession: { createdAt: "desc" } },
    take: 3,
  });

  return rows.map((row) => ({
    sessionId: row.checkinSession.id,
    createdAt: row.checkinSession.createdAt,
    completedAt: row.checkinSession.completedAt,
    abortedAt: row.checkinSession.abortedAt,
  }));
}

function toParticipantContext(
  participant: {
    id: string;
    firstName: string;
    lastName: string;
    subGroup: string | null;
    confirmedCheckedInAt: Date | null;
    preliminaryCheckedInAt: Date | null;
    importErrors: unknown;
    metadata: unknown;
  },
  history: ParticipantHistoryEntry[],
): ParticipantContext {
  return {
    id: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    subGroup: participant.subGroup,
    confirmedCheckedInAt: participant.confirmedCheckedInAt,
    preliminaryCheckedInAt: participant.preliminaryCheckedInAt,
    importErrors: participant.importErrors,
    metadata: participant.metadata,
    history,
  };
}

/**
 * Staff-facing enrichment of a session's actor/subjects, intentionally
 * bypassing the import-error/deleted filters that `data.service.ts`'s
 * lookup functions apply for the kiosk flow - staff should see data issues
 * the kiosk hides, not have them silently filtered out.
 */
export async function getSessionContext(
  sessionId: string,
): Promise<SessionContext | null> {
  const session = await prisma.checkinSession.findUnique({
    where: { id: sessionId },
    include: {
      actor: {
        include: { participant: { include: { participantGroup: true } } },
      },
      subjects: { include: { participant: true } },
    },
  });

  if (!session) return null;

  const actorParticipant = session.actor?.participant ?? null;

  const [actorHistory, subjectHistories] = await Promise.all([
    actorParticipant
      ? getParticipantHistory(actorParticipant.id, sessionId)
      : Promise.resolve([]),
    Promise.all(
      session.subjects.map((subject) =>
        getParticipantHistory(subject.participant.id, sessionId),
      ),
    ),
  ]);

  return {
    actor: actorParticipant
      ? toParticipantContext(actorParticipant, actorHistory)
      : null,
    group: actorParticipant?.participantGroup
      ? {
          name: actorParticipant.participantGroup.name,
          metadata: actorParticipant.participantGroup.metadata,
          importErrors: actorParticipant.participantGroup.importErrors,
        }
      : null,
    subjects: session.subjects.map((subject, index) =>
      toParticipantContext(subject.participant, subjectHistories[index] ?? []),
    ),
  };
}

export async function sendSessionInfo(
  sessionId: string,
  ws: TypedWSContext<MessageTypes>,
): Promise<void> {
  const session = await prisma.checkinSession.findUnique({
    where: { id: sessionId },
    include: { actor: { include: { participant: true } } },
  });

  ws.send({
    name: "session:info",
    data: {
      actor: session?.actor?.participant
        ? {
            firstName: session.actor.participant.firstName,
            lastName: session.actor.participant.lastName,
          }
        : null,
    },
  });
}
