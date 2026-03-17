import { type } from "arktype";
import { Hono } from "hono";
import { activateKiosk } from "./kiosk.service.ts";

const ActivateBody = type({ code: "string > 0", name: "string > 0" });

export const kiosksRouter = new Hono().post("/activate", async (c) => {
  const body = ActivateBody(await c.req.json());
  if (body instanceof type.errors) {
    return c.json({ error: body.summary }, 400);
  }

  const result = await activateKiosk(body.code, body.name);
  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ key: result.key, kioskId: result.kioskId }, 201);
});
