// The template registry: built-in labels plus whatever is in the config
// directory (config/templates). Everything is loaded once at startup and any
// problem stops the server from starting, so a broken template shows up at
// deploy time and not on the first attendee's badge.
//
// In the directory:
//   <name>.tsx | <name>.ts   a template module (compiled at runtime with jiti)
//   <name>/<name>.tsx | .ts  the same as a folder, with its own images/ next
//                            to it; other directories hold helper modules
//   <name>@<dpi>.png         a static image template, one file per dpi
//   images/                  for <Img src="images/logo.png">
//   fonts/fonts.yml          extra fonts (a list of { file, family, weight })
//   <name>/fonts/fonts.yml   fonts for that folder template only

import { createHash } from "node:crypto";
import { type Dirent, existsSync, type FSWatcher, watch } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type Element,
  FitText,
  h,
  type Label,
  type RenderFont,
} from "@scouterna/scoutin-print-templates";
import { type Type, type } from "arktype";
import { createJiti, type Jiti } from "jiti";
import { parse as parseYaml } from "yaml";
import {
  type ImageLoader,
  loadBuiltinFonts,
  PNG_TEMPLATE,
  type PrinterContext,
  type TemplateModule,
  type TemplateSize,
} from "./render.ts";

export const DEFAULT_TEMPLATES_DIR = resolve("config", "templates");

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const STATIC_FILE = /^(.+)@(\d+)\.png$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff"];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const TEST_TEMPLATE = "_test";

type Entry =
  | {
      kind: "tsx";
      file: string;
      /** Set for a folder template: where its own assets live. */
      dir?: string;
      /** The fonts to render with: the global ones plus its own, if any. */
      fonts: RenderFont[];
      module: TemplateModule;
      hash: string;
    }
  | { kind: "static"; files: Map<number, string>; hash: string }
  | { kind: "builtin"; module: TemplateModule; hash: string };

export type TemplateEntry = Entry;

export type TemplateInfo = {
  name: string;
  kind: "tsx" | "static" | "builtin";
  dpis?: number[];
  /** JSON Schema of the values, when the template declares them. */
  valuesSchema?: unknown;
  /** Example values the template exports for the template studio. */
  sample?: unknown;
  /** The label size the template fixes, in millimeters. */
  size?: TemplateSize;
};

/** Everything that was wrong, one line per problem. */
export class TemplateLoadError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Templates failed to load (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.problems = problems;
  }
}

// ── Built-in test label ─────────────────────────────────────────────────────

const BORDER = 6;

// Written with h and no JSX so it works without any compile step. The border
// is a black box with a white one inside: Satori adds padding and border to
// a box's width and height instead of taking them from it, so a bordered
// label-sized box would overflow the label.
function testLabel(
  _values: unknown,
  label: Label,
  printer: PrinterContext,
): Element {
  const pad = label.mm(2);
  const width = label.width - 2 * (BORDER + pad);
  // Five lines have to fit on small labels too.
  const unit = (label.height - 2 * (BORDER + pad)) / 6;
  const small = (text: string) =>
    FitText({
      width,
      max: Math.max(20, Math.floor(unit * 0.8)),
      min: 20,
      fontWeight: 400,
      children: text,
    });
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: label.width,
        height: label.height,
        backgroundColor: "black",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: label.width - 2 * (BORDER + pad),
          height: label.height - 2 * (BORDER + pad),
          padding: pad,
          backgroundColor: "white",
          color: "black",
        },
      },
      FitText({
        width,
        max: Math.max(28, Math.floor(unit * 1.5)),
        min: 28,
        fontWeight: 700,
        children: printer.name || printer.serial,
      }),
      small(`Serial ${printer.serial}`),
      small(`Pool ${printer.pool}`),
      small(`Relay ${printer.relay}`),
      small(`${printer.dpi} dpi, ${label.width} x ${label.height} dots`),
    ),
  );
}

const builtinTest: TemplateModule = {
  default: testLabel as TemplateModule["default"],
  values: type({}),
};

// ── Registry state ──────────────────────────────────────────────────────────

let entries = new Map<string, Entry>();
let fonts: RenderFont[] = await loadBuiltinFonts();
let templatesDir = DEFAULT_TEMPLATES_DIR;
// Bumped whenever the registry is replaced. The template hash only covers the
// template's own source, so an edited image, font or helper module would not
// change it; the render cache keys on this as well to never serve a stale
// render.
let generation = 0;

