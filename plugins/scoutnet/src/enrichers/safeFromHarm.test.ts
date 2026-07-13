import { beforeEach, describe, expect, it, vi } from "vitest";

const getBackfillCompletedAt = vi.fn();

vi.mock("./safeFromHarmBackfill.ts", () => ({
  getBackfillCompletedAt,
}));

const { safeFromHarm } = await import("./safeFromHarm.ts");

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
  getBackfillCompletedAt.mockReset();
  getBackfillCompletedAt.mockReturnValue(undefined);
});

describe("scoutnet:safeFromHarm enricher", () => {
  it("is completed via scoutnet when the course-89 entry has a completion date", () => {
    const result = safeFromHarm.enrich(
      entity("1"),
      ctx({ pc_courses: { "89": "2026-01-15" } }),
    );

    expect(result).toEqual({
      completed: true,
      completedAt: "2026-01-15",
      source: "scoutnet",
    });
    // scoutnet already satisfied the check - no need to consult the backfill.
    expect(getBackfillCompletedAt).not.toHaveBeenCalled();
  });

  it("falls back to the backfill list (with its date) when scoutnet has no completion date", () => {
    getBackfillCompletedAt.mockReturnValue("2025-01-15");

    const result = safeFromHarm.enrich(
      entity("123456"),
      ctx({ pc_courses: { "89": null } }),
    );

    expect(result).toEqual({
      completed: true,
      completedAt: "2025-01-15",
      source: "backfill",
    });
    expect(getBackfillCompletedAt).toHaveBeenCalledWith("123456");
  });

  it("is completed via the backfill list even when its date is unknown (null)", () => {
    getBackfillCompletedAt.mockReturnValue(null);

    const result = safeFromHarm.enrich(
      entity("123456"),
      ctx({ pc_courses: { "89": null } }),
    );

    expect(result).toEqual({
      completed: true,
      completedAt: null,
      source: "backfill",
    });
  });

  it("is not completed when the course-89 entry is null and there is no backfill entry", () => {
    const result = safeFromHarm.enrich(
      entity("not-in-backfill"),
      ctx({ pc_courses: { "89": null } }),
    );

    expect(result).toEqual({
      completed: false,
      completedAt: null,
      source: null,
    });
  });

  it("is not completed when pc_courses has no entry for course 89 at all, with no backfill entry", () => {
    const result = safeFromHarm.enrich(
      entity("not-in-backfill"),
      ctx({ pc_courses: { "12": "2026-01-15" } }),
    );

    expect(result).toEqual({
      completed: false,
      completedAt: null,
      source: null,
    });
  });

  it("is not completed when pc_courses is entirely absent from the source record, with no backfill entry", () => {
    const result = safeFromHarm.enrich(entity("not-in-backfill"), ctx({}));

    expect(result).toEqual({
      completed: false,
      completedAt: null,
      source: null,
    });
  });

  it("is not completed (fail-safe) when there is no source record at all, with no backfill entry", () => {
    const result = safeFromHarm.enrich(
      entity("not-in-backfill"),
      ctx(undefined),
    );

    expect(result).toEqual({
      completed: false,
      completedAt: null,
      source: null,
    });
  });

  it("is not completed (fail-safe) when the source record doesn't match the expected shape, with no backfill entry", () => {
    const result = safeFromHarm.enrich(
      entity("not-in-backfill"),
      ctx({ pc_courses: "not-an-object" }),
    );

    expect(result).toEqual({
      completed: false,
      completedAt: null,
      source: null,
    });
  });
});
