import { Hono } from "hono";
// import { getCurrentStep } from "../step/step.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionRouter = new Hono().post("/", async (c) => {
  const session = await createSession();
  const token = await createSessionToken(session.id);
  // const currentStep = await getCurrentStep(session);

  return c.json({
    sessionId: session.id,
    token,
    // currentStep,
  });
});