function builtins(): Map<string, Entry> {
  return new Map<string, Entry>([
    [
      TEST_TEMPLATE,
      { kind: "builtin", module: builtinTest, hash: "builtin:_test:1" },
    ],
  ]);
}

// Until loadTemplates runs (tests, tools) only the built-ins exist.
entries = builtins();

export function getTemplate(name: string): Entry | undefined {
  return entries.get(name);
}

/**
 * The fonts a template renders with. A folder template with its own fonts gets
 * them on top of the global ones; any other name gets the global set.
 */
export function getFonts(name?: string): RenderFont[] {
  const entry = name ? entries.get(name) : undefined;
  return entry?.kind === "tsx" ? entry.fonts : fonts;
}

export function templateHash(name: string): string | undefined {
  return entries.get(name)?.hash;
}

/** Changes on every successful (re)load, whatever files changed. */
export function templateGeneration(): number {
  return generation;
}

export function listTemplates(): TemplateInfo[] {
  return [...entries]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => {
      const info: TemplateInfo = { name, kind: e.kind };
      if (e.kind === "static") {
        info.dpis = [...e.files.keys()].sort((a, b) => a - b);
      } else if (e.module.values && e.kind === "tsx") {
        try {
          info.valuesSchema = e.module.values.toJsonSchema();
        } catch {
          // A schema JSON Schema can't express (morphs, for one): no form.
        }
      }
      if (e.kind === "tsx" && e.module.sample !== undefined) {
        info.sample = e.module.sample;
      }
      if (e.kind === "tsx" && e.module.size !== undefined) {
        info.size = e.module.size;
      }
      return info;
    });
}

export type ValuesResult =
  | { ok: true; values: unknown }
  | { ok: false; error: string };

/** Checks values against the template's schema. No schema: accepted as is. */
export function validateValues(name: string, values: unknown): ValuesResult {
  const entry = entries.get(name);
  if (!entry) return { ok: false, error: `Unknown template "${name}"` };
  if (entry.kind === "static" || !entry.module.values) {
    return { ok: true, values };
  }
  const out = entry.module.values(values);
  if (out instanceof type.errors) return { ok: false, error: out.summary };
  return { ok: true, values: out };
}

/**
 * Reads an image from the first of the base directories that has it. A path
 * that leaves a base, by ".." or by a symlink, is refused outright instead of
 * falling through to the next one.
 */
