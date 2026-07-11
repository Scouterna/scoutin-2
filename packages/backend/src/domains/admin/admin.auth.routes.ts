import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import type { AppEnv } from "../../core/websocket/types.ts";
import {
  checkAdminPassword,
  clearAdminSessionCookie,
  setAdminSessionCookie,
} from "./adminAuth.service.ts";

const LoginBody = type({ password: "string" });

export const adminAuthRouter = new Hono<AppEnv>()
  .post("/login", arktypeValidator("json", LoginBody), async (c) => {
    const { password } = c.req.valid("json");

    if (!checkAdminPassword(password)) {
      return c.json({ error: "Invalid password" }, 401);
    }

    await setAdminSessionCookie(c);
    return c.body(null, 204);
  })
  .post("/logout", async (c) => {
    clearAdminSessionCookie(c);
    return c.body(null, 204);
  });
