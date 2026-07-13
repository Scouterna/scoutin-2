import { beforeEach, describe, expect, it, vi } from "vitest";

const participantUpdateMany = vi.fn();
const participantFindMany = vi.fn();
const participantUpdate = vi.fn();
const groupFindMany = vi.fn();
const groupUpdate = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    participant: {
      updateMany: participantUpdateMany,
      findMany: participantFindMany,
      update: participantUpdate,
    },
    participantGroup: {
      findMany: groupFindMany,
      update: groupUpdate,
    },
  },
}));

// data.service.ts reads DATASOURCE_HASHING_* at module scope (for
// hashLookupValue) - avoid depending on real env vars or loadConfig().
vi.mock("../../config/config.ts", () => ({
  default: {
    DATASOURCE_HASHING_SECRET: "test-secret",
    DATASOURCE_HASHING_SALT: "test-salt",
    BLOCKLIST_HASHING_SECRET: "test-blocklist-secret",
    NODE_ENV: "test",
  },
}));

// Sidesteps needing real env-var substitution for dataSourceConfig.yml -
// nothing under test here reads the module-level `dataSourceConfig` export.
vi.mock("../../config/dataSourceConfigLoader.ts", () => ({
  loadDataSourceConfig: () => ({ dataSources: {} }),
}));

// Avoids spinning up a real pino/pino-pretty instance in tests. `child()` is
// chainable (returns itself) to match how pino's child loggers behave.
const logStub: {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: () => typeof logStub;
} = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: () => logStub,
};
vi.mock("../../core/logging/logger.ts", () => ({
  logger: logStub,
}));

const {
  reconcileDataSource,
  hashIdentifier,
  hashLookupValue,
  normalizeIdentifier,
} = await import("./data.service.ts");
const { enricherRegistry } = await import("../workflows/steps.ts");

enricherRegistry.register({
  name: "test:participantTag",
  target: "participant",
  enrich: (entity) => ({ tag: `${entity.firstName}-tagged` }),
});
enricherRegistry.register({
  name: "test:groupTag",
  target: "group",
  enrich: (entity) => ({ tag: `${entity.name}-tagged` }),
});
enricherRegistry.register({
  name: "test:returnsNull",
  target: "participant",
  enrich: () => null,
});
enricherRegistry.register({
  name: "test:throwsForBad",
  target: "participant",
  enrich: (entity) => {
    if (entity.idInDataSource === "bad") throw new Error("enrichment failed");
    return { tag: "ok" };
  },
});
enricherRegistry.register({
  name: "test:readsSourceRecord",
  target: "participant",
  // Echoes back whatever ctx.sourceRecord it received, so tests can assert
  // on exactly what reconcileDataSource threaded through.
  enrich: (_entity, ctx) => ({ received: ctx.sourceRecord ?? null }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeIdentifier / hashIdentifier", () => {
  it("is a no-op for a plain member number", () => {
    expect(normalizeIdentifier("12345")).toBe("12345");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIdentifier("  12345  ")).toBe("12345");
  });

  it("canonicalizes a personnummer to YYYYMMDD-XXXX", () => {
    // With or without the hyphen, both collapse to the same canonical form.
    expect(normalizeIdentifier("20050101-1234")).toBe("20050101-1234");
    expect(normalizeIdentifier("200501011234")).toBe("20050101-1234");
    expect(normalizeIdentifier(" 2005 0101 1234 ")).toBe("20050101-1234");
  });

  // Golden values: import composes the 12-digit form and hashes it, so
  // hashIdentifier(x) MUST equal today's hashLookupValue(x) for these inputs -
  // otherwise routing import through hashIdentifier would silently break
  // lookups. Normalization is the identity here, so they must be byte-equal.
  it("hashIdentifier matches hashLookupValue when normalization is a no-op", () => {
    expect(hashIdentifier("12345")).toBe(hashLookupValue("12345"));
    expect(hashIdentifier("20050101-1234")).toBe(
      hashLookupValue("20050101-1234"),
    );
  });

  it("hashes normalized personnummer variants to the same value", () => {
    expect(hashIdentifier("200501011234")).toBe(
      hashIdentifier("20050101-1234"),
    );
  });

  it("expands a 10-digit personnummer using the reference year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // Year 05 <= current two-digit year (26) => current century (20).
    expect(normalizeIdentifier("0501011234")).toBe("20050101-1234");
    // Year 30 > 26 => previous century (19).
    expect(normalizeIdentifier("3001011234")).toBe("19300101-1234");
    vi.useRealTimers();
  });
});