async function readImage(bases: string[], src: string): Promise<Buffer> {
  for (const base of bases) {
    const root = await realpath(base).catch(() => undefined);
    if (!root) continue;
    const path = resolve(root, src);
    const rel = relative(root, path);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Image path "${src}" leaves the templates directory`);
    }
    // Symlinks could point out of the directory, so check where it really is.
    const real = await realpath(path).catch(() => undefined);
    if (!real) continue;
    if (real !== root && !real.startsWith(root + sep)) {
      throw new Error(`Image path "${src}" leaves the templates directory`);
    }
    const { size } = await stat(real);
    if (size > MAX_IMAGE_BYTES) {
      throw new Error(`Image "${src}" is larger than 2 MB`);
    }
    return readFile(real);
  }
  throw new Error(`Image "${src}" not found`);
}

/** Loads images for <Img>, from inside the templates directory only. */
export const imageLoader: ImageLoader = (src) => readImage([templatesDir], src);

/**
 * The image loader for one template. A folder template looks in its own
 * folder first and then in the templates root, so shared images still work;
 * any other template only sees the root.
 */
export function imageLoaderFor(name: string): ImageLoader {
  const entry = entries.get(name);
  const own = entry?.kind === "tsx" ? entry.dir : undefined;
  return (src) => readImage(own ? [own, templatesDir] : [templatesDir], src);
}

// ── Loading ─────────────────────────────────────────────────────────────────

const FontManifest = type({
  file: "string > 0",
  family: "string > 0",
  weight: "100 <= number.integer <= 900",
  "style?": "'normal' | 'italic'",
}).array();

const sha = (...parts: (Buffer | string)[]) => {
  const hash = createHash("sha256");
  for (const p of parts) hash.update(p);
  return hash.digest("hex");
};

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0]?.slice(0, 300) ?? "unknown error";
}

function checkName(name: string, file: string, problems: string[]): boolean {
  if (name === PNG_TEMPLATE || name.startsWith("_")) {
    problems.push(
      `${file}: the name "${name}" is reserved for built-in labels`,
    );
    return false;
  }
  if (!NAME.test(name)) {
    problems.push(
      `${file}: "${name}" is not a valid template name (lowercase letters, digits, "-" and "_", starting with a letter or digit)`,
    );
    return false;
  }
  return true;
}

/**
 * Throws unless this is a 1-bit grayscale PNG or one with a 2-color palette,
 * the only kinds the relay accepts.
 */
function checkPng1bit(png: Buffer): void {
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.toString("latin1", 12, 16) !== "IHDR"
  ) {
    throw new Error("not a PNG");
  }
  const depth = png[24];
  const color = png[25];
  if (color === 0 && depth === 1) return;
  if (color === 3 && (depth as number) <= 8) {
    let off = 8;
    while (off + 12 <= png.length) {
      const len = png.readUInt32BE(off);
      const kind = png.toString("latin1", off + 4, off + 8);
      if (kind === "PLTE") {
        if (len / 3 === 2) return;
        throw new Error(`a palette of ${len / 3} colors, not 2`);
      }
      off += len + 12;
    }
    throw new Error("a palette PNG without a palette");
  }
  throw new Error(
    `bit depth ${depth}, color type ${color}: it must be 1-bit grayscale or have a 2-color palette`,
  );
}

function usesClassicPragma(source: string): boolean {
  return /@jsx\s+[\w.$]/.test(source);
}

function makeJiti(runtime: "automatic" | "classic"): Jiti {
  return createJiti(import.meta.url, {
    // The config directory may be a read-only mount, and templates are
    // loaded once, so neither cache is of any use.
    fsCache: false,
    moduleCache: false,
    jsx:
      runtime === "automatic"
        ? {
            runtime: "automatic",
            importSource: "@scouterna/scoutin-print-templates",
          }
        : { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" },
  });
}

async function loadModule(
  file: string,
  path: string,
  jitis: { automatic: Jiti; classic: Jiti },
  warn: (msg: string) => void,
  problems: string[],
): Promise<{ module: TemplateModule; hash: string } | undefined> {
  let source: Buffer;
  let mod: Record<string, unknown>;
  try {
    source = await readFile(path);
    // Babel refuses a classic "@jsx" pragma while the runtime is automatic,
    // so such a file is compiled by the classic instance instead.
    const jiti = usesClassicPragma(source.toString("utf8"))
      ? jitis.classic
      : jitis.automatic;
    mod = (await jiti.import(path)) as Record<string, unknown>;
  } catch (err) {
    problems.push(`${file}: could not be loaded: ${firstLine(err)}`);
    return undefined;
  }
  if (typeof mod.default !== "function") {
    problems.push(`${file}: the default export must be a function`);
    return undefined;
  }
  let schema: Type | undefined;
  if (mod.values === undefined) {
    warn(`Template ${file} exports no "values": its values aren't validated`);
  } else if (
    typeof mod.values !== "function" ||
    typeof (mod.values as { toJsonSchema?: unknown }).toJsonSchema !==
      "function"
  ) {
    problems.push(`${file}: "values" must be an ArkType type`);
    return undefined;
  } else {
    schema = mod.values as Type;
  }
  // The sample only feeds the studio, but a wrong one would send authors
  // chasing a bug in the template, so it is held to the same schema.
  if (mod.sample !== undefined) {
    if (
      typeof mod.sample !== "object" ||
      mod.sample === null ||
      Array.isArray(mod.sample)
    ) {
      problems.push(`${file}: "sample" must be an object`);
      return undefined;
    }
    if (schema) {
      const checked = schema(mod.sample);
      if (checked instanceof type.errors) {
        problems.push(
          `${file}: "sample" doesn't fit "values": ${checked.summary.split("\n")[0]?.slice(0, 300)}`,
        );
        return undefined;
      }
    }
  }
  let size: TemplateSize | undefined;
  if (mod.size !== undefined) {
    const parsed = parseSize(mod.size);
    if (typeof parsed === "string") {
      problems.push(`${file}: ${parsed}`);
      return undefined;
    }
    size = parsed;
  }
  return {
    module: {
      default: mod.default as TemplateModule["default"],
      values: schema,
      sample: mod.sample,
      size,
    },
    hash: sha(source),
  };
}

