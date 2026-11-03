import { describe, expect, it } from "vitest";
import {
  buildValues,
  type Field,
  initialState,
  parseJson,
  schemaToFields,
  stateToJson,
  valuesToState,
} from "./templateForm";

// What toJsonSchema() gives for example-name-tag.tsx.
const NAME_TAG = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    firstName: { type: "string", minLength: 1 },
    group: { type: "string" },
    lastName: { type: "string" },
  },
  required: ["firstName"],
};
// type({}) as used by the _test built-in.
const EMPTY = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
};
const MIXED = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    a: { type: "integer" },
    c: { enum: ["x", "y"] },
    d: { type: "number" },
    b: { type: "boolean" },
  },
  required: ["a", "c", "d"],
};
const NESTED = {
  type: "object",
  properties: {
    e: {
      type: "object",
      properties: { f: { type: "string" } },
      required: ["f"],
    },
  },
  required: ["e"],
};

function fieldsOf(schema: unknown): Field[] {
  const result = schemaToFields(schema);
  if (!result.supported) throw new Error("unsupported");
  return result.fields;
}

describe("schemaToFields", () => {
  it("maps the example name tag", () => {
    expect(fieldsOf(NAME_TAG)).toEqual([
      { name: "firstName", kind: "text", required: true },
      { name: "group", kind: "text", required: false },
      { name: "lastName", kind: "text", required: false },
    ]);
  });

  it("maps number, integer, boolean and enum", () => {
    expect(fieldsOf(MIXED)).toEqual([
      { name: "a", kind: "integer", required: true },
      { name: "c", kind: "enum", required: true, options: ["x", "y"] },
      { name: "d", kind: "number", required: true },
      { name: "b", kind: "boolean", required: false },
    ]);
  });

  it("treats an empty object schema as no fields", () => {
    expect(schemaToFields(EMPTY)).toEqual({ supported: true, fields: [] });
  });

  it("does not support nested objects", () => {
    expect(schemaToFields(NESTED)).toEqual({ supported: false });
  });

  it("does not support a missing schema", () => {
    expect(schemaToFields(undefined)).toEqual({ supported: false });
    expect(schemaToFields(null)).toEqual({ supported: false });
  });

  it("does not support arrays, unions, refs or non-objects", () => {
    const wrap = (p: unknown) => ({
      type: "object",
      properties: { p },
    });
    expect(schemaToFields(wrap({ type: "array", items: {} }))).toEqual({
      supported: false,
    });
    expect(schemaToFields(wrap({ anyOf: [{ type: "string" }] }))).toEqual({
      supported: false,
    });
    expect(schemaToFields(wrap({ $ref: "#/x" }))).toEqual({ supported: false });
    expect(schemaToFields({ type: "string" })).toEqual({ supported: false });
  });
});

describe("buildValues", () => {
  const fields = fieldsOf(MIXED);

  it("keeps types and omits empty optionals", () => {
    const state = { ...initialState(fields), a: "3", c: "y", d: "1.5" };
    expect(buildValues(fields, state)).toEqual({
      ok: true,
      values: { a: 3, c: "y", d: 1.5 },
    });
    expect(buildValues(fields, { ...state, b: true })).toEqual({
      ok: true,
      values: { a: 3, c: "y", d: 1.5, b: true },
    });
  });

  it("keeps newlines inside text", () => {
    const f = fieldsOf(NAME_TAG);
    const state = { ...initialState(f), firstName: "Kim\nLarsson" };
    expect(buildValues(f, state)).toEqual({
      ok: true,
      values: { firstName: "Kim\nLarsson" },
    });
    expect(JSON.parse(stateToJson(f, state))).toEqual({
      firstName: "Kim\nLarsson",
    });
  });

  it("omits empty optional text but keeps filled text", () => {
    const f = fieldsOf(NAME_TAG);
    const state = { ...initialState(f), firstName: "Kim", group: "Kåren" };
    expect(buildValues(f, state)).toEqual({
      ok: true,
      values: { firstName: "Kim", group: "Kåren" },
    });
  });

  it("keeps an unchecked required boolean as false", () => {
    const f: Field[] = [{ name: "vip", kind: "boolean", required: true }];
    expect(buildValues(f, { vip: false })).toEqual({
      ok: true,
      values: { vip: false },
    });
  });

  it("rejects an empty required field", () => {
    const f = fieldsOf(NAME_TAG);
    expect(buildValues(f, initialState(f)).ok).toBe(false);
  });

  it("rejects a bad number and a non-integer integer", () => {
    const base = { ...initialState(fields), a: "3", c: "x", d: "1" };
    expect(buildValues(fields, { ...base, d: "abc" }).ok).toBe(false);
    expect(buildValues(fields, { ...base, a: "2.5" }).ok).toBe(false);
  });

  it("builds an empty object for no fields", () => {
    expect(buildValues([], {})).toEqual({ ok: true, values: {} });
  });
});

describe("JSON <-> form sync", () => {
  const fields = fieldsOf(MIXED);

  it("round-trips values through the form state", () => {
    const values = { a: 3, c: "y", d: 1.5, b: true };
    const state = valuesToState(fields, values);
    expect(state).not.toBeNull();
    expect(buildValues(fields, state as never)).toEqual({ ok: true, values });
  });

  it("accepts partial values as empty fields", () => {
    expect(valuesToState(fields, { a: 1 })).toMatchObject({ a: "1", c: "" });
  });

  it("rejects unknown keys, wrong types and non-objects", () => {
    expect(valuesToState(fields, { a: 1, zzz: 1 })).toBeNull();
    expect(valuesToState(fields, { a: "1" })).toBeNull();
    expect(valuesToState(fields, { a: 1.5 })).toBeNull();
    expect(valuesToState(fields, { c: "nope" })).toBeNull();
    expect(valuesToState(fields, [1])).toBeNull();
    expect(valuesToState(fields, null)).toBeNull();
  });

  it("writes form state as JSON, partial while incomplete", () => {
    const state = { ...initialState(fields), a: "3" };
    expect(JSON.parse(stateToJson(fields, state))).toEqual({ a: 3 });
  });

  it("parses JSON with an error message on failure", () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson("{").ok).toBe(false);
  });
});
