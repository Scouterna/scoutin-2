import { Hono } from "hono";
import { prisma } from "../../app/prisma.ts";
import { getStepStatuses } from "../workflows/step.service.ts";
import { createSession, createSessionToken } from "./session.service.ts";

export const sessionsAdminRouter = new Hono()
  .post("/", async (c) => {
    const session = await createSession();
    return c.json({ id: session.id }, 201);
  })
  .get("/", async (c) => {
    const sessions = await prisma.checkinSession.findMany({
      include: {
        actor: { include: { participant: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        actorName: s.actor?.participant
          ? `${s.actor.participant.firstName} ${s.actor.participant.lastName}`
          : undefined,
      })),
    });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");

    const session = await prisma.checkinSession.findUnique({
      where: { id },
      include: {
        actor: { include: { participant: true } },
        subjects: { include: { participant: true } },
      },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    let stepStatuses: Awaited<ReturnType<typeof getStepStatuses>>;
    try {
      stepStatuses = await getStepStatuses(session.id);
    } catch (err) {
      console.error(
        "Failed to compute step statuses for session",
        session.id,
        err,
      );
      return c.json({ error: "Failed to load session details" }, 500);
    }

    return c.json({
      id: session.id,
      createdAt: session.createdAt,
      actor: session.actor
        ? {
            firstName: session.actor.participant?.firstName,
            lastName: session.actor.participant?.lastName,
          }
        : undefined,
      subjects: session.subjects.map((s) => ({
        firstName: s.participant.firstName,
        lastName: s.participant.lastName,
      })),
      stepStatuses,
    });
  })
  .post("/:id/token", async (c) => {
    const id = c.req.param("id");

    const session = await prisma.checkinSession.findUnique({ where: { id } });
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const token = await createSessionToken(id);
    return c.json({ token });
  });
