import { type } from "arktype";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { jwtVerify, SignJWT } from "jose";
import { JOSEError } from "jose/errors";
import config from "../../config/config.ts";
import { getLogger } from "../../core/logging/logger.ts";
import type { AppEnv, TypedContext } from "../../core/websocket/types.ts";

// Single shared admin password (no per-user accounts) - reuses the same
// jose/HS256 JWT machinery as session tokens (see sessions/tokens.ts), just
// with its own claim/issuer so an admin cookie and a kiosk session JWT can
// never be confused for one another.
const TOKEN_SECRET = new TextEncoder().encode(config.TOKEN_SECRET);
const ISSUER = "urn:scoutid:admin-backend";
const AUDIENCE = ISSUER;
const EXPIRATION_TIME = "12h";

export const ADMIN_COOKIE_NAME = "admin_session";

const AdminTokenPayload = type({ "urn:scoutid:admin": "true" });

export function checkAdminPassword(password: string): boolean {
  return password === config.ADMIN_PASSWORD;
}

async function signAdminToken(): Promise<string> {
  return await new SignJWT({ "urn:scoutid:admin": true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(EXPIRATION_TIME)
    .sign(TOKEN_SECRET);
}

async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const verified = await jwtVerify(token, TOKEN_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return !(AdminTokenPayload(verified.payload) instanceof type.errors);
  } catch (e) {
    if (e instanceof JOSEError) return false;
    throw e;
  }
}

export async function setAdminSessionCookie(c: TypedContext) {
  const token = await signAdminToken();
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h, matches EXPIRATION_TIME above
  });
}

export function clearAdminSessionCookie(c: TypedContext) {
  deleteCookie(c, ADMIN_COOKIE_NAME, { path: "/" });
}

/** Guards every route it's applied to - 401s unless a valid admin session
 * cookie is present. Mount on the authenticated admin router only; the
 * login/logout routes themselves must stay outside it. */
export const requireAdminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, ADMIN_COOKIE_NAME);

  if (!token || !(await verifyAdminToken(token))) {
    getLogger(c).warn("Rejected admin request: missing or invalid session");
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
