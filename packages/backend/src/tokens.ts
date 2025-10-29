import { SignJWT, jwtVerify } from "jose";
import config from "./config.ts";
import type { JWTPayload } from "hono/utils/jwt/types";
import { error } from "console";
import { JWSInvalid } from "jose/errors";

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

export async function verifyJWT(token: string): Promise<
  | {
      valid: true;
      payload: JWTPayload & ScopedJWTPayload;
    }
  | {
      valid: false;
    }
> {
  try {
    const { payload } = await jwtVerify<ScopedJWTPayload>(token, TOKEN_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    return {
      valid: true,
      payload,
    };
  } catch (e) {
    if (e instanceof JWSInvalid) {
      return {
        valid: false,
      };
    }

    throw e;
  }
}