export const MIN_SIZE_MM = 20;
export const MAX_SIZE_MM = 500;

/** The checked size, or the reason it is wrong. */
function parseSize(raw: unknown): TemplateSize | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return '"size" must be an object like { widthMm, lengthMm }';
  }
  const out: TemplateSize = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key !== "widthMm" && key !== "lengthMm") {
      return `"size" has an unknown key "${key}" (use widthMm and lengthMm)`;
    }
    if (val === undefined) continue;
    if (
      typeof val !== "number" ||
      !Number.isFinite(val) ||
      val < MIN_SIZE_MM ||
      val > MAX_SIZE_MM
    ) {
      return `"size.${key}" must be a number from ${MIN_SIZE_MM} to ${MAX_SIZE_MM} (millimeters)`;
    }
    out[key] = val;
  }
  if (out.widthMm === undefined && out.lengthMm === undefined) {
    return '"size" needs widthMm, lengthMm or both';
  }
  return out;
}

/**
 * A configured font replaces one with the same family, weight and style, so a
 * brand can supply its own "Roboto" and a template its own version of a
 * global font.
 */
function layerFonts(base: RenderFont[], extra: RenderFont[]): RenderFont[] {
  return [
    ...base.filter(
      (b) =>
        !extra.some(
          (e) =>
            e.name === b.name && e.weight === b.weight && e.style === b.style,
        ),
    ),
    ...extra,
  ];
}

/**
 * Reads <fontsDir>/fonts.yml and the files it lists. No manifest is fine.
 * Problems are prefixed with `label` (the directory, from the templates root).
 */
async function readFontManifest(
  fontsDir: string,
  label: string,
  problems: string[],
): Promise<RenderFont[]> {
  const manifest = join(fontsDir, "fonts.yml");
  if (!existsSync(manifest)) return [];
  const file = `${label}/fonts.yml`;
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(manifest, "utf8"));
  } catch (err) {
    problems.push(`${file}: ${firstLine(err)}`);
    return [];
  }
  const list = FontManifest(parsed ?? []);
  if (list instanceof type.errors) {
    problems.push(`${file}: ${list.summary}`);
    return [];
  }
  const extra: RenderFont[] = [];
  for (const item of list) {
    const where = `${file} (${item.file})`;
    const lower = item.file.toLowerCase();
    const rel = relative(fontsDir, resolve(fontsDir, item.file));
    if (rel.startsWith("..") || isAbsolute(rel)) {
      problems.push(`${where}: the file must be inside ${label}/`);
      continue;
    }
    if (lower.endsWith(".woff2")) {
      problems.push(`${where}: WOFF2 isn't supported, use TTF, OTF or WOFF`);
      continue;
    }
    if (!FONT_EXTENSIONS.some((e) => lower.endsWith(e))) {
      problems.push(`${where}: the file must be TTF, OTF or WOFF`);
      continue;
    }
    let data: Buffer;
    try {
      data = await readFile(resolve(fontsDir, item.file));
    } catch {
      problems.push(`${where}: file not found`);
      continue;
    }
    const magic = data.toString("latin1", 0, 4);
    if (magic === "wOF2") {
      problems.push(`${where}: WOFF2 isn't supported, use TTF, OTF or WOFF`);
      continue;
    }
    if (!["wOFF", "OTTO", "true", "ttcf", "\0\u0001\0\0"].includes(magic)) {
      problems.push(`${where}: not a TTF, OTF or WOFF font`);
      continue;
    }
    extra.push({
      name: item.family,
      weight: item.weight,
      style: item.style ?? "normal",
      data,
    });
  }
  return extra;
}

async function loadFonts(
  dir: string,
  problems: string[],
): Promise<RenderFont[]> {
  return layerFonts(
    await loadBuiltinFonts(),
    await readFontManifest(join(dir, "fonts"), "fonts", problems),
  );
}

// ── Load status ─────────────────────────────────────────────────────────────

export type LoadStatus = {
  /** Counts every load attempt, so a poller sees a failed reload too. */
  revision: number;
  loadedAt: string;
  /** One line per problem of the latest attempt; null when it succeeded. */
  error: string[] | null;
};

