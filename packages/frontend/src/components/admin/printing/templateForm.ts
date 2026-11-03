// Turns the JSON Schema of a template's values (arktype's toJsonSchema()) into
// a flat list of form fields, and converts between field state and the values
// object. Anything that can't be a flat field (nested objects, arrays, unions,
// $ref, no schema) makes the schema unsupported, and the UI shows JSON only.

export type FieldKind = "text" | "number" | "integer" | "boolean" | "enum";

export type Field = {
  name: string;
  kind: FieldKind;
  required: boolean;
  /** For kind "enum". */
  options?: string[];
};

export type FieldsResult =
  | { supported: true; fields: Field[] }
  | { supported: false };

/** Form state: text, number and enum fields are strings, booleans are booleans. */
export type FieldState = Record<string, string | boolean>;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSUPPORTED_KEYS = [
  "$ref",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "patternProperties",
];

function propertyToField(
  name: string,
  schema: unknown,
  required: boolean,
): Field | null {
  if (!isRecord(schema)) return null;
  if (UNSUPPORTED_KEYS.some((key) => key in schema)) return null;
  if (Array.isArray(schema.enum)) {
    if (
      schema.enum.length === 0 ||
      !schema.enum.every((v) => typeof v === "string")
    ) {
      return null;
    }
    return { name, kind: "enum", required, options: schema.enum as string[] };
  }
  switch (schema.type) {
    case "string":
      return { name, kind: "text", required };
    case "number":
      return { name, kind: "number", required };
    case "integer":
      return { name, kind: "integer", required };
    case "boolean":
      return { name, kind: "boolean", required };
    default:
      return null;
  }
}

export function schemaToFields(schema: unknown): FieldsResult {
  if (!isRecord(schema) || schema.type !== "object") {
    return { supported: false };
  }
  if (UNSUPPORTED_KEYS.some((key) => key in schema)) {
    return { supported: false };
  }
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return { supported: false };
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((r) => typeof r === "string"))
    : new Set<string>();
  const fields: Field[] = [];
  for (const [name, property] of Object.entries(properties)) {
    const field = propertyToField(name, property, required.has(name));
    if (!field) return { supported: false };
    fields.push(field);
  }
  // Required fields have to be declared, or they couldn't be filled in.
  for (const name of required) {
    if (!(name in properties)) return { supported: false };
  }
  return { supported: true, fields };
}

export function initialState(fields: Field[]): FieldState {
  const state: FieldState = {};
  for (const field of fields) {
    state[field.name] = field.kind === "boolean" ? false : "";
  }
  return state;
}

export type BuildResult =
  | { ok: true; values: Record<string, string | number | boolean> }
  | { ok: false; error: string };

/**
 * Builds the values object from field state. Empty optional fields are left
 * out (an unchecked optional checkbox counts as empty); an empty required
 * field or an unparsable number is an error.
 */
export function buildValues(fields: Field[], state: FieldState): BuildResult {
  const values: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const raw = state[field.name];
    if (field.kind === "boolean") {
      const checked = raw === true;
      if (checked || field.required) values[field.name] = checked;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    const empty = field.kind === "text" ? text === "" : text.trim() === "";
    if (empty) {
      if (field.required) {
        return { ok: false, error: `${field.name} måste fyllas i` };
      }
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      const n = Number(text);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `${field.name} måste vara ett tal` };
      }
      if (field.kind === "integer" && !Number.isInteger(n)) {
        return { ok: false, error: `${field.name} måste vara ett heltal` };
      }
      values[field.name] = n;
    } else if (field.kind === "enum") {
      if (!field.options?.includes(text)) {
        return { ok: false, error: `${field.name} har ett ogiltigt val` };
      }
      values[field.name] = text;
    } else {
      values[field.name] = text;
    }
  }
  return { ok: true, values };
}

/**
 * Field state for a values object, or null when the object doesn't match the
 * fields (not an object, unknown keys, wrong types). Missing keys are fine:
 * they become empty fields.
 */
export function valuesToState(
  fields: Field[],
  values: unknown,
): FieldState | null {
  if (!isRecord(values)) return null;
  const known = new Set(fields.map((f) => f.name));
  if (Object.keys(values).some((key) => !known.has(key))) return null;
  const state = initialState(fields);
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined) continue;
    switch (field.kind) {
      case "boolean":
        if (typeof value !== "boolean") return null;
        state[field.name] = value;
        break;
      case "number":
      case "integer":
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        if (field.kind === "integer" && !Number.isInteger(value)) return null;
        state[field.name] = String(value);
        break;
      case "enum":
        if (typeof value !== "string" || !field.options?.includes(value)) {
          return null;
        }
        state[field.name] = value;
        break;
      default:
        if (typeof value !== "string") return null;
        state[field.name] = value;
    }
  }
  return state;
}

export type JsonParse =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function parseJson(text: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ogiltig JSON",
    };
  }
}

/** The JSON editor's text for form state: the values if valid, else what is filled in. */
export function stateToJson(fields: Field[], state: FieldState): string {
  const built = buildValues(fields, state);
  if (built.ok) return JSON.stringify(built.values, null, 2);
  // Incomplete form: show the parts that are valid so far.
  const partial: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const single = buildValues([{ ...field, required: false }], state);
    if (single.ok) Object.assign(partial, single.values);
  }
  return JSON.stringify(partial, null, 2);
}
