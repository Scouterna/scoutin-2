import { encode } from "uqr";
import { type Element, h, type Style } from "./jsx.ts";
import { encode1bitPng } from "./png1.ts";

export type QRProps = {
  /** What the code says: a URL, an id. */
  value: string;
  /** The largest box in dots, quiet zone included. The code can end up smaller. */
  size: number;
  /** Error correction: L 7%, M 15%, Q 25%, H 30% of the code can be lost. */
  ecc?: "L" | "M" | "Q" | "H";
  /** White border in modules. Scanners need 4. */
  quiet?: number;
  /** The smallest module size that is allowed, in dots. */
  minModule?: number;
  /**
   * White modules on black, quiet zone included, for a black area. Phone
   * cameras read these but plenty of scanners don't, so test yours.
   */
  invert?: boolean;
  style?: Style;
  tw?: string;
};

/**
 * A QR code as an exact bitmap: every module is a whole number of dots, so
 * nothing is scaled or smoothed on the way to the printer. Place it where it
 * lands on whole dots; a half-dot offset blurs the edges.
 */
export function QR(props: QRProps): Element {
  const { value, size, ecc = "M", quiet = 4, minModule = 3 } = props;
  const invert = props.invert === true;
  const { data } = encode(value, { ecc, border: 0 });
  const modules = data.length;
  const total = modules + quiet * 2;
  const module = Math.floor(size / total);
  if (module < minModule) {
    throw new Error(
      `QR code for "${value}" has ${modules} modules, so ${size} dots gives ${module} dots per module (the minimum is ${minModule}). Make it bigger or the value shorter.`,
    );
  }
  const px = total * module;
  const gray = new Uint8Array(px * px).fill(invert ? 0 : 255);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!data[row]?.[col]) continue;
      const y0 = (row + quiet) * module;
      const x0 = (col + quiet) * module;
      for (let y = y0; y < y0 + module; y++) {
        gray.fill(invert ? 255 : 0, y * px + x0, y * px + x0 + module);
      }
    }
  }
  const png = encode1bitPng(gray, px, px);
  return h("img", {
    src: `data:image/png;base64,${png.toString("base64")}`,
    width: px,
    height: px,
    ...(props.tw === undefined ? {} : { tw: props.tw }),
    // Exact bitmap: shrinking it would break the whole-dot modules.
    style: { flexShrink: 0, ...props.style, width: px, height: px },
  });
}
