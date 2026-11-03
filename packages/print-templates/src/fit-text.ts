import opentype from "opentype.js";
import { getRenderContext, type RenderFont } from "./context.ts";
import { type Children, type Element, h, type Style } from "./jsx.ts";

const REF_SIZE = 100;

// Parsing a font is slow; the buffers are the same object on every render.
const parsed = new WeakMap<object, opentype.Font>();

function parse(font: RenderFont): opentype.Font {
  const key = font.data as object;
  let f = parsed.get(key);
  if (!f) {
    const buf = font.data;
    const ab =
      buf instanceof ArrayBuffer
        ? buf
        : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    f = opentype.parse(ab as ArrayBuffer);
    parsed.set(key, f);
  }
  return f;
}

// getAdvanceWidth runs GSUB, which opentype.js can't parse for some fonts
// (Roboto's included). Summing advances plus kerning is close enough for
// fitting, and the 0.98 factor absorbs ligature differences.
function measure(font: opentype.Font, text: string): number {
  const scale = REF_SIZE / font.unitsPerEm;
  let units = 0;
  let prev: opentype.Glyph | undefined;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    units += glyph.advanceWidth ?? 0;
    if (prev) units += font.getKerningValue(prev, glyph);
    prev = glyph;
  }
  return units * scale;
}

function pickFont(
  fonts: RenderFont[],
  family: string | undefined,
  weight: number,
): RenderFont {
  const pool = family ? fonts.filter((f) => f.name === family) : fonts;
  if (pool.length === 0) {
    throw new Error(`FitText: no font "${family}" loaded`);
  }
  // Same nearest-weight idea as the renderer, so the measure matches the paint.
  return pool.reduce((best, f) =>
    Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best,
  );
}

function textOf(children: Children): string {
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  return "";
}

// Measured widths are a little optimistic (no ligatures, no GSUB), so the
// available width is shrunk by this much when deciding what fits.
const SAFETY = 1.02;

// How many lines the text takes at a font size, wrapping at spaces like the
// renderer does; null when a single word is wider than the box.
function lineCount(
  font: opentype.Font,
  words: string[],
  size: number,
  width: number,
): number | null {
  const k = size / REF_SIZE;
  const space = measure(font, " ") * k;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = measure(font, word) * k * SAFETY;
    if (w > width) return null;
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else {
      lines++;
      used = w;
    }
  }
  return lines;
}

export type FitTextProps = {
  /** Available width in dots. */
  width: number;
  /** Largest and smallest font size in dots. */
  max: number;
  min: number;
  /**
   * Wrap onto at most this many lines, at the largest size that fits in them.
   * Without it the text stays on one line and shrinks. Explicit newlines in
   * the text are forced line breaks in this mode only; elsewhere they collapse
   * to spaces.
   */
  maxLines?: number;
  /**
   * When the text still doesn't fit at `min`, wrap and cut it off after this
   * many lines. Ignored when `maxLines` is set.
   */
  lineClamp?: number;
  /**
   * Extra styles, such as color, textAlign or margins. What the fitting itself
   * sets (size, width, wrapping) wins over these, and anything that changes the
   * text's width (letterSpacing, textTransform) isn't measured.
   */
  style?: Style;
  /** Tailwind classes, as on any other element. */
  tw?: string;
  fontFamily?: string;
  fontWeight?: number;
  children?: Children;
};

export function FitText(props: FitTextProps): Element {
  const { width, max, min, lineClamp = 1, fontWeight = 400 } = props;
  const { fonts } = getRenderContext();
  const font = pickFont(fonts, props.fontFamily, fontWeight);
  const text = textOf(props.children);

  if (props.maxLines !== undefined && props.maxLines > 1) {
    return fitLines(props, font, text);
  }

  // Satori collapses newlines to spaces here, so measure them as spaces
  // (a raw "\n" would be measured as a missing glyph).
  const measured = measure(parse(font), text.replace(/\s+/g, " "));
  const fitted =
    measured > 0 ? Math.min(max, (REF_SIZE * width) / measured) * 0.98 : max;
  const size = Math.max(min, Math.floor(fitted));

  const style: Style = {
    ...props.style,
    display: "block",
    width,
    fontFamily: font.name,
    fontWeight: font.weight,
    fontSize: size,
  };
  // At the minimum size the text may still not fit: wrap, then ellipsize.
  if (fitted < min) {
    style.lineClamp = lineClamp;
    style.textOverflow = "ellipsis";
  } else {
    style.whiteSpace = "nowrap";
  }
  return h("div", withTw(props, style), text);
}

function withTw(props: FitTextProps, style: Style) {
  return props.tw === undefined ? { style } : { tw: props.tw, style };
}

// maxLines mode: the largest size whose wrapped text fits in the line limit.
function fitLines(props: FitTextProps, font: RenderFont, text: string) {
  const { width, max, min, maxLines = 1 } = props;
  const parsedFont = parse(font);
  // Explicit newlines are forced breaks, so each paragraph wraps on its own;
  // an empty one is a blank line (it still takes a row when painted).
  const paragraphs = text
    .split(/\r\n|\r|\n/)
    .map((p) => p.split(/\s+/).filter((w) => w !== ""));
  let size = min;
  for (let s = Math.floor(max); s >= min; s--) {
    let lines = 0;
    for (const words of paragraphs) {
      const n = words.length === 0 ? 1 : lineCount(parsedFont, words, s, width);
      if (n === null) {
        lines = Infinity;
        break;
      }
      lines += n;
    }
    if (lines <= maxLines) {
      size = s;
      break;
    }
  }
  // If nothing fits, `size` stays at min and the clamp ends it with an ellipsis.
  return h(
    "div",
    withTw(props, {
      ...props.style,
      display: "block",
      width,
      fontFamily: font.name,
      fontWeight: font.weight,
      fontSize: size,
      // Without this Satori collapses the newlines into spaces.
      whiteSpace: "pre-line",
      lineClamp: maxLines,
      textOverflow: "ellipsis",
    }),
    text,
  );
}
