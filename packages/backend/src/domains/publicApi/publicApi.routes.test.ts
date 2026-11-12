import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const name of [
    "SCOUTNET_DJ26_PARTICIPANTS_KEY",
    "SCOUTNET_DJ26_QUESTIONS_KEY",
  ]) {
    vi.stubEnv(name, "test");
  }
});

const apiKeyFindFirst = vi.fn();
const apiKeyUpdate = vi.fn();
const participantFindUnique = vi.fn();
const recordAudit = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    apiKey: { findFirst: apiKeyFindFirst, update: apiKeyUpdate },
    participant: { findUnique: participantFindUnique },
  },
}));
vi.mock("../../config/config.ts", () => ({
  default: {
    NODE_ENV: "test",
    BASE_PATH: "",
    DATASOURCE_CONFIG: "dataSourceConfig.dj26.yml",
    DATASOURCE_HASHING_SECRET: "test-secret",
    DATASOURCE_HASHING_SALT: "test-salt",
  },
}));
vi.mock("../audit/audit.service.ts", () => ({ recordAudit }));

const { publicApiRouter } = await import("./publicApi.routes.ts");
const { dataSourceConfig } = await import("../participants/data.service.ts");

const dj26Fields = structuredClone(
  dataSourceConfig.dataSources.participants?.publicApi,
);

/** A `${{ }}` config expression. */
function expr(body: string) {
  return `\${{ ${body} }}`;
}

const AUTH = { Authorization: "Bearer sci_good" };
const PATH = "/data-sources/participants/participants/3012345";

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    dataSource: "participants",
    idInDataSource: "3012345",
    firstName: "Alva",
    lastName: "Berg",
    subGroup: "delegate",
    confirmedCheckedInAt: null,
    preliminaryCheckedInAt: null,
    deletedAt: null,
    importErrors: null,
    metadata: {
      badge: {
        lunchSaturday: "Vegetarisk",
        lunchSunday: "Vegetarisk",
        dinnerSaturday: "Kött",
        dinnerSeating: "Sittning 1 ca 18.00",
      },
    },
    ...overrides,
  };
}

function setPublicApi(value: { fields: Record<string, string> } | undefined) {
  const source = dataSourceConfig.dataSources.participants;
  if (source) source.publicApi = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  setPublicApi(structuredClone(dj26Fields));
  apiKeyFindFirst.mockResolvedValue({
    id: "k1",
    name: "App",
    permissions: ["participants:read"],
  });
});

