// What the template studio remembers in localStorage. Every access is wrapped:
// storage can be missing, blocked or full, and the studio must work without it.

import { DEFAULT_ZOOM, parseZoom, type ZoomMode } from "./studioZoom";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJson(
  key: string,
  storage: StorageLike | null = defaultStorage(),
): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw === null || raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeJson(
  key: string,
  value: unknown,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ── Value sets ──

export type ValueSet = {
  name: string;
  values: unknown;
  /** The template's own `sample`; never stored, always first. */
  builtin?: boolean;
};

/** Name of the set made from the template's exported `sample`. */
export const SAMPLE_SET_NAME = "Example";
const MAX_NAME_LENGTH = 60;

export function setsKey(template: string): string {
  return `studio:${template}:sets`;
}

export function loadSets(
  template: string,
  storage?: StorageLike | null,
): ValueSet[] {
  const raw = readJson(setsKey(template), storage);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sets: ValueSet[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { name, values } = item as { name?: unknown; values?: unknown };
    if (typeof name !== "string" || name === "" || seen.has(name)) continue;
    if (name === SAMPLE_SET_NAME) continue;
    seen.add(name);
    sets.push({ name, values });
  }
  return sets;
}

export function saveSets(
  template: string,
  sets: ValueSet[],
  storage?: StorageLike | null,
): boolean {
  const stored = sets
    .filter((s) => !s.builtin)
    .map(({ name, values }) => ({ name, values }));
  return writeJson(setsKey(template), stored, storage);
}

/** The template's sample first (if it has one), then the saved sets. */
export function withSample(sample: unknown, stored: ValueSet[]): ValueSet[] {
  const own = stored.filter((s) => !s.builtin);
  if (sample === undefined || sample === null) return own;
  return [{ name: SAMPLE_SET_NAME, values: sample, builtin: true }, ...own];
}

export type SetsResult =
  | { ok: true; sets: ValueSet[] }
  | { ok: false; error: string };

/** Adds a set, or replaces the saved one with the same name. */
export function upsertSet(
  sets: ValueSet[],
  rawName: string,
  values: unknown,
): SetsResult {
  const name = rawName.trim();
  if (name === "") return { ok: false, error: "Enter a name" };
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `The name must be at most ${MAX_NAME_LENGTH} characters`,
    };
  }
  if (sets.some((s) => s.builtin && s.name === name)) {
    return {
      ok: false,
      error: "The name is reserved for the template's example",
    };
  }
  const exists = sets.some((s) => s.name === name);
  return {
    ok: true,
    sets: exists
      ? sets.map((s) => (s.name === name ? { name, values } : s))
      : [...sets, { name, values }],
  };
}

export function removeSet(sets: ValueSet[], name: string): ValueSet[] {
  return sets.filter((s) => s.builtin || s.name !== name);
}

// ── Preferences ──

export type Guides = {
  margin: boolean;
  marginMm: number;
  /** A line across the middle, left to right. */
  centerH: boolean;
  /** A line down the middle, top to bottom. */
  centerV: boolean;
  /** Satori's box outlines in the preview (which then isn't 1-bit). */
  debug: boolean;
};
export type SizePrefs = {
  /** "custom" or a printer id. */
  key: string;
  dpi: string;
  widthDots: string;
  lengthDots: string;
};
export type Prefs = {
  template: string;
  size: SizePrefs;
  zoom: ZoomMode;
  guides: Guides;
};

export const MAX_MARGIN_MM = 20;
export const PREFS_KEY = "studio:prefs";

export const DEFAULT_PREFS: Prefs = {
  template: "",
  size: { key: "custom", dpi: "203", widthDots: "800", lengthDots: "2060" },
  zoom: DEFAULT_ZOOM,
  guides: {
    margin: false,
    marginMm: 3,
    centerH: false,
    centerV: false,
    debug: false,
  },
};

export function clampMargin(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_PREFS.guides.marginMm;
  return Math.min(MAX_MARGIN_MM, Math.max(0, mm));
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function parsePrefs(raw: unknown): Prefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  const size = (
    typeof r.size === "object" && r.size !== null ? r.size : {}
  ) as Record<string, unknown>;
  const guides = (
    typeof r.guides === "object" && r.guides !== null ? r.guides : {}
  ) as Record<string, unknown>;
  return {
    template: str(r.template, ""),
    size: {
      key: str(size.key, DEFAULT_PREFS.size.key),
      dpi: str(size.dpi, DEFAULT_PREFS.size.dpi),
      widthDots: str(size.widthDots, DEFAULT_PREFS.size.widthDots),
      lengthDots: str(size.lengthDots, DEFAULT_PREFS.size.lengthDots),
    },
    zoom: parseZoom(r.zoom),
    guides: {
      margin: guides.margin === true,
      marginMm:
        typeof guides.marginMm === "number"
          ? clampMargin(guides.marginMm)
          : DEFAULT_PREFS.guides.marginMm,
      // Before the split there was one "center" switch for both lines.
      centerH: guides.centerH === true || guides.center === true,
      centerV: guides.centerV === true || guides.center === true,
      debug: guides.debug === true,
    },
  };
}

export function loadPrefs(storage?: StorageLike | null): Prefs {
  return parsePrefs(readJson(PREFS_KEY, storage));
}

export function savePrefs(prefs: Prefs, storage?: StorageLike | null): boolean {
  return writeJson(PREFS_KEY, prefs, storage);
}
