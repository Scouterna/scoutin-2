import { Hono } from "hono";
import { prisma } from "../../app/prisma.ts";
import { getStepStatuses } from "../workflows/step.service.ts";

export const sessionsAdminRouter = new Hono()
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

    const stepStatuses = await getStepStatuses(session.id);

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
  });
