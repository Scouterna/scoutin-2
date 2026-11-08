import { describe, expect, it } from "vitest";
import { assertNoSchemaConflict } from "./databaseSchema.ts";

const base = "postgresql://u:p@localhost:5432/db";

describe("assertNoSchemaConflict", () => {
  it("accepts a URL without ?schema=", () => {
    expect(() => assertNoSchemaConflict(base, "scoutin")).not.toThrow();
  });

  it("accepts a URL schema that matches", () => {
    expect(() =>
      assertNoSchemaConflict(`${base}?schema=public`, "public"),
    ).not.toThrow();
  });

  it("rejects a URL schema that differs", () => {
    expect(() =>
      assertNoSchemaConflict(`${base}?schema=foo`, "public"),
    ).toThrow(/DATABASE_SCHEMA/);
  });
});
