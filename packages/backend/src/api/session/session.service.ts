import type { CheckinSessionModel } from "../../generated/prisma/models.ts";
import { prisma } from "../../prisma.ts";
import { signJWT } from "../../tokens.ts";

export type SessionTokenPayload = {
  sessionId: string;
};

export async function createSession(): Promise<CheckinSessionModel> {
  return await prisma.checkinSession.create({
    data: {},
  });
}

export async function createSessionToken(sessionId: string): Promise<string> {
  return await signJWT({
    "urn:scoutid:sessionId": sessionId,
  });
}
