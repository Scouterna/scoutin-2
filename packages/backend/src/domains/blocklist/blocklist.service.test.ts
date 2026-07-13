import { beforeEach, describe, expect, it, vi } from "vitest";

const blockedIdentifierFindFirst = vi.fn();
const blockedIdentifierFindMany = vi.fn();
const blockedIdentifierFindUnique = vi.fn();
const blockCreate = vi.fn();
const blockDelete = vi.fn();
const blockCount = vi.fn();
const participantFindMany = vi.fn();
const participantFindUnique = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    blockedIdentifier: {
      findFirst: blockedIdentifierFindFirst,
      findMany: blockedIdentifierFindMany,
      findUnique: blockedIdentifierFindUnique,
    },
    block: {
      create: blockCreate,
      delete: blockDelete,
      count: blockCount,
    },
    participant: {
      findMany: participantFindMany,
      findUnique: participantFindUnique,
    },
  },
}));

vi.mock("../../config/config.ts", () => ({
  default: {
    DATASOURCE_HASHING_SECRET: "test-secret",
    DATASOURCE_HASHING_SALT: "test-salt",
    BLOCKLIST_HASHING_SECRET: "test-blocklist-secret",
    NODE_ENV: "test",
  },
}));

vi.mock("../../config/dataSourceConfigLoader.ts", () => ({
  loadDataSourceConfig: () => ({ dataSources: {} }),
}));

const logStub = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: () => logStub,
};
vi.mock("../../core/logging/logger.ts", () => ({ logger: logStub }));

const { hashLookupValue, normalizeIdentifier } = await import(
  "../participants/data.service.ts"
);
const { isBlocked, createBlock, removeBlock, hashBlockValue } = await import(
  "./blocklist.service.ts"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isBlocked", () => {
  it("returns true when a block entry matches", async () => {
    participantFindMany.mockResolvedValueOnce([]);
    blockedIdentifierFindFirst.mockResolvedValueOnce({ id: "b1" });

    expect(await isBlocked("12345")).toBe(true);

    // Direct match on the submitted identifier must be one of the hashes checked.
    const directHash = hashBlockValue(
      hashLookupValue(normalizeIdentifier("12345")),
    );
    const where = blockedIdentifierFindFirst.mock.calls[0]![0].where;
    expect(where.blockHash.in).toContain(directHash);
  });

  it("returns false when nothing matches", async () => {
    participantFindMany.mockResolvedValueOnce([]);
    blockedIdentifierFindFirst.mockResolvedValueOnce(null);

    expect(await isBlocked("12345")).toBe(false);
  });

  it("fans out over every lookup value of a resolved participant", async () => {
    participantFindMany.mockResolvedValueOnce([
      { lookupValues: ["lookup-a", "lookup-b"] },
    ]);
    blockedIdentifierFindFirst.mockResolvedValueOnce(null);

    await isBlocked("12345");

    const checked: string[] =
      blockedIdentifierFindFirst.mock.calls[0]![0].where.blockHash.in;
    expect(checked).toContain(hashBlockValue("lookup-a"));
    expect(checked).toContain(hashBlockValue("lookup-b"));
  });
});

describe("createBlock", () => {
  it("stores block hashes for each manual identifier", async () => {
    blockedIdentifierFindMany.mockResolvedValueOnce([]);
    blockCreate.mockResolvedValueOnce({ id: "block-1" });

    const result = await createBlock({ identifiers: ["12345", "67890"] });

    expect(result.identifierCount).toBe(2);
    const created = blockCreate.mock.calls[0]![0].data.identifiers.create;
    const hashes = created.map((c: { blockHash: string }) => c.blockHash);
    expect(hashes).toContain(hashBlockValue(hashLookupValue("12345")));
    expect(hashes).toContain(hashBlockValue(hashLookupValue("67890")));
  });

  it("skips identifiers that are already blocked (idempotent)", async () => {
    const existing = hashBlockValue(hashLookupValue("12345"));
    blockedIdentifierFindMany.mockResolvedValueOnce([{ blockHash: existing }]);

    const result = await createBlock({ identifiers: ["12345"] });

    expect(result).toEqual({ blockId: null, identifierCount: 0 });
    expect(blockCreate).not.toHaveBeenCalled();
  });

  it("fans out over a participant's lookup values", async () => {
    participantFindUnique.mockResolvedValueOnce({
      lookupValues: ["lookup-a", "lookup-b"],
    });
    blockedIdentifierFindMany.mockResolvedValueOnce([]);
    blockCreate.mockResolvedValueOnce({ id: "block-1" });

    const result = await createBlock({ participantId: "p1" });

    expect(result.identifierCount).toBe(2);
    const created = blockCreate.mock.calls[0]![0].data.identifiers.create;
    const hashes = created.map((c: { blockHash: string }) => c.blockHash);
    expect(hashes).toContain(hashBlockValue("lookup-a"));
    expect(hashes).toContain(hashBlockValue("lookup-b"));
  });
});

describe("removeBlock", () => {
  it("deletes the whole block and reports a match", async () => {
    blockedIdentifierFindUnique.mockResolvedValueOnce({ blockId: "block-1" });

    expect(await removeBlock("12345")).toBe(true);
    expect(blockDelete).toHaveBeenCalledWith({ where: { id: "block-1" } });
  });

  it("is a no-op and reports no match when nothing is found", async () => {
    blockedIdentifierFindUnique.mockResolvedValueOnce(null);

    expect(await removeBlock("12345")).toBe(false);
    expect(blockDelete).not.toHaveBeenCalled();
  });
});
