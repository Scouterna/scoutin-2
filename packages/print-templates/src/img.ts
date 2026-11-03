import { isAbsolute, normalize } from "node:path";
import sharp from "sharp";
import {
  type Children,
  type Element,
  h,
  rootElement,
  type Style,
} from "./jsx.ts";

type ImgBase = {
  /** Path relative to the templates directory. */
  src: string;
  /** Floyd-Steinberg dither instead of a plain threshold. */
  dither?: boolean;
  /** Extra styles, such as margins. The image size always wins over these. */
  style?: Style;
  /** Tailwind classes, as on any other element. */
  tw?: string;
};

/**
 * Size in dots. Give one side and the aspect ratio is kept; give both and the
 * image is fitted inside that box.
 */
export type ImgProps = ImgBase &
  ({ width: number; height?: number } | { width?: number; height: number });

type Marker = {
  src: string;
  width?: number;
  height?: number;
  dither: boolean;
  style?: Style;
  tw?: string;
};

// h is synchronous but reading and resizing aren't, so Img only leaves a
// marker that resolveImages swaps for a real <img> before Satori runs.
export function Img(props: ImgProps): Element {
  if (props.width === undefined && props.height === undefined) {
    throw new Error(`Img "${props.src}" needs a width or a height`);
  }
  const marker: Marker = {
    src: props.src,
    width: props.width,
    height: props.height,
    dither: props.dither === true,
    style: props.style,
    tw: props.tw,
  };
  return h("img", { __img: marker });
}

function isMarker(el: Element): boolean {
  return el.type === "img" && el.props.__img !== undefined;
}

function checkPath(src: string): void {
  const n = normalize(src);
  if (
    isAbsolute(src) ||
    n === ".." ||
    n.startsWith("../") ||
    n.startsWith("..\\")
  ) {
    throw new Error(`Image path "${src}" leaves the templates directory`);
  }
}

function floydSteinberg(gray: Uint8Array, w: number, h2: number): Uint8Array {
  const buf = Float32Array.from(gray);
  const out = new Uint8Array(w * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i] as number;
      const val = old < 128 ? 0 : 255;
      out[i] = val;
      const err = old - val;
      const add = (j: number, k: number) => {
        buf[j] = (buf[j] as number) + err * k;
      };
      if (x + 1 < w) add(i + 1, 7 / 16);
      if (y + 1 < h2) {
        if (x > 0) add(i + w - 1, 3 / 16);
        add(i + w, 5 / 16);
        if (x + 1 < w) add(i + w + 1, 1 / 16);
      }
    }
  }
  return out;
}

async function toDataUri(
  bytes: Buffer | Uint8Array,
  m: Marker,
): Promise<{ uri: string; width: number; height: number }> {
  // Alpha is kept so a white mark on a transparent background shows on whatever
  // is behind it; Satori composites it, and the final threshold flattens it.
  const { data, info } = await sharp(bytes)
    .resize({
      width: m.width,
      height: m.height,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] as number;
    // Fully transparent pixels count as white so they don't feed the dither.
    gray[i] =
      a === 0
        ? 255
        : Math.round(
            0.299 * (data[i * 4] as number) +
              0.587 * (data[i * 4 + 1] as number) +
              0.114 * (data[i * 4 + 2] as number),
          );
  }
  // Dither first and embed pure black and white: the final threshold keeps it.
  const px = m.dither ? floydSteinberg(gray, info.width, info.height) : gray;
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = (px[i] as number) < 128 ? 0 : 255;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = data[i * 4 + 3] as number;
  }
  const png = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return {
    uri: `data:image/png;base64,${png.toString("base64")}`,
    width: info.width,
    height: info.height,
  };
}

async function walk(
  node: Children,
  loader: (src: string) => Promise<Buffer | Uint8Array>,
): Promise<Children> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((c) => walk(c, loader)));
  }
  if (node === null || typeof node !== "object") return node;
  if (isMarker(node)) {
    const m = node.props.__img as Marker;
    checkPath(m.src);
    const { uri, width, height } = await toDataUri(await loader(m.src), m);
    return h("img", {
      src: uri,
      width,
      height,
      ...(m.tw === undefined ? {} : { tw: m.tw }),
      // The bitmap has an exact size: if a flex row ran short of room it would
      // shrink the width alone and squash the picture.
      style: { flexShrink: 0, ...m.style, width, height },
    });
  }
  const children =
    node.props.children === undefined
      ? undefined
      : await walk(node.props.children, loader);
  return {
    type: node.type,
    props: { ...node.props, ...(children === undefined ? {} : { children }) },
  };
}

/** Replaces every Img marker in the tree with a real data-URI <img>. */
export async function resolveImages(
  tree: Element,
  loader: (src: string) => Promise<Buffer | Uint8Array>,
): Promise<Element> {
  return (await walk(rootElement(tree), loader)) as Element;
}
