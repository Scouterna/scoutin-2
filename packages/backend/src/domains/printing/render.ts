// Turns a leased job into the image for its printer (docs/printer-proxy-spec.md).
// For now only the built-in "png" template exists: a ready-made 1-bit
// PNG in values.png (base64). TSX templates come with the renderer.

type Rendered = { png: Buffer; width: number; height: number };

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

export function render(template: string, values: unknown): Rendered {
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
