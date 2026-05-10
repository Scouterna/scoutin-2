import { Hono } from "hono";
import { prisma } from "../../app/prisma.ts";
import { validateKioskKey } from "../kiosks/kiosk.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionRouter = new Hono()
  .post("/", async (c) => {
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