let status: LoadStatus = {
  revision: 0,
  loadedAt: new Date().toISOString(),
  error: null,
};
let lastDir = DEFAULT_TEMPLATES_DIR;

export function getLoadStatus(): LoadStatus {
  return { ...status, error: status.error && [...status.error] };
}

/** The directory the latest load attempt read, for reloading it. */
export function getTemplatesDir(): string {
  return lastDir;
}

// Two loads at once would race on the registry and on what the status says,
// so they take turns.
let loadQueue: Promise<unknown> = Promise.resolve();

/**
 * Loads every template in the directory, replacing what was loaded before.
 * Collects all problems and throws them together; the previous registry stays
 * active then. A missing directory is fine: only the built-ins exist then.
 */
export function loadTemplates(
  templatesPath: string = DEFAULT_TEMPLATES_DIR,
  options: { warn?: (msg: string) => void } = {},
): Promise<void> {
  const run = loadQueue.then(async () => {
    lastDir = resolve(templatesPath);
    try {
      await loadFromDisk(templatesPath, options);
      status = {
        revision: status.revision + 1,
        loadedAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      status = {
        revision: status.revision + 1,
        loadedAt: new Date().toISOString(),
        error:
          err instanceof TemplateLoadError ? err.problems : [firstLine(err)],
      };
      throw err;
    }
  });
  loadQueue = run.catch(() => undefined);
  return run;
}

async function loadFromDisk(
  templatesPath: string,
  options: { warn?: (msg: string) => void },
): Promise<void> {
  // jiti resolves a relative path against this file, not the working directory.
  const dir = resolve(templatesPath);
  const warn = options.warn ?? (() => undefined);
  const problems: string[] = [];
  const next = builtins();

  let dirents: Dirent[] = [];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new TemplateLoadError([`${dir}: ${firstLine(err)}`]);
    }
  }
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  const nextFonts = await loadFonts(dir, problems);
  const jitis = {
    automatic: makeJiti("automatic"),
    classic: makeJiti("classic"),
  };
  const modules = new Map<string, string>();
  const statics = new Map<string, Map<number, string>>();

  // Folder templates: name -> the folder's absolute path.
  const folders = new Map<string, string>();

  for (const d of dirents) {
    if (d.isDirectory() && d.name !== "images" && d.name !== "fonts") {
      // Only a directory holding <name>.tsx or <name>.ts is a template; any
      // other stays free for helper modules.
      const found: string[] = [];
      for (const ext of [".tsx", ".ts"]) {
        const inner = await stat(join(dir, d.name, `${d.name}${ext}`)).catch(
          () => undefined,
        );
        if (inner?.isFile()) found.push(`${d.name}${ext}`);
      }
      if (found.length === 0) continue;
      const label = `${d.name}/${found[0]}`;
      if (!checkName(d.name, label, problems)) continue;
      if (found.length > 1) {
        problems.push(`${label}: ${found[1]} also defines "${d.name}"`);
        continue;
      }
      if (modules.has(d.name)) {
        problems.push(
          `${label}: ${modules.get(d.name)} already defines "${d.name}"`,
        );
        continue;
      }
      modules.set(d.name, label);
      folders.set(d.name, join(dir, d.name));
      continue;
    }
    if (!d.isFile()) continue;
    const staticMatch = STATIC_FILE.exec(d.name);
    if (staticMatch) {
      const name = staticMatch[1] as string;
      if (!checkName(name, d.name, problems)) continue;
      const dpi = Number(staticMatch[2]);
      if (dpi < 72 || dpi > 1200) {
        problems.push(`${d.name}: ${dpi} is not a plausible dpi`);
        continue;
      }
      try {
        checkPng1bit(await readFile(join(dir, d.name)));
      } catch (err) {
        problems.push(`${d.name}: ${firstLine(err)}`);
        continue;
      }
      const files = statics.get(name) ?? new Map<number, string>();
      files.set(dpi, join(dir, d.name));
      statics.set(name, files);
      continue;
    }
    const ext = [".tsx", ".ts"].find((e) => d.name.endsWith(e));
    if (!ext || d.name.endsWith(".d.ts")) continue;
    const name = d.name.slice(0, -ext.length);
    if (!checkName(name, d.name, problems)) continue;
    if (modules.has(name)) {
      problems.push(
        `${d.name}: ${modules.get(name)} already defines "${name}"`,
      );
      continue;
    }
    modules.set(name, d.name);
  }

  for (const [name, file] of modules) {
    if (statics.has(name)) {
      problems.push(`${file}: "${name}" is also a static image template`);
      continue;
    }
    const loaded = await loadModule(
      file,
      join(dir, file),
      jitis,
      warn,
      problems,
    );
    if (loaded) {
      const folder = folders.get(name);
      // Read at load, with the other problems, so a bad template font stops
      // the load like a bad global one and nothing is read per render.
      const own = folder
        ? await readFontManifest(
            join(folder, "fonts"),
            `${name}/fonts`,
            problems,
          )
        : [];
      next.set(name, {
        kind: "tsx",
        file: join(dir, file),
        dir: folder,
        fonts: own.length > 0 ? layerFonts(nextFonts, own) : nextFonts,
        ...loaded,
      });
    }
  }

  for (const [name, files] of statics) {
    if (modules.has(name)) continue;
    const parts: Buffer[] = [];
    for (const dpi of [...files.keys()].sort((a, b) => a - b)) {
      parts.push(
        Buffer.from(`${dpi}:`),
        await readFile(files.get(dpi) as string),
      );
    }
    next.set(name, { kind: "static", files, hash: sha(...parts) });
  }

  if (problems.length > 0) throw new TemplateLoadError(problems);

  entries = next;
  generation++;
  fonts = nextFonts;
  templatesDir = dir;
}

