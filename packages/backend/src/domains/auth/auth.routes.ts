import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import type { AppEnv } from "../../core/websocket/types.ts";
import {
  clearSessionCookie,
  getUserFromContext,
  setSessionCookie,
} from "./auth.service.ts";
import { verifyCredentials } from "./user.service.ts";

const LoginBody = type({ username: "string", password: "string" });

// Auth endpoints, mounted UNGUARDED at /api/admin/auth (see app.ts) so they
// stay reachable without a session. The frontend calls /me to decide whether
// to render the admin UI or redirect to the login page.
export const authRouter = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const user = await getUserFromContext(c);
    return c.json({ user });
  })
  .post("/login", arktypeValidator("json", LoginBody), async (c) => {
    const { username, password } = c.req.valid("json");

    const user = await verifyCredentials(username, password);
    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    await setSessionCookie(c, user.id);
    return c.body(null, 204);
  })
  .post("/logout", (c) => {
    clearSessionCookie(c);
    return c.body(null, 204);
  });
