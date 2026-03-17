import { Hono } from "hono";
import { createKioskSetupToken, listKiosks } from "./kiosk.service.ts";

export const kiosksAdminRouter = new Hono()
  .get("/", async (c) => {
    const kiosks = await listKiosks();
    return c.json({ kiosks });
  })
  .post("/", async (c) => {
    const { code, expiresAt } = await createKioskSetupToken();
    return c.json({ code, expiresAt }, 201);
  });