// ── Watching (development) ──────────────────────────────────────────────────

const WATCH_DEBOUNCE_MS = 250;
const WATCH_RETRY_MS = 2000;
const TEMP_SUFFIXES = [".swp", ".swx", ".tmp", ".orig"];

/** Editor scratch files: saving one must not trigger a reload. */
export function isEditorTempFile(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.some((p) => p.startsWith("."))) return true;
  const name = basename(path);
  return (
    name.endsWith("~") ||
    TEMP_SUFFIXES.some((s) => name.endsWith(s)) ||
    /^\d+$/.test(name)
  );
}

export type WatcherOptions = {
  log?: (msg: string, detail?: unknown) => void;
  warn?: (msg: string) => void;
  debounceMs?: number;
  retryMs?: number;
};

type WatchSession = { stopped: boolean; close: () => void };
let watchSession: WatchSession | undefined;

/**
 * Reloads the templates when anything under the directory changes, helper
 * modules, images and fonts included. Meant for development only: the
 * registry is replaced under running renders.
 */
export function startTemplateWatcher(
  dir: string,
  options: WatcherOptions = {},
): void {
  stopTemplateWatcher();
  const root = resolve(dir);
  const log = options.log ?? (() => undefined);
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? WATCH_RETRY_MS;

  let watcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let attachedBefore = false;
  const session: WatchSession = {
    stopped: false,
    close: () => {
      session.stopped = true;
      watcher?.close();
      clearTimeout(debounce);
      clearInterval(retry);
    },
  };

  // A change during a reload means the reload may have read half of it, so
  // it runs once more afterwards instead of in parallel.
  const reload = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await loadTemplates(root, { warn: options.warn });
          log("Templates reloaded");
        } catch (err) {
          log("Templates failed to reload", err);
        }
      } while (again && !session.stopped);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void reload(), debounceMs);
    debounce.unref();
  };

  const attach = (): boolean => {
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename && isEditorTempFile(filename.toString())) return;
        schedule();
      });
    } catch {
      return false;
    }
    // The directory itself being removed or renamed ends up here.
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
      startRetrying();
    });
    // Files may have appeared while nothing was watching.
    if (attachedBefore) schedule();
    attachedBefore = true;
    return true;
  };

  const startRetrying = () => {
    if (session.stopped) return;
    clearInterval(retry);
    retry = setInterval(() => {
      if (attach()) clearInterval(retry);
    }, retryMs);
    retry.unref();
  };

  watchSession = session;
  if (!attach()) {
    attachedBefore = true;
    startRetrying();
  }
}

export function stopTemplateWatcher(): void {
  watchSession?.close();
  watchSession = undefined;
}
