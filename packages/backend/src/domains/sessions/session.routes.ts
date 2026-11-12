import { Hono } from "hono";
import { prisma } from "../../app/prisma.ts";
import { readBearerToken } from "../../core/auth/secrets.ts";
import { authenticateKioskKey } from "../kiosks/kiosk.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionRouter = new Hono()
  .post("/", async (c) => {
    const key = readBearerToken(c.req.header("Authorization"));
    if (!key) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const kioskId = await authenticateKioskKey(key);
    if (!kioskId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const session = await createSession({ kioskId });
    const token = await createSessionToken(session.id);

    return c.json({ sessionId: session.id, token });
  })
  .post("/from-link", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);
    const linkId = body?.linkId;
    if (typeof linkId !== "string") {
      return c.json({ error: "linkId is required" }, 400);
    }

    const link = await prisma.checkinLink.findUnique({ where: { id: linkId } });
    if (!link) {
      return c.json({ error: "Link not found" }, 404);
    }

    const session = await createSession({
      configFile: link.configFile,
      params: link.params as Record<string, unknown>,
    });
    const token = await createSessionToken(session.id);

    return c.json({ sessionId: session.id, token });
  });
