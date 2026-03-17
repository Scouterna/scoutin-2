import { Hono } from "hono";
import { validateKioskKey } from "../kiosks/kiosk.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionRouter = new Hono().post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const key = authHeader.slice(7);
  if (!(await validateKioskKey(key))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = await createSession();
  const token = await createSessionToken(session.id);
  // const currentStep = await getCurrentStep(session);

  return c.json({
    sessionId: session.id,
    token,
    // currentStep,
  });
});
