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
