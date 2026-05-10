import { type } from "arktype";
import type { JWTPayload } from "hono/utils/jwt/types";
import { jwtVerify, SignJWT } from "jose";
import { JOSEError } from "jose/errors";
import config from "../../config/config.ts";

const TOKEN_SECRET = new TextEncoder().encode(config.TOKEN_SECRET);

const URN_PREFIX = "urn:scoutid:";

const ISSUER = `${URN_PREFIX}backend`;
const AUDIENCE = ISSUER;
const EXPIRATION_TIME = "2h";

const TokenPayload = type({
  [`${URN_PREFIX}sessionId`]: "string",
});
type TokenPayload = typeof TokenPayload.infer;

export async function signJWT(payload: TokenPayload): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(EXPIRATION_TIME)
    .sign(TOKEN_SECRET);
}

export async function verifyJWT(token: string): Promise<
  | {
      valid: true;
      payload: JWTPayload & TokenPayload;
    }
  | {
      valid: false;
    }
> {
  try {
    const verified = await jwtVerify(token, TOKEN_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const payload = TokenPayload(verified.payload);
    if (payload instanceof type.errors) {
      return { valid: false };
    }

    return {
      valid: true,
      payload,
    };
  } catch (e) {
    if (e instanceof JOSEError) {
      return { valid: false };
    }

    throw e;
  }
}
