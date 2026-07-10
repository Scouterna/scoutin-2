import { describe, expect, it } from "vitest";
import { isCompletedInBackfill } from "./safeFromHarmBackfill.ts";

describe("isCompletedInBackfill", () => {
  it("returns false for a member not in the (default, mock) backfill list", () => {
    expect(isCompletedInBackfill("999999")).toBe(false);
  });

  it("returns true for a member present in an injected backfill set", () => {
    const backfill = new Set(["123456"]);

    expect(isCompletedInBackfill("123456", backfill)).toBe(true);
    expect(isCompletedInBackfill("000000", backfill)).toBe(false);
  });
});
