import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  loadPrefs,
  loadSets,
  parsePrefs,
  removeSet,
  SAMPLE_SET_NAME,
  type StorageLike,
  savePrefs,
  saveSets,
  setsKey,
  upsertSet,
  withSample,
} from "./studioStorage";

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
};

describe("sets storage", () => {
  it("round-trips sets under the per-template key", () => {
    const storage = memoryStorage();
    const sets = [{ name: "Long", values: { name: "A".repeat(40) } }];
    expect(saveSets("badge", sets, storage)).toBe(true);
    expect(Object.keys(storage.data)).toEqual(["studio:badge:sets"]);
    expect(loadSets("badge", storage)).toEqual(sets);
  });

  it("never stores the sample", () => {
    const storage = memoryStorage();
    saveSets(
      "badge",
      withSample({ a: 1 }, [{ name: "X", values: 1 }]),
      storage,
    );
    expect(JSON.parse(storage.data[setsKey("badge")] as string)).toEqual([
      { name: "X", values: 1 },
    ]);
  });

  it("ignores broken, duplicate and reserved entries", () => {
    const storage = memoryStorage({
      [setsKey("t")]: JSON.stringify([
        null,
        { name: 1 },
        { name: "" },
        { name: "A", values: 1 },
        { name: "A", values: 2 },
        { name: SAMPLE_SET_NAME, values: 3 },
      ]),
    });
    expect(loadSets("t", storage)).toEqual([{ name: "A", values: 1 }]);
  });

  it("survives unparsable JSON and throwing storage", () => {
    expect(loadSets("t", memoryStorage({ [setsKey("t")]: "{oops" }))).toEqual(
      [],
    );
    expect(loadSets("t", broken)).toEqual([]);
    expect(loadSets("t", null)).toEqual([]);
    expect(saveSets("t", [], broken)).toBe(false);
    expect(saveSets("t", [], null)).toBe(false);
  });
});

describe("withSample", () => {
  it("puts the sample first", () => {
    const sets = withSample({ a: 1 }, [{ name: "X", values: 1 }]);
    expect(sets.map((s) => s.name)).toEqual([SAMPLE_SET_NAME, "X"]);
    expect(sets[0]?.builtin).toBe(true);
  });

  it("has no sample set without a sample", () => {
    expect(withSample(undefined, [{ name: "X", values: 1 }])).toEqual([
      { name: "X", values: 1 },
    ]);
  });
});

describe("upsertSet and removeSet", () => {
  const base = withSample({ a: 1 }, [{ name: "X", values: 1 }]);

  it("adds a trimmed name", () => {
    const r = upsertSet(base, "  Y ", 2);
    expect(r.ok && r.sets.map((s) => s.name)).toEqual([
      SAMPLE_SET_NAME,
      "X",
      "Y",
    ]);
  });

  it("replaces a set with the same name in place", () => {
    const r = upsertSet(base, "X", 9);
    expect(r.ok && r.sets[1]).toEqual({ name: "X", values: 9 });
  });

  it("rejects empty, long and sample names", () => {
    expect(upsertSet(base, "  ", 1).ok).toBe(false);
    expect(upsertSet(base, "x".repeat(61), 1).ok).toBe(false);
    expect(upsertSet(base, SAMPLE_SET_NAME, 1).ok).toBe(false);
  });

  it("removes saved sets but not the sample", () => {
    expect(removeSet(base, "X").map((s) => s.name)).toEqual([SAMPLE_SET_NAME]);
    expect(removeSet(base, SAMPLE_SET_NAME)).toHaveLength(2);
  });
});

describe("preferences", () => {
  it("falls back to defaults", () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("x")).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
  });

  it("turns the old single center switch into both lines", () => {
    const prefs = parsePrefs({ guides: { center: true } });
    expect([prefs.guides.centerH, prefs.guides.centerV]).toEqual([true, true]);
  });

  it("clamps the margin and fixes wrong types", () => {
    const prefs = parsePrefs({
      template: 5,
      guides: { margin: true, marginMm: 99, centerH: "yes" },
      size: { dpi: 300 },
    });
    expect(prefs.template).toBe("");
    expect(prefs.guides).toEqual({
      margin: true,
      marginMm: 20,
      centerH: false,
      centerV: false,
      debug: false,
    });
    expect(prefs.size.dpi).toBe(DEFAULT_PREFS.size.dpi);
  });

  it("round-trips", () => {
    const storage = memoryStorage();
    const prefs = {
      ...DEFAULT_PREFS,
      template: "badge",
      zoom: { kind: "percent" as const, percent: 200 },
    };
    expect(savePrefs(prefs, storage)).toBe(true);
    expect(loadPrefs(storage)).toEqual(prefs);
  });
});
