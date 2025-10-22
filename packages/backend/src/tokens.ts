import { SignJWT } from "jose";
import config from "./config.ts";

const TOKEN_SECRET = new TextEncoder().encode(config.TOKEN_SECRET);

const URN_PREFIX = "urn:scoutid:";

const ISSUER = `${URN_PREFIX}backend`;
const AUDIENCE = ISSUER;
const EXPIRATION_TIME = "2h";

type ScopedJWTPayload = {
  [key: `${typeof URN_PREFIX}${string}`]: unknown;
};

export async function signJWT(payload: ScopedJWTPayload): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(EXPIRATION_TIME)
    .sign(TOKEN_SECRET);
}
