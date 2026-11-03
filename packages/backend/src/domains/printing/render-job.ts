// Renders a job for the printer that leased it. No database in here, so it
// can be tested on its own.

import { readFile } from "node:fs/promises";
import { mmToDots } from "@scouterna/scoutin-print-templates";
import sharp from "sharp";
import {
  blackStats,
  encode1bitPng,
  PNG_TEMPLATE,
  type PrinterContext,
  pngSize,
  RenderError,
  type RenderStats,
  render,
  renderTemplate,
  type TemplateSize,
} from "./render.ts";
import {
  getFonts,
  getTemplate,
  imageLoaderFor,
  type TemplateEntry,
  templateGeneration,
  templateHash,
  validateValues,
} from "./templates.service.ts";

export type RenderPrinter = PrinterContext & {
  widthDots: number;
  lengthDots: number;
};

export type RenderedJob = {
  png: Buffer;
  width: number;
  height: number;
  /** Not for the png template: it's passed through without decoding. */
  stats?: RenderStats;
};

/** The dots a template's size covers at a dpi, for the sides it defines. */
export function sizeToDots(
  size: TemplateSize | undefined,
  dpi: number,
): { widthDots?: number; lengthDots?: number } {
  return {
    widthDots:
      size?.widthMm === undefined ? undefined : mmToDots(size.widthMm, dpi),
    lengthDots:
      size?.lengthMm === undefined ? undefined : mmToDots(size.lengthMm, dpi),
  };
}

/** Keeps the most recently used entries, up to a fixed number. */
export class LruCache<V> {
  private map = new Map<string, V>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

// A job that goes back to the queue (a printer that dropped off, say) is
// rendered again when it's leased again; this makes that free.
export const renderCache = new LruCache<RenderedJob>(50);

/** Printed exactly as it is, padded with white at the bottom and right. */
async function renderStatic(
  name: string,
  entry: Extract<TemplateEntry, { kind: "static" }>,
  printer: RenderPrinter,
): Promise<RenderedJob> {
  const file = entry.files.get(printer.dpi);
  if (!file) {
    const have = [...entry.files.keys()].join(", ");
    throw new RenderError(
      `template "${name}" has no image for ${printer.dpi} dpi (has ${have})`,
    );
  }
  const png = await readFile(file);
  const { width, height } = pngSize(png);
  const { widthDots, lengthDots } = printer;
  if (width > widthDots || height > lengthDots) {
    throw new RenderError(
      `template "${name}" at ${printer.dpi} dpi is ${width}x${height}, larger than the label (${widthDots}x${lengthDots})`,
    );
  }
  const { data } = await sharp(png)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (width === widthDots && height === lengthDots) {
    return { png, width, height, stats: blackStats(data) };
  }
  const gray = new Uint8Array(widthDots * lengthDots).fill(255);
  for (let y = 0; y < height; y++) {
    gray.set(data.subarray(y * width, (y + 1) * width), y * widthDots);
  }
  return {
    png: encode1bitPng(gray, widthDots, lengthDots),
    width: widthDots,
    height: lengthDots,
    stats: blackStats(gray),
  };
}

/**
 * Renders a template for a printer: the label is the printer's full width and
 * label length at its dpi, or the template's own size for the sides it fixes
 * (never larger than the printer's label). With a jobId, repeated calls hit
 * the cache.
 */
export async function renderJob(args: {
  template: string;
  values: unknown;
  printer: RenderPrinter;
  jobId?: string;
  /** Previews only: box outlines, and never cached. */
  debug?: boolean;
}): Promise<RenderedJob> {
  const { template: name, printer } = args;
  if (name === PNG_TEMPLATE) return render(name, args.values);

  const entry = getTemplate(name);
  if (!entry) throw new RenderError(`unknown template "${name}"`);

  // A template's size fixes the canvas; the printer's label is only its limit.
  let widthDots = printer.widthDots;
  let heightDots = printer.lengthDots;
  if (entry.kind === "tsx") {
    const fixed = sizeToDots(entry.module.size, printer.dpi);
    if (fixed.widthDots !== undefined && fixed.widthDots > printer.widthDots) {
      throw new RenderError(
        `template "${name}" is ${fixed.widthDots} dots wide but the printer's label is ${printer.widthDots}`,
      );
    }
    if (
      fixed.lengthDots !== undefined &&
      fixed.lengthDots > printer.lengthDots
    ) {
      throw new RenderError(
        `template "${name}" is ${fixed.lengthDots} dots long but the printer's label is ${printer.lengthDots}`,
      );
    }
    widthDots = fixed.widthDots ?? widthDots;
    heightDots = fixed.lengthDots ?? heightDots;
  }

  // The generation is in the key because the hash covers only the template's
  // own source, not its images, fonts or helpers.
  const key =
    args.jobId && !args.debug
      ? [
          args.jobId,
          printer.dpi,
          printer.widthDots,
          printer.lengthDots,
          // The canvas too, though it follows from the template (whose hash
          // and generation are here) and the printer: cheap insurance.
          widthDots,
          heightDots,
          templateHash(name),
          templateGeneration(),
        ].join(":")
      : undefined;
  const cached = key ? renderCache.get(key) : undefined;
  if (cached) return cached;

  let out: RenderedJob;
  if (entry.kind === "static") {
    out = await renderStatic(name, entry, printer);
  } else {
    // Checked when the job was made, but the template may have changed since.
    const checked = validateValues(name, args.values);
    if (!checked.ok) {
      throw new RenderError(
        `values don't fit "${name}": ${checked.error}`.slice(0, 200),
      );
    }
    out = await renderTemplate({
      template: entry.module,
      values: checked.values,
      label: {
        dpi: printer.dpi,
        widthDots,
        heightDots,
      },
      printer: {
        name: printer.name,
        serial: printer.serial,
        pool: printer.pool,
        dpi: printer.dpi,
        relay: printer.relay,
      },
      fonts: getFonts(name),
      imageLoader: imageLoaderFor(name),
      debug: args.debug,
    });
  }
  if (key) renderCache.set(key, out);
  return out;
}
