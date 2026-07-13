import { describe, expect, it } from "vitest";
import { getBackfillCompletedAt } from "./safeFromHarmBackfill.ts";

describe("getBackfillCompletedAt", () => {
  it("returns undefined for a member not in the (default, mock) backfill list", () => {
    expect(getBackfillCompletedAt("999999")).toBeUndefined();
  });

  it("returns the completion date for a member present in an injected backfill map", () => {
    const backfill = new Map([["123456", "2025-01-15"]]);

    expect(getBackfillCompletedAt("123456", backfill)).toBe("2025-01-15");
    expect(getBackfillCompletedAt("000000", backfill)).toBeUndefined();
  });

  it("returns null for a member present without a known date", () => {
    const backfill = new Map([["123456", null]]);

    expect(getBackfillCompletedAt("123456", backfill)).toBeNull();
  });
});
