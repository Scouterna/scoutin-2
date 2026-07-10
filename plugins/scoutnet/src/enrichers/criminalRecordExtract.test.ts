import { beforeEach, describe, expect, it, vi } from "vitest";

const isValidInBackfill = vi.fn();

vi.mock("./criminalRecordExtractBackfill.ts", () => ({
  isValidInBackfill,
}));

const { criminalRecordExtract } = await import("./criminalRecordExtract.ts");

const entity = (idInDataSource: string) => ({
  id: "p1",
  dataSource: "staff",
  idInDataSource,
  firstName: "Alice",
  lastName: "Andersson",
});

const ctx = (sourceRecord: unknown) => ({
  dataSourceName: "staff",
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  sourceRecord,
});

beforeEach(() => {
  isValidInBackfill.mockReset();
  isValidInBackfill.mockReturnValue(false);
});

describe("scoutnet:criminalRecordExtract enricher", () => {
  it("is valid via scoutnet when pc_details.valid is true", () => {
    const result = criminalRecordExtract.enrich(
      entity("1"),
      ctx({ pc_details: { valid: true } }),
    );

    expect(result).toEqual({ valid: true, source: "scoutnet" });
    // scoutnet already satisfied the check - no need to consult the backfill.
    expect(isValidInBackfill).not.toHaveBeenCalled();
  });

  it("falls back to the backfill list when scoutnet has no valid entry", () => {
    isValidInBackfill.mockReturnValue(true);

    const result = criminalRecordExtract.enrich(
      entity("123456"),
      ctx({ pc_details: { valid: false } }),
    );

    expect(result).toEqual({ valid: true, source: "backfill" });
    expect(isValidInBackfill).toHaveBeenCalledWith("123456");
  });

  it("is not valid when pc_details.valid is false and there is no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx({ pc_details: { valid: false } }),
    );

    expect(result).toEqual({ valid: false, source: null });
  });

  it("is not valid (empty, not an error) when pc_details is entirely absent, with no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx({}),
    );

    expect(result).toEqual({ valid: false, source: null });
  });

  it("is not valid (fail-safe) when there is no source record at all, with no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx(undefined),
    );

    expect(result).toEqual({ valid: false, source: null });
  });
});
