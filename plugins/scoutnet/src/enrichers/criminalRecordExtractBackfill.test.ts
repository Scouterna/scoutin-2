import { describe, expect, it } from "vitest";
import { isValidInBackfill } from "./criminalRecordExtractBackfill.ts";

describe("isValidInBackfill", () => {
  it("returns false for a member not in the (default, mock) backfill list", () => {
    expect(isValidInBackfill("999999")).toBe(false);
  });

  it("returns true for a member present in an injected backfill set", () => {
    const backfill = new Set(["123456"]);

    expect(isValidInBackfill("123456", backfill)).toBe(true);
    expect(isValidInBackfill("000000", backfill)).toBe(false);
  });
});
