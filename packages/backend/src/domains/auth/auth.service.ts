import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { jwtVerify, SignJWT } from "jose";
import { JOSEError } from "jose/errors";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import { getLogger } from "../../core/logging/logger.ts";
import type { AppEnv, TypedContext } from "../../core/websocket/types.ts";

// Local admin session: a signed cookie carrying the user id. Reuses the same
// jose/HS256 machinery as the kiosk session tokens (see sessions/tokens.ts),
// with its own issuer/audience so an admin cookie and a kiosk session JWT can
// never be confused for one another.
const TOKEN_SECRET = new TextEncoder().encode(config.TOKEN_SECRET);
const ISSUER = "urn:scoutin:admin-session";
const AUDIENCE = ISSUER;
const EXPIRATION_TIME = "12h";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h, matches EXPIRATION_TIME

export const ADMIN_COOKIE_NAME = "admin_session";

export interface AppUser {
  sub: string;
  username: string;
  roles: string[];
}

async function signSession(userId: string): Promise<string> {
  return await new SignJWT()
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(EXPIRATION_TIME)
    .sign(TOKEN_SECRET);
}

/** Returns the user id from a valid session token, or null. */
async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, TOKEN_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch (e) {
    if (e instanceof JOSEError) return null;
    throw e;
  }
}

export async function setSessionCookie(c: TypedContext, userId: string) {
  const token = await signSession(userId);
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(c: TypedContext) {
  deleteCookie(c, ADMIN_COOKIE_NAME, { path: "/" });
}

/** Resolve the current user from the session cookie. The user is loaded from
 * the DB on every request so roles stay fresh and deleted accounts lose access
 * immediately. Returns null when unauthenticated. */
export async function getUserFromContext(
  c: TypedContext,
): Promise<AppUser | null> {
  const token = getCookie(c, ADMIN_COOKIE_NAME);
  if (!token) return null;

  const userId = await verifySession(token);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  return {
    sub: user.id,
    username: user.username,
    roles: user.roles,
  };
}

/** Guards a route: requires a valid session whose user carries at least one of
 * the given roles. Attaches the resolved user to the context on success, and
 * reuses an already-resolved user so stacked guards don't re-query the DB. */
export function requireAnyRole(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user") ?? (await getUserFromContext(c));

    if (!user) {
      getLogger(c).warn("Rejected request: no valid session");
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!roles.some((role) => user.roles.includes(role))) {
      getLogger(c).warn(
        { sub: user.sub, required: roles },
        "Rejected request: missing required role",
      );
      return c.json({ error: "Forbidden" }, 403);
    }

    c.set("user", user);
    await next();
  };
}

/** Any authenticated admin-panel user (operator or admin). */
export const requireStaff: MiddlewareHandler<AppEnv> = requireAnyRole(
  "admin",
  "operator",
);

/** Admin-only routes (user/kiosk/data/blocklist management). */
export const requireAdmin: MiddlewareHandler<AppEnv> = requireAnyRole("admin");

/** The authenticated user, for handlers that run behind requireStaff/requireAdmin.
 * Throws if no user is set - a broken invariant (guard missing), not a normal
 * condition. Fail loud rather than silently recording an unattributed action. */
export function getAuthUser(c: TypedContext): AppUser {
  const user = c.get("user");
  if (!user) {
    throw new Error(
      "getAuthUser called without an authenticated user - is requireAdmin mounted?",
    );
  }
  return user;
}
