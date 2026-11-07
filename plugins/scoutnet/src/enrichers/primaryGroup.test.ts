import { describe, expect, it } from "vitest";
import { primaryGroup } from "./primaryGroup.ts";

// biome-ignore lint/suspicious/noExplicitAny: test helper for the enricher context
const run = (sourceRecord: unknown): any =>
  // biome-ignore lint/suspicious/noExplicitAny: test helper for the enricher context
  (primaryGroup.enrich as any)({}, { sourceRecord });

describe("scoutnet:primaryGroup", () => {
  it("returns the primary group name", () => {
    expect(
      run({
        primary_membership_info: { group_name: " Löddeköpinge Scoutkår " },
      }),
    ).toEqual({ name: "Löddeköpinge Scoutkår" });
  });
  it("is null without membership info or a name", () => {
    expect(run({})).toEqual({ name: null });
    expect(run({ primary_membership_info: { group_name: null } })).toEqual({
      name: null,
    });
    expect(run({ primary_membership_info: { group_name: " " } })).toEqual({
      name: null,
    });
  });
});