describe("GET participant", () => {
  it("answers with the configured fields and the subgroup key", async () => {
    participantFindUnique.mockResolvedValue(
      participant({
        confirmedCheckedInAt: new Date("2026-11-11T09:12:00.000Z"),
        preliminaryCheckedInAt: new Date("2026-11-02T18:40:00.000Z"),
      }),
    );

    const res = await publicApiRouter.request(PATH, { headers: AUTH });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "p1",
      dataSource: "participants",
      idInDataSource: "3012345",
      checkinStatus: "confirmed",
      confirmedCheckedInAt: "2026-11-11T09:12:00.000Z",
      preliminaryCheckedInAt: "2026-11-02T18:40:00.000Z",
      firstName: "Alva",
      lastName: "Berg",
      subGroup: "delegate",
      fields: {
        lunchSaturday: "Vegetarisk",
        lunchSunday: "Vegetarisk",
        dinnerSaturday: "Kött",
        dinnerSeating: "Sittning 1 ca 18.00",
      },
    });
    expect(participantFindUnique).toHaveBeenCalledWith({
      where: {
        dataSource_idInDataSource: {
          dataSource: "participants",
          idInDataSource: "3012345",
        },
        deletedAt: null,
      },
    });
  });

  it("returns fields: {} without publicApi", async () => {
    setPublicApi(undefined);
    participantFindUnique.mockResolvedValue(participant());

    const body = await (
      await publicApiRouter.request(PATH, { headers: AUTH })
    ).json();

    expect(body.fields).toEqual({});
  });

  it("gives null for a field whose expression fails", async () => {
    setPublicApi({
      fields: {
        good: expr("participant.metadata.badge.lunchSaturday"),
        broken: expr("nope("),
        unknown: expr("participant.metadata.badge.nothing"),
      },
    });
    participantFindUnique.mockResolvedValue(participant());

    const body = await (
      await publicApiRouter.request(PATH, { headers: AUTH })
    ).json();

    expect(body.fields).toEqual({
      good: "Vegetarisk",
      broken: null,
      unknown: null,
    });
  });

  it("gives null fields when the participant has no metadata", async () => {
    participantFindUnique.mockResolvedValue(participant({ metadata: null }));

    const body = await (
      await publicApiRouter.request(PATH, { headers: AUTH })
    ).json();

    expect(Object.values(body.fields)).toEqual([null, null, null, null]);
  });

  it.each([
    [{ confirmedCheckedInAt: new Date() }, "confirmed"],
    [{ preliminaryCheckedInAt: new Date() }, "preliminaryOnly"],
    [{}, "missing"],
  ])("reports checkinStatus %#", async (overrides, expected) => {
    participantFindUnique.mockResolvedValue(participant(overrides));

    const body = await (
      await publicApiRouter.request(PATH, { headers: AUTH })
    ).json();

    expect(body.checkinStatus).toBe(expected);
  });

  it("still answers a participant with import errors", async () => {
    participantFindUnique.mockResolvedValue(
      participant({ importErrors: { provider: "bad row" } }),
    );

    const res = await publicApiRouter.request(PATH, { headers: AUTH });

    expect(res.status).toBe(200);
  });

  it("is 404 for an unknown participant", async () => {
    participantFindUnique.mockResolvedValue(null);

    const res = await publicApiRouter.request(PATH, { headers: AUTH });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("is 404 for an unknown data source, without a lookup", async () => {
    const res = await publicApiRouter.request(
      "/data-sources/nope/participants/1",
      { headers: AUTH },
    );

    expect(res.status).toBe(404);
    expect(participantFindUnique).not.toHaveBeenCalled();
  });

  it("is 404 for a cancelled participant (deletedAt is part of the lookup)", async () => {
    participantFindUnique.mockResolvedValue(null);

    await publicApiRouter.request(PATH, { headers: AUTH });

    expect(participantFindUnique.mock.calls[0]?.[0].where.deletedAt).toBeNull();
  });
});

describe("auth and audit", () => {
  it("is 401 without a key and writes no audit row", async () => {
    apiKeyFindFirst.mockResolvedValue(null);

    const res = await publicApiRouter.request(PATH);

    expect(res.status).toBe(401);
    expect(participantFindUnique).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("audits a 200 with the participant id only", async () => {
    participantFindUnique.mockResolvedValue(participant());

    await publicApiRouter.request(PATH, { headers: AUTH });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      actor: "api-key:k1",
      action: "public-api.participants.read",
      details: { participantId: "p1" },
    });
  });

  it("audits a 404 with a null participant id", async () => {
    participantFindUnique.mockResolvedValue(null);

    await publicApiRouter.request(PATH, { headers: AUTH });

    expect(recordAudit).toHaveBeenCalledWith({
      actor: "api-key:k1",
      action: "public-api.participants.read",
      details: { participantId: null },
    });
  });

  it("is 403 and audited without the permission", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: [],
    });

    const res = await publicApiRouter.request(PATH, { headers: AUTH });

    expect(res.status).toBe(403);
    expect(participantFindUnique).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith({
      actor: "api-key:k1",
      action: "public-api.participants.read",
      details: { participantId: null },
    });
  });
});

describe("GET /openapi.json", () => {
  it("needs no key and documents the route, bearer scheme and DJ26 fields", async () => {
    apiKeyFindFirst.mockResolvedValue(null);

    const res = await publicApiRouter.request("/openapi.json");
    const spec = await res.json();

    expect(res.status).toBe(200);
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
    const operation =
      spec.paths["/data-sources/{dataSource}/participants/{idInDataSource}"]
        .get;
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "403", "404"]),
    );
    const ok = operation.responses["200"].content["application/json"].schema;
    expect(JSON.stringify(ok)).toContain("lunchSaturday");
    expect(JSON.stringify(ok)).toContain("dinnerSeating");
    expect(JSON.stringify(ok)).toContain('"participants"');
  });
});