describe("reconcileDataSource", () => {
  it("soft-deletes participants for this data source that are not in the processed set", async () => {
    await reconcileDataSource(
      "groups",
      { participantIds: ["1", "2"], groupIds: [] },
      undefined,
    );

    expect(participantUpdateMany).toHaveBeenCalledWith({
      where: {
        dataSource: "groups",
        idInDataSource: { notIn: ["1", "2"] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("does nothing else when enrichWith is not configured", async () => {
    await reconcileDataSource(
      "groups",
      { participantIds: [], groupIds: [] },
      undefined,
    );

    expect(participantFindMany).not.toHaveBeenCalled();
    expect(groupFindMany).not.toHaveBeenCalled();
  });

  it("writes a participant enricher's result under its configured metadata key, preserving existing keys", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: { other: "keep-me" },
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { village: "test:participantTag" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        metadata: { other: "keep-me", village: { tag: "Alice-tagged" } },
        importErrors: {},
      },
    });
  });

  it("writes a group enricher's result under its configured metadata key", async () => {
    groupFindMany.mockResolvedValueOnce([
      {
        id: "g1",
        dataSource: "groups",
        idInDataSource: "5",
        name: "Kår 5",
        metadata: null,
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: [], groupIds: ["5"] },
      { village: "test:groupTag" },
    );

    expect(groupUpdate).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: {
        metadata: { village: { tag: "Kår 5-tagged" } },
        importErrors: {},
      },
    });
  });

  it("writes no metadata key when the enricher returns null", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { village: "test:returnsNull" },
    );

    expect(participantUpdate).not.toHaveBeenCalled();
  });

  it("flags only the entity whose enricher call throws, leaving others untouched", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p-good",
        dataSource: "groups",
        idInDataSource: "good",
        firstName: "Good",
        metadata: null,
        importErrors: null,
      },
      {
        id: "p-bad",
        dataSource: "groups",
        idInDataSource: "bad",
        firstName: "Bad",
        metadata: null,
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["good", "bad"], groupIds: [] },
      { village: "test:throwsForBad" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p-good" },
      data: {
        metadata: { village: { tag: "ok" } },
        importErrors: {},
      },
    });
    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p-bad" },
      data: {
        importErrors: { "test:throwsForBad": "enrichment failed" },
      },
    });
    expect(participantUpdate).toHaveBeenCalledTimes(2);
  });

  it("logs and skips an enrichWith entry referencing an unregistered enricher name", async () => {
    await reconcileDataSource(
      "groups",
      { participantIds: [], groupIds: [] },
      { village: "test:doesNotExist" },
    );

    expect(participantFindMany).not.toHaveBeenCalled();
    expect(groupFindMany).not.toHaveBeenCalled();
  });

  it("clears its own error key when the enricher succeeds after a prior failure", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: { "test:participantTag": "old failure" },
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { village: "test:participantTag" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        metadata: { village: { tag: "Alice-tagged" } },
        importErrors: {},
      },
    });
  });

  it("clears its own key with no metadata write when the enricher returns null after a prior failure", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: { "test:returnsNull": "old failure" },
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { village: "test:returnsNull" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { importErrors: {} },
    });
    expect(participantUpdate).toHaveBeenCalledTimes(1);
  });

  it("preserves a provider-level error key when an unrelated enricher succeeds", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: { provider: "invalid raw data" },
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { village: "test:participantTag" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        metadata: { village: { tag: "Alice-tagged" } },
        importErrors: { provider: "invalid raw data" },
      },
    });
  });

  it("preserves another enricher's error key when this enricher succeeds afterward (cross-enricher isolation)", async () => {
    // First enrichWith entry this cycle: fails for "bad", recording its own key.
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p-bad",
        dataSource: "groups",
        idInDataSource: "bad",
        firstName: "Bad",
        metadata: null,
        importErrors: null,
      },
    ]);
    // Second enrichWith entry: reconcileDataSource re-fetches fresh for each
    // key, so this simulates the row now carrying the first entry's write.
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p-bad",
        dataSource: "groups",
        idInDataSource: "bad",
        firstName: "Bad",
        metadata: null,
        importErrors: { "test:throwsForBad": "enrichment failed" },
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["bad"], groupIds: [] },
      { village: "test:throwsForBad", tag: "test:participantTag" },
    );

    // First entry's failure.
    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p-bad" },
      data: {
        importErrors: { "test:throwsForBad": "enrichment failed" },
      },
    });
    // Second entry's success must not clear the first entry's key.
    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p-bad" },
      data: {
        metadata: { tag: { tag: "Bad-tagged" } },
        importErrors: { "test:throwsForBad": "enrichment failed" },
      },
    });
  });

  it("threads a provider's captured source record through to the enricher context, keyed by idInDataSource", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "staff",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "staff",
      {
        participantIds: ["1"],
        groupIds: [],
        sourceRecords: {
          participant: new Map([["1", { pc_details: { valid: true } }]]),
          group: new Map(),
        },
      },
      { raw: "test:readsSourceRecord" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        metadata: { raw: { received: { pc_details: { valid: true } } } },
        importErrors: {},
      },
    });
  });

  it("passes an undefined source record when the provider captured none for this entity (sourceRecords omitted)", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        idInDataSource: "1",
        firstName: "Alice",
        metadata: null,
        importErrors: null,
      },
    ]);

    await reconcileDataSource(
      "groups",
      { participantIds: ["1"], groupIds: [] },
      { raw: "test:readsSourceRecord" },
    );

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        metadata: { raw: { received: null } },
        importErrors: {},
      },
    });
  });
});
