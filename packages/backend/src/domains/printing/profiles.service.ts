// Printer profiles: the expected settings for a kind of badge stock, loaded
// once at startup from config/printerProfiles.yml (docs/printer-proxy-spec.md
// §8.9). Admin applies a profile to a printer; the relay sets each value with
// an SGD command.
//
// A bad file must never take down the check-in server, and a half-valid
// profile set is worse than none (it could apply a partly wrong
// configuration). So loading is all-or-nothing: any problem means no profiles
// are loaded, the problems are reported, and nothing is thrown.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const DEFAULT_PROFILES_FILE = resolve("config", "printerProfiles.yml");

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
// Keys and values are interpolated into a quoted SGD command by the relay:
//   ! U1 setvar "<key>" "<value>"
// so they are restricted to what can't break out of the quotes or the line.
// Keys are SGD names such as media.speed.
const KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const MAX_VALUE_LENGTH = 64;

export type ProfilesStatus = {
  file: string;
  loaded: string[];
  problems: string[];
};

type Profiles = Map<string, Record<string, string>>;

let registry: Profiles = new Map();
let status: ProfilesStatus = {
  file: DEFAULT_PROFILES_FILE,
  loaded: [],
  problems: [],
};

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validateValue(
  where: string,
  key: string,
  value: unknown,
  problems: string[],
) {
  const at = `Profile "${where}", key "${key}"`;
  if (typeof value !== "string") {
    problems.push(
      `${at}: the value must be a string, got ${value === null ? "null" : typeof value}. Quote it, for example "800".`,
    );
    return;
  }
  if (value.includes('"')) {
    problems.push(`${at}: the value must not contain a double quote.`);
  }
  if (hasControlCharacter(value)) {
    problems.push(
      `${at}: the value must not contain a newline or other control character.`,
    );
  }
  if (value.length > MAX_VALUE_LENGTH) {
    problems.push(
      `${at}: the value is ${value.length} characters, the limit is ${MAX_VALUE_LENGTH}.`,
    );
  }
  // Without ZPL the printer would stop understanding the relay and become
  // unreachable.
  if (key === "device.languages" && !/zpl/i.test(value)) {
    problems.push(
      `${at}: the value must include zpl, or the printer stops understanding the relay.`,
    );
  }
}

function validate(doc: unknown): { profiles: Profiles; problems: string[] } {
  const profiles: Profiles = new Map();
  const problems: string[] = [];
  if (doc === null || doc === undefined) return { profiles, problems };
  if (!isMapping(doc)) {
    problems.push(
      "The top level must be a mapping of profile names to settings.",
    );
    return { profiles, problems };
  }

  for (const [name, body] of Object.entries(doc)) {
    if (!NAME.test(name)) {
      problems.push(
        `Profile "${name}": the name must be lowercase letters, digits, "-" and "_", starting with a letter or digit.`,
      );
    }
    if (!isMapping(body) || Object.keys(body).length === 0) {
      problems.push(
        `Profile "${name}": must be a non-empty mapping of settings.`,
      );
      continue;
    }
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!KEY.test(key)) {
        problems.push(
          `Profile "${name}", key "${key}": not a valid setting name (expected something like media.speed: lowercase letters, digits and "_", with dots).`,
        );
      }
      validateValue(name, key, value, problems);
      if (typeof value === "string") settings[key] = value;
    }
    profiles.set(name, settings);
  }
  return { profiles, problems };
}

/**
 * Loads the profiles file into the registry and returns what happened. Never
 * throws: a missing file means no profiles, and any problem in the file means
 * no profiles plus a list of problems.
 */
export async function loadProfiles(
  file = DEFAULT_PROFILES_FILE,
  opts?: { warn?: (msg: string) => void; error?: (msg: string) => void },
): Promise<ProfilesStatus> {
  let profiles: Profiles = new Map();
  let problems: string[] = [];

  let text: string | undefined;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      opts?.warn?.(`no printer profiles file at ${file}`);
    } else {
      problems = [
        `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
      ];
    }
  }

  if (text !== undefined) {
    try {
      ({ profiles, problems } = validate(parseYaml(text)));
    } catch (err) {
      problems = [
        `Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
      ];
    }
  }

  if (problems.length > 0) {
    profiles = new Map();
    opts?.error?.(
      `Printer profiles not loaded, ${problems.length} problem(s) in ${file}:\n${problems.join("\n")}`,
    );
  }

  registry = profiles;
  status = { file, loaded: [...profiles.keys()].sort(), problems };
  return getProfileStatus();
}

export function listProfiles(): {
  name: string;
  settings: Record<string, string>;
}[] {
  return [...registry.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, settings]) => ({ name, settings: { ...settings } }));
}

export function getProfile(name: string): Record<string, string> | undefined {
  const settings = registry.get(name);
  return settings && { ...settings };
}

export function getProfileStatus(): ProfilesStatus {
  return {
    file: status.file,
    loaded: [...status.loaded],
    problems: [...status.problems],
  };
}
