import { describe, expect, it } from "vitest";
import { runScript } from "./runner.ts";

describe("runScript", () => {
  it("returns a value", () => {
    expect(runScript({ code: "return 1 + 2;", variables: {} })).toBe(3);
  });

  it("sees variables", () => {
    const result = runScript({
      code: "return subjects.map((s) => s.name);",
      variables: { subjects: [{ name: "a" }, { name: "b" }] },
    });
    expect(result).toEqual(["a", "b"]);
  });

  it("does not mutate variables for the caller", () => {
    const subjects = [{ name: "a" }];
    runScript({
      code: "subjects[0].name = 'changed'; return 1;",
      variables: { subjects },
    });
    expect(subjects[0].name).toBe("a");
  });

  it("returns plain objects from the outer realm", () => {
    const result = runScript({ code: "return { a: [1] };", variables: {} });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("times out on an infinite loop", () => {
    expect(() => runScript({ code: "while (true) {}", variables: {} })).toThrow(
      /timed out/,
    );
  });

  it("has no require or process", () => {
    const result = runScript({
      code: "return [typeof require, typeof process];",
      variables: {},
    });
    expect(result).toEqual(["undefined", "undefined"]);
  });

  it("rejects undefined results", () => {
    expect(() => runScript({ code: "const a = 1;", variables: {} })).toThrow(
      /undefined/,
    );
  });

  it("rejects non-serializable results", () => {
    expect(() => runScript({ code: "return () => 1;", variables: {} })).toThrow(
      /JSON/,
    );
    expect(() => runScript({ code: "return 1n;", variables: {} })).toThrow(
      /JSON/,
    );
  });

  it("gives a readable message for syntax errors", () => {
    expect(() => runScript({ code: "return (;", variables: {} })).toThrow(
      /Unexpected token/,
    );
  });

  it("rejects invalid variable names", () => {
    expect(() =>
      runScript({ code: "return 1;", variables: { "not-valid": 1 } }),
    ).toThrow(/Invalid variable name "not-valid"/);
  });
});
