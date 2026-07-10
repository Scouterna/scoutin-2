import { beforeEach, describe, expect, it, vi } from "vitest";

const checkinSessionFindUnique = vi.fn();
const checkinSubjectFindMany = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    checkinSession: {
      findUnique: checkinSessionFindUnique,
    },
    checkinSubject: {
      findMany: checkinSubjectFindMany,
    },
  },
}));

// session.service.ts imports tokens.ts (for createSessionToken), which reads
// config.TOKEN_SECRET at module scope - avoid depending on a real env var.
vi.mock("../../config/config.ts", () => ({
  default: { TOKEN_SECRET: "test-secret" },
}));

const { getSessionContext } = await import("./session.service.ts");

beforeEach(() => {
  vi.clearAllMocks();
  checkinSubjectFindMany.mockResolvedValue([]);
});

describe("getSessionContext", () => {
  it("returns null when the session doesn't exist", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce(null);

    expect(await getSessionContext("missing")).toBeNull();
  });

  it("returns null actor/group and empty subjects for a session with neither set yet", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce({
      id: "s1",
      actor: null,
      subjects: [],
    });

    expect(await getSessionContext("s1")).toEqual({
      actor: null,
      group: null,
      subjects: [],
    });
  });

  it("includes the actor's import errors and metadata unfiltered (unlike kiosk lookups)", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce({
      id: "s1",
      actor: {
        participant: {
          id: "p1",
          firstName: "Alice",
          lastName: "Andersson",
          subGroup: "Vargarna",
          confirmedCheckedInAt: null,
          preliminaryCheckedInAt: null,
          importErrors: { provider: "invalid raw data" },
          metadata: { village: "By 5" },
          participantGroup: null,
        },
      },
      subjects: [],
    });

    const context = await getSessionContext("s1");

    expect(context?.actor).toMatchObject({
      id: "p1",
      importErrors: { provider: "invalid raw data" },
      metadata: { village: "By 5" },
    });
  });

  it("surfaces the actor's participant group, including its import errors", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce({
      id: "s1",
      actor: {
        participant: {
          id: "p1",
          firstName: "Alice",
          lastName: "Andersson",
          subGroup: null,
          confirmedCheckedInAt: null,
          preliminaryCheckedInAt: null,
          importErrors: null,
          metadata: null,
          participantGroup: {
            name: "Kår 5",
            metadata: { village: "By 5" },
            importErrors: { "stormote6:villageLookup": "lookup failed" },
          },
        },
      },
      subjects: [],
    });

    const context = await getSessionContext("s1");

    expect(context?.group).toEqual({
      name: "Kår 5",
      metadata: { village: "By 5" },
      importErrors: { "stormote6:villageLookup": "lookup failed" },
    });
  });

  it("includes each subject with their own prior check-in history, excluding the current session", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce({
      id: "s1",
      actor: null,
      subjects: [
        {
          participant: {
            id: "p1",
            firstName: "Bo",
            lastName: "Karlsson",
            subGroup: null,
            confirmedCheckedInAt: new Date("2026-07-10T10:00:00Z"),
            preliminaryCheckedInAt: null,
            importErrors: null,
            metadata: null,
          },
        },
      ],
    });
    checkinSubjectFindMany.mockResolvedValueOnce([
      {
        checkinSession: {
          id: "prior-session",
          createdAt: new Date("2026-05-13T10:00:00Z"),
          completedAt: new Date("2026-05-13T10:05:00Z"),
          abortedAt: null,
        },
      },
    ]);

    const context = await getSessionContext("s1");

    expect(checkinSubjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantId: "p1", checkinSessionId: { not: "s1" } },
      }),
    );
    expect(context?.subjects).toHaveLength(1);
    expect(context?.subjects[0]).toMatchObject({
      id: "p1",
      history: [
        {
          sessionId: "prior-session",
          completedAt: new Date("2026-05-13T10:05:00Z"),
          abortedAt: null,
        },
      ],
    });
  });

  it("keeps each subject's history independent of the others", async () => {
    checkinSessionFindUnique.mockResolvedValueOnce({
      id: "s1",
      actor: null,
      subjects: [
        {
          participant: {
            id: "p1",
            firstName: "Bo",
            lastName: "Karlsson",
            subGroup: null,
            confirmedCheckedInAt: null,
            preliminaryCheckedInAt: null,
            importErrors: null,
            metadata: null,
          },
        },
        {
          participant: {
            id: "p2",
            firstName: "Cissi",
            lastName: "Nilsson",
            subGroup: null,
            confirmedCheckedInAt: null,
            preliminaryCheckedInAt: null,
            importErrors: null,
            metadata: null,
          },
        },
      ],
    });
    checkinSubjectFindMany.mockResolvedValueOnce([
      {
        checkinSession: {
          id: "prior-p1",
          createdAt: new Date("2026-05-13T10:00:00Z"),
          completedAt: null,
          abortedAt: new Date("2026-05-13T10:01:00Z"),
        },
      },
    ]);
    checkinSubjectFindMany.mockResolvedValueOnce([]);

    const context = await getSessionContext("s1");

    expect(context?.subjects.map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(context?.subjects[0]?.history).toHaveLength(1);
    expect(context?.subjects[1]?.history).toEqual([]);
  });
});
