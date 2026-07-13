import { beforeEach, describe, expect, it, vi } from "vitest";

const getBackfillShownAt = vi.fn();

vi.mock("./criminalRecordExtractBackfill.ts", () => ({
  getBackfillShownAt,
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
  getBackfillShownAt.mockReset();
  getBackfillShownAt.mockReturnValue(undefined);
});

describe("scoutnet:criminalRecordExtract enricher", () => {
  it("is valid via scoutnet when pc_details.valid is true, capturing the shown date", () => {
    const result = criminalRecordExtract.enrich(
      entity("1"),
      ctx({ pc_details: { valid: true, shown: "2023-01-15" } }),
    );

    expect(result).toEqual({
      valid: true,
      shownAt: "2023-01-15",
      source: "scoutnet",
    });
    // scoutnet already satisfied the check - no need to consult the backfill.
    expect(getBackfillShownAt).not.toHaveBeenCalled();
  });

  it("is valid via scoutnet with a null shown date when the date is absent", () => {
    const result = criminalRecordExtract.enrich(
      entity("1"),
      ctx({ pc_details: { valid: true } }),
    );

    expect(result).toEqual({ valid: true, shownAt: null, source: "scoutnet" });
  });

  it("falls back to the backfill list (with its date) when scoutnet has no valid entry", () => {
    getBackfillShownAt.mockReturnValue("2025-01-15");

    const result = criminalRecordExtract.enrich(
      entity("123456"),
      ctx({ pc_details: { valid: false } }),
    );

    expect(result).toEqual({
      valid: true,
      shownAt: "2025-01-15",
      source: "backfill",
    });
    expect(getBackfillShownAt).toHaveBeenCalledWith("123456");
  });

  it("is valid via the backfill list even when its date is unknown (null)", () => {
    getBackfillShownAt.mockReturnValue(null);

    const result = criminalRecordExtract.enrich(
      entity("123456"),
      ctx({ pc_details: { valid: false } }),
    );

    expect(result).toEqual({ valid: true, shownAt: null, source: "backfill" });
  });

  it("is not valid when pc_details.valid is false and there is no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx({ pc_details: { valid: false } }),
    );

    expect(result).toEqual({ valid: false, shownAt: null, source: null });
  });

  it("is not valid (empty, not an error) when pc_details is entirely absent, with no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx({}),
    );

    expect(result).toEqual({ valid: false, shownAt: null, source: null });
  });

  it("is not valid (fail-safe) when there is no source record at all, with no backfill entry", () => {
    const result = criminalRecordExtract.enrich(
      entity("not-in-backfill"),
      ctx(undefined),
    );

    expect(result).toEqual({ valid: false, shownAt: null, source: null });
  });
});
