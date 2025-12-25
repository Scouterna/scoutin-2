import { Hono } from "hono";
// import { getNextStep } from "../step/step.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionRouter = new Hono().post("/", async (c) => {
  const session = await createSession();
  const token = await createSessionToken(session.id);
  // const nextStep = await getNextStep(session);

  return c.json({
    sessionId: session.id,
    token,
    // nextStep,
  });
});
