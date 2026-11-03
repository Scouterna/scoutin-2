// Turns a leased job into the image for its printer (docs/printer-proxy-spec.md).
// The built-in "png" template is a ready-made 1-bit PNG in values.png
// (base64). Badge templates are element trees: Satori -> SVG -> resvg ->
// threshold -> 1-bit PNG.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import {
  type Element,
  encode1bitPng,
  type Label,
  makeLabel,
  RENDER_THRESHOLD,
  type RenderFont,
  resolveImages,
  withRenderContext,
} from "@scouterna/scoutin-print-templates";
import type { Type } from "arktype";
import satori from "satori";

export { encode1bitPng, RENDER_THRESHOLD };

/** What the image looks like to the print head, for judging heat and ink. */
export type RenderStats = { blackPercent: number };

type Rendered = {
  png: Buffer;
  width: number;
  height: number;
  stats?: RenderStats;
};

/**
 * Share of dots that print black, from the gray image before it is encoded:
 * it uses the same cutoff as the encoder, so it counts what the printer burns.
 */
export function blackStats(gray: Uint8Array): RenderStats {
  let black = 0;
  for (const g of gray) if (g < RENDER_THRESHOLD) black++;
  const percent = gray.length === 0 ? 0 : (black / gray.length) * 100;
  return { blackPercent: Math.round(percent * 100) / 100 };
}

/** A permanent error: the job fails and is never retried. */
export class RenderError extends Error {}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Reads a PNG's size from its header. Doesn't check the pixel format: the
 * relay does that strictly (1-bit grayscale or 2-color palette).
 */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.toString("latin1", 12, 16) !== "IHDR"
  ) {
    throw new RenderError("not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export const PNG_TEMPLATE = "png";

export async function render(
  template: string,
  values: unknown,
): Promise<Rendered> {
  if (template !== PNG_TEMPLATE) {
    throw new RenderError(`unknown template "${template}"`);
  }
  const b64 = (values as { png?: unknown } | null)?.png;
  if (typeof b64 !== "string") {
    throw new RenderError("the png template needs values.png (base64)");
  }
  const png = Buffer.from(b64, "base64");
  return { png, ...pngSize(png) };
}

export type PrinterContext = {
  name: string;
  serial: string;
  pool: string;
  dpi: number;
  relay: string;
};

/** A template's label size in millimeters; a missing side follows the printer. */
export type TemplateSize = { widthMm?: number; lengthMm?: number };

export type TemplateModule = {
  default: (values: never, label: Label, ctx: PrinterContext) => Element;
  values?: Type;
  /** Example values for the template studio. */
  sample?: unknown;
  /** Fixed label size, for printers that report slightly different sizes. */
  size?: TemplateSize;
};

export type ImageLoader = (src: string) => Promise<Buffer | Uint8Array>;

const FONT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "assets",
  "fonts",
);

/** Roboto Regular and Bold, the default font for tests and the test label. */
export async function loadBuiltinFonts(): Promise<RenderFont[]> {
  return Promise.all(
    ([400, 700] as const).map(async (weight) => ({
      name: "Roboto",
      weight,
      style: "normal" as const,
      data: await readFile(
        join(FONT_DIR, `roboto-latin-${weight}-normal.woff`),
      ),
    })),
  );
}

export async function renderTemplate(args: {
  template: TemplateModule;
  values: unknown;
  label: { dpi: number; widthDots: number; heightDots: number };
  printer: PrinterContext;
  fonts: RenderFont[];
  imageLoader: ImageLoader;
  /** Draws Satori's box outlines, for previews only; the result isn't 1-bit. */
  debug?: boolean;
}): Promise<Rendered> {
  const { widthDots: width, heightDots: height } = args.label;
  try {
    const label = makeLabel(args.label);
    const tree = await withRenderContext({ fonts: args.fonts }, async () => {
      const el = (args.template.default as (...a: unknown[]) => Element)(
        args.values,
        label,
        args.printer,
      );
      return resolveImages(el, args.imageLoader);
    });
    const svg = await satori(tree as never, {
      width,
      height,
      debug: args.debug === true,
      fonts: args.fonts.map((f) => ({
        name: f.name,
        weight: f.weight as 400,
        style: f.style,
        data: f.data,
      })),
    });
    // White background: transparent pixels would read as black gray 0.
    const img = new Resvg(svg, {
      fitTo: { mode: "original" },
      background: "white",
    }).render();
    if (args.debug) {
      // The outlines are colored; a 1-bit threshold would lose some of them.
      return { png: Buffer.from(img.asPng()), width, height };
    }
    const rgba = img.pixels;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = Math.round(
        0.299 * (rgba[o] as number) +
          0.587 * (rgba[o + 1] as number) +
          0.114 * (rgba[o + 2] as number),
      );
    }
    if (img.width !== width || img.height !== height) {
      throw new Error("rendered size differs from the label size");
    }
    return {
      png: encode1bitPng(gray, width, height),
      width,
      height,
      stats: blackStats(gray),
    };
  } catch (err) {
    if (err instanceof RenderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new RenderError(`template failed: ${msg}`.slice(0, 200));
  }
}
