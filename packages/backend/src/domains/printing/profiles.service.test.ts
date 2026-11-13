import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROFILES_FILE,
  getProfile,
  getProfileStatus,
  listProfiles,
  loadProfiles,
} from "./profiles.service.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "profiles-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
async function loadText(text: string) {
  const file = join(dir, `p${n++}.yml`);
  await writeFile(file, text);
  const warn = vi.fn();
  const error = vi.fn();
  const status = await loadProfiles(file, { warn, error });
  return { status, warn, error };
}

describe("the real profiles file", () => {
  it("loads without problems and has badge-fanfold", async () => {
    const error = vi.fn();
    const status = await loadProfiles(DEFAULT_PROFILES_FILE, { error });
    expect(status.problems).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(status.loaded).toContain("badge-fanfold");
    expect(getProfile("badge-fanfold")?.["print.tone"]).toBe("15.0");
    expect(getProfile("badge-fanfold")?.["ezpl.print_width"]).toBe("800");
    expect(getProfile("badge-fanfold")?.["power.energy_star.enable"]).toBe(
      "off",
    );
  });
});

describe("loadProfiles", () => {
  it("treats a missing file as no profiles and warns once", async () => {
    const warn = vi.fn();
    const error = vi.fn();
    const status = await loadProfiles(join(dir, "missing.yml"), {
      warn,
      error,
    });
    expect(status.loaded).toEqual([]);
    expect(status.problems).toEqual([]);
    expect(listProfiles()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("no printer profiles file at");
    expect(error).not.toHaveBeenCalled();
  });

  it("treats an empty file as zero profiles and no problems", async () => {
    await loadProfiles(DEFAULT_PROFILES_FILE);
    const { status, warn, error } = await loadText("");
    expect(status).toMatchObject({ loaded: [], problems: [] });
    expect(listProfiles()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("loads valid profiles sorted, returning copies", async () => {
    const { status } = await loadText(
      'zeta:\n  media.speed: "3.0"\nalpha:\n  print.tone: "15.0"\n  device.languages: EPL_ZPL\n',
    );
    expect(status.problems).toEqual([]);
    expect(listProfiles().map((p) => p.name)).toEqual(["alpha", "zeta"]);
    const copy = getProfile("zeta");
    if (copy) copy["media.speed"] = "9";
    const listed = listProfiles()[1];
    if (listed) listed.settings["media.speed"] = "9";
    expect(getProfile("zeta")).toEqual({ "media.speed": "3.0" });
    expect(getProfile("nope")).toBeUndefined();
    expect(getProfileStatus().loaded).toEqual(["alpha", "zeta"]);
  });

  it("returns a status whose mutation does not affect the registry", async () => {
    await loadText('a:\n  media.speed: "3.0"\n');
    getProfileStatus().loaded.push("x");
    expect(getProfileStatus().loaded).toEqual(["a"]);
  });

  const bad: [string, string, string][] = [
    ["a number value", "a:\n  media.speed: 3\n", "Quote it"],
    ["a boolean value", "a:\n  wlan.enable: false\n", "Quote it"],
    ["a null value", "a:\n  wlan.enable:\n", "Quote it"],
    ["a bad key", 'a:\n  Media: "x"\n', 'key "Media"'],
    ["a key without a dot", 'a:\n  speed: "x"\n', 'key "speed"'],
    ["a quote in a value", "a:\n  media.speed: 'a\"b'\n", "double quote"],
    ["a newline in a value", 'a:\n  media.speed: "a\\nb"\n', "control"],
    ["a tab in a value", 'a:\n  media.speed: "a\\tb"\n', "control"],
    [
      "an over-long value",
      `a:\n  media.speed: "${"x".repeat(65)}"\n`,
      "65 characters",
    ],
    [
      "device.languages without zpl",
      "a:\n  device.languages: epl\n",
      "must include zpl",
    ],
    [
      "a bad profile name",
      'Bad Name:\n  media.speed: "3"\n',
      'Profile "Bad Name"',
    ],
    ["a non-mapping top level", "- a\n- b\n", "top level"],
    ["a scalar top level", "hello\n", "top level"],
    ["an empty profile", "a: {}\n", "non-empty mapping"],
    ["a null profile", "a:\n", "non-empty mapping"],
    ["a list profile", "a:\n  - x\n", "non-empty mapping"],
    ["invalid YAML", "a: [\n", "Could not parse"],
  ];
  for (const [label, text, expected] of bad) {
    it(`rejects ${label}`, async () => {
      const { status, error, warn } = await loadText(text);
      expect(status.problems.join("\n")).toContain(expected);
      expect(status.loaded).toEqual([]);
      expect(listProfiles()).toEqual([]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });
  }

  it("loads no profile when one is bad and reports every problem", async () => {
    const { status } = await loadText(
      'good:\n  media.speed: "3.0"\nbad:\n  media.speed: 3\n  Bad: "x"\n',
    );
    expect(status.loaded).toEqual([]);
    expect(listProfiles()).toEqual([]);
    expect(getProfile("good")).toBeUndefined();
    expect(status.problems).toHaveLength(2);
    expect(status.problems.every((p) => p.includes('"bad"'))).toBe(true);
  });

  it("reports a read error as a problem without throwing", async () => {
    const asDir = join(dir, "adir");
    await mkdir(asDir);
    const error = vi.fn();
    const status = await loadProfiles(asDir, { error });
    expect(status.loaded).toEqual([]);
    expect(status.problems).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
