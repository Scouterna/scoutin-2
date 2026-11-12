import { type } from "arktype";
import { Hono } from "hono";
import {
  activateKiosk,
  authenticateKioskKey,
  getKioskInfo,
} from "./kiosk.service.ts";

const ActivateBody = type({ code: "string > 0", name: "string > 0" });

export const kiosksRouter = new Hono()
  .post("/activate", async (c) => {
    const body = ActivateBody(await c.req.json());
    if (body instanceof type.errors) {
      return c.json({ error: body.summary }, 400);
    }

    const result = await activateKiosk(body.code, body.name);
    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ key: result.key, kioskId: result.kioskId }, 201);
  })
  // Read-only diagnostics for the kiosk's hidden info menu.
  .get("/me", async (c) => {
    const key = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    const kioskId = key ? await authenticateKioskKey(key) : null;
    if (!kioskId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const info = await getKioskInfo(kioskId);
    if (!info) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json(info, 200);
  });
