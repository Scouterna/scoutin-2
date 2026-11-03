import { inflateSync } from "node:zlib";
import {
  cx,
  type Element,
  FitText,
  h,
  Img,
  makeLabel,
  mmToDots,
  QR,
  resolveImages,
  withRenderContext,
} from "@scouterna/scoutin-print-templates";
import { Fragment, jsx } from "@scouterna/scoutin-print-templates/jsx-runtime";
import * as jsqr from "jsqr";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  blackStats,
  encode1bitPng,
  loadBuiltinFonts,
  PNG_TEMPLATE,
  type PrinterContext,
  pngSize,
  RENDER_THRESHOLD,
  RenderError,
  render,
  renderTemplate,
} from "./render.ts";

// jsqr is CommonJS: at runtime the default export is the function, but the
// types describe the module object, hence the cast.
const jsQR = jsqr.default as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

function decode(png: Buffer) {
  const w = png.readUInt32BE(16);
  const h2 = png.readUInt32BE(20);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    off += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(w / 8);
  const bits: number[] = [];
  for (let y = 0; y < h2; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    for (let x = 0; x < w; x++) {
      const b = raw[y * (stride + 1) + 1 + (x >> 3)] as number;
      bits.push((b >> (7 - (x & 7))) & 1);
    }
  }
  return { w, h: h2, depth: png[24], color: png[25], bits };
}

const printer: PrinterContext = {
  name: "p",
  serial: "s",
  pool: "pool",
  dpi: 203,
  relay: "r",
};

describe("encode1bitPng", () => {
  it("writes a 1-bit grayscale header", () => {
    const png = encode1bitPng(new Uint8Array(800 * 2060), 800, 2060);
    expect(pngSize(png)).toEqual({ width: 800, height: 2060 });
    expect(png[24]).toBe(1);
    expect(png[25]).toBe(0);
  });

  it("round-trips a pattern with width not a multiple of 8", () => {
    const w = 11;
    const hh = 3;
    const gray = new Uint8Array(w * hh).map((_, i) => (i % 3 === 0 ? 255 : 0));
    const d = decode(encode1bitPng(gray, w, hh));
    expect(d.bits).toEqual(Array.from(gray, (g) => (g ? 1 : 0)));
  });

  it("thresholds at 80", () => {
    expect(RENDER_THRESHOLD).toBe(80);
    const d = decode(encode1bitPng(Uint8Array.from([79, 80]), 2, 1));
    expect(d.bits).toEqual([0, 1]);
  });
});

describe("fragments", () => {
  const a = h("span", null, "a");
  const b = h("span", null, "b");
  const c = h("span", null, "c");

  it("join their parent's children instead of adding a wrapper", () => {
    const parent = h("div", null, jsx(Fragment, { children: [a, b] }), c);
    expect(parent.props.children).toEqual([a, b, c]);
  });

  it("splice in when a component returns one", () => {
    const Pair = () => jsx(Fragment, { children: [a, b] });
    const parent = h("div", null, h(Pair, null), c);
    expect(parent.props.children).toEqual([a, b, c]);
  });

  it("splice in when nested", () => {
    const nested = jsx(Fragment, {
      children: [a, jsx(Fragment, { children: [b] })],
    });
    const parent = h("div", null, nested);
    expect(parent.props.children).toEqual([a, b]);
  });

  it("become a flex wrapper only at the root", async () => {
    const root = jsx(Fragment, { children: [a, b] });
    const out = await resolveImages(root, async () => Buffer.alloc(0));
    expect(out.type).toBe("div");
    expect(out.props.style).toEqual({ display: "flex" });
    expect(out.props.children).toEqual([a, b]);
  });
});

describe("cx", () => {
  it("joins class names and skips empty ones", () => {
    expect(cx("flex", undefined, "p-2", false, null, "")).toBe("flex p-2");
    expect(cx()).toBe("");
  });
});

describe("label and h", () => {
  it("converts mm and pt to dots", () => {
    const l = makeLabel({ dpi: 203, widthDots: 800, heightDots: 2060 });
    expect(l.mm(25.4)).toBe(203);
    expect(l.pt(72)).toBe(203);
    expect(l.width).toBe(800);
  });

  it("treats 203 dpi as exactly 8 dots per millimeter", () => {
    expect(mmToDots(100, 203)).toBe(800);
    expect(mmToDots(257.5, 203)).toBe(2060);
    expect(makeLabel({ dpi: 203, widthDots: 1, heightDots: 1 }).mm(100)).toBe(
      800,
    );
    expect(mmToDots(25.4, 300)).toBe(300);
  });

  it("flattens children and calls components", () => {
    const C = (p: { children?: unknown }) =>
      h("span", null, p.children as never);
    const el = h("div", { style: {} }, [["a", null, false]], 3, undefined);
    expect(el.props.children).toEqual(["a", 3]);
    expect(h(C as never, null, "x")).toEqual({
      type: "span",
      props: { children: "x" },
    });
  });
});

describe("resolveImages", () => {
  async function source() {
    return sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
      },
    })
      .png()
      .toBuffer();
  }

  it("resizes to the exact size and dithers to black and white", async () => {
    const src = await source();
    const tree = h(
      "div",
      null,
      Img({ src: "a.png", width: 17, height: 9, dither: true }),
    );
    const out = await resolveImages(tree, async () => src);
    const img = out.props.children as Element;
    expect(img.props.width).toBe(17);
    const uri = img.props.src as string;
    const png = Buffer.from(uri.split(",")[1] as string, "base64");
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([17, 9]);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += info.channels) {
      colors.add(data[i] as number);
    }
    expect([...colors].every((v) => v === 0 || v === 255)).toBe(true);
  });

  it("keeps transparency so a white mark can sit on black", async () => {
    const white = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 4,
              height: 4,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 2,
          top: 2,
        },
      ])
      .png()
      .toBuffer();
    const out = await resolveImages(
      Img({ src: "a.png", width: 8, height: 8 }),
      async () => white,
    );
    const uri = out.props.src as string;
    const { data } = await sharp(
      Buffer.from(uri.split(",")[1] as string, "base64"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * 8 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(3, 3)).toBe(255);
  });

  it("doesn't shrink in a flex row unless asked to", async () => {
    const src = await source();
    const plain = await resolveImages(
      Img({ src: "a.png", width: 17, height: 9 }),
      async () => src,
    );
    expect(plain.props.style?.flexShrink).toBe(0);
    const asked = await resolveImages(
      Img({ src: "a.png", width: 17, height: 9, style: { flexShrink: 1 } }),
      async () => src,
    );
    expect(asked.props.style?.flexShrink).toBe(1);
  });

  it("passes style and tw on, but the size always wins", async () => {
    const src = await source();
    const out = await resolveImages(
      Img({
        src: "a.png",
        width: 17,
        height: 9,
        tw: "m-2",
        style: { marginTop: 5, width: 999 },
      }),
      async () => src,
    );
    expect(out.props.tw).toBe("m-2");
    expect(out.props.style).toEqual({
      flexShrink: 0,
      marginTop: 5,
      width: 17,
      height: 9,
    });
  });

  it("rejects paths leaving the root", async () => {
    for (const p of ["../x.png", "/etc/x.png", "a/../../x.png"]) {
      await expect(
        resolveImages(Img({ src: p, width: 5 }), async () => Buffer.alloc(0)),
      ).rejects.toThrow();
    }
  });
});

describe("FitText", () => {
  const run = async (text: string, props: object) => {
    const fonts = await loadBuiltinFonts();
    return withRenderContext({ fonts }, () =>
      FitText({ width: 400, max: 100, min: 20, children: text, ...props }),
    );
  };
  const size = (e: Element) => e.props.style?.fontSize as number;

  it("stays at or below max and shrinks for long text", async () => {
    const a = await run("Al", {});
    const b = await run("A fairly long name indeed", {});
    expect(size(a)).toBeLessThanOrEqual(100);
    expect(size(b)).toBeLessThan(size(a));
  });

  it("respects min and clamps lines", async () => {
    const e = await run("x".repeat(200), { lineClamp: 2 });
    expect(size(e)).toBe(20);
    expect(e.props.style?.lineClamp).toBe(2);
  });

  it("passes style and tw on, but the fitting properties win", async () => {
    const e = await run("Al", {
      tw: "text-center",
      style: { color: "white", fontSize: 5, width: 1, marginTop: 4 },
    });
    expect(e.props.tw).toBe("text-center");
    expect(e.props.style?.color).toBe("white");
    expect(e.props.style?.marginTop).toBe(4);
    expect(size(e)).toBeGreaterThan(5);
    expect(e.props.style?.width).toBe(400);
  });

  it("does the same in maxLines mode", async () => {
    const e = await run("Wonderful Wanderful World", {
      maxLines: 2,
      tw: "text-center",
      style: { color: "white", width: 1 },
    });
    expect(e.props.tw).toBe("text-center");
    expect(e.props.style?.color).toBe("white");
    expect(e.props.style?.width).toBe(400);
  });

  describe("maxLines", () => {
    const text = "Wonderful Wanderful World";

    it("wraps at a larger size than one line allows", async () => {
      const one = await run(text, {});
      const three = await run(text, { maxLines: 3 });
      expect(size(three)).toBeGreaterThan(size(one));
      expect(three.props.style?.lineClamp).toBe(3);
    });

    it("never uses more lines than allowed", async () => {
      const two = await run(text, { maxLines: 2 });
      const three = await run(text, { maxLines: 3 });
      expect(size(two)).toBeLessThanOrEqual(size(three));
    });

    it("behaves like the default for one line", async () => {
      const a = await run(text, {});
      const b = await run(text, { maxLines: 1 });
      expect(size(b)).toBe(size(a));
    });

    it("treats a newline as a forced break", async () => {
      // "A B" fits on one line at max, but the newline makes it two lines,
      // which only fit in a box twice as tall as one line allows.
      const tight = { width: 150, max: 100, min: 10 };
      const space = await run("Aaaa Bbbb", { ...tight, maxLines: 2 });
      const nl = await run("Aaaa\nBbbb", { ...tight, maxLines: 2 });
      const nlOne = await run("Aaaa\nBbbb", { ...tight, maxLines: 1 });
      expect(size(nl)).toBe(size(space));
      expect(nl.props.style?.whiteSpace).toBe("pre-line");
      // Three lines are needed with maxLines 2 when a paragraph also wraps.
      const wrapped = await run("Aaaa Bbbb\nCccc", { ...tight, maxLines: 2 });
      expect(size(wrapped)).toBeLessThan(size(nl));
      // And the blank line between paragraphs counts.
      const blank = await run("Aaaa\n\nBbbb", { ...tight, maxLines: 2 });
      expect(size(blank)).toBeLessThan(size(nl));
      const oneLine = await run("Aaaa Bbbb", { ...tight, maxLines: 1 });
      expect(size(nlOne)).toBe(size(oneLine));
    });

    it("handles CRLF like LF", async () => {
      const a = await run("Aaaa\r\nBbbb", { maxLines: 2 });
      const b = await run("Aaaa\nBbbb", { maxLines: 2 });
      expect(size(a)).toBe(size(b));
    });

    it("falls back to min and clamps when a word is too wide", async () => {
      const e = await run("x".repeat(200), { maxLines: 2 });
      expect(size(e)).toBe(20);
      expect(e.props.style?.lineClamp).toBe(2);
    });
  });

  it("collapses newlines without maxLines", async () => {
    const a = await run("Aaaa\nBbbb", {});
    const b = await run("Aaaa Bbbb", {});
    expect(size(a)).toBe(size(b));
    expect(a.props.style?.whiteSpace).toBe("nowrap");
  });

  it("throws without a context", () => {
    expect(() => FitText({ width: 1, max: 2, min: 1, children: "a" })).toThrow(
      /render context/,
    );
  });

  it("shares the context between two copies of the package", async () => {
    const name = "@scouterna/scoutin-print-templates";
    vi.resetModules();
    const one = await import(name);
    vi.resetModules();
    const two = await import(name);
    expect(one.FitText).not.toBe(two.FitText);
    const fonts = await loadBuiltinFonts();
    const el = one.withRenderContext({ fonts }, () =>
      two.FitText({ width: 400, max: 100, min: 20, children: "Hi" }),
    );
    expect(el.props.style.fontSize).toBeGreaterThan(0);
  });
});

describe("QR", () => {
  const label = { dpi: 203, widthDots: 400, heightDots: 400 };
  const renderQr = async (qr: Element) =>
    renderTemplate({
      template: {
        default: () =>
          h("div", { style: { display: "flex", width: 400, height: 400 } }, qr),
      } as never,
      values: {},
      label,
      printer,
      fonts: await loadBuiltinFonts(),
      imageLoader: async () => Buffer.alloc(0),
    });

  it("makes whole-dot modules that fit the box", () => {
    const el = QR({ value: "https://example.org/p/123", size: 300 });
    const px = el.props.width as number;
    expect(px).toBeLessThanOrEqual(300);
    expect(px).toBeGreaterThan(250);
    expect(el.props.height).toBe(px);
  });

  it("scans after a full render", async () => {
    const value = "https://example.org/p/åäö-123";
    const r = await renderQr(QR({ value, size: 400 }));
    const d = decode(r.png);
    const rgba = new Uint8ClampedArray(d.w * d.h * 4);
    d.bits.forEach((bit, i) => {
      rgba.fill(bit ? 255 : 0, i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    });
    expect(jsQR(rgba, d.w, d.h)?.data).toBe(value);
  });

  it("can be white on black and still scans", async () => {
    const value = "https://example.org/p/123";
    const r = await renderQr(QR({ value, size: 400, invert: true }));
    const d = decode(r.png);
    // The quiet zone is black too, so the corner is black (0), not white.
    expect(d.bits[0]).toBe(0);
    const rgba = new Uint8ClampedArray(d.w * d.h * 4);
    d.bits.forEach((bit, i) => {
      rgba.fill(bit ? 255 : 0, i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    });
    expect(jsQR(rgba, d.w, d.h)?.data).toBe(value);
  });

  it("refuses a code that would be too small to scan", () => {
    expect(() => QR({ value: "x".repeat(200), size: 100 })).toThrow(
      /dots per module/,
    );
  });

  it("passes style and tw on", () => {
    const el = QR({ value: "a", size: 100, tw: "m-2", style: { margin: 3 } });
    expect(el.props.tw).toBe("m-2");
    expect(el.props.style?.margin).toBe(3);
  });
});

describe("renderTemplate", () => {
  const label = { dpi: 203, widthDots: 400, heightDots: 300 };

  it("renders a tiny template to a 1-bit PNG", async () => {
    const fonts = await loadBuiltinFonts();
    const template = {
      default: (v: { name: string }) =>
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              width: 400,
              height: 300,
              background: "white",
            },
          },
          h(FitText, { width: 380, max: 80, min: 20, fontWeight: 700 }, v.name),
          h(
            "div",
            {
              style: {
                display: "flex",
                background: "black",
                color: "white",
                fontSize: 24,
              },
            },
            "White on black",
          ),
          h(
            "div",
            {
              style: {
                display: "block",
                width: 200,
                fontSize: 20,
                lineClamp: 2,
              },
            },
            "A long paragraph that should wrap and be cut off after two lines for sure.",
          ),
        ),
    };
    const r = await renderTemplate({
      template: template as never,
      values: { name: "Kalle" },
      label,
      printer,
      fonts,
      imageLoader: async () => Buffer.alloc(0),
    });
    expect(r).toMatchObject({ width: 400, height: 300 });
    expect(pngSize(r.png)).toEqual({ width: 400, height: 300 });
    const d = decode(r.png);
    expect([d.depth, d.color]).toEqual([1, 0]);
    expect(new Set(d.bits)).toEqual(new Set([0, 1]));
  });

  it("breaks FitText lines at newlines when painting", async () => {
    const template = {
      default: (v: { name: string }) =>
        h(
          "div",
          {
            style: {
              display: "flex",
              width: 400,
              height: 300,
              background: "white",
            },
          },
          h(
            FitText,
            { width: 380, max: 60, min: 20, maxLines: 2, fontWeight: 700 },
            v.name,
          ),
        ),
    };
    const rowsWithInk = async (name: string) => {
      const r = await renderTemplate({
        template: template as never,
        values: { name },
        label,
        printer,
        fonts: await loadBuiltinFonts(),
        imageLoader: async () => Buffer.alloc(0),
      });
      const d = decode(r.png);
      const ink: boolean[] = [];
      for (let y = 0; y < d.h; y++) {
        let any = false;
        for (let x = 0; x < d.w; x++) if (d.bits[y * d.w + x] === 0) any = true;
        ink.push(any);
      }
      // Number of separate bands of rows with ink.
      return ink.filter((v, i) => v && !ink[i - 1]).length;
    };
    expect(await rowsWithInk("Aa Bb")).toBe(1);
    expect(await rowsWithInk("Aa\nBb")).toBe(2);
  });

  it("understands the tw prop", async () => {
    const template = {
      default: () =>
        h(
          "div",
          { tw: "flex w-[400px] h-[300px] bg-white" },
          h("div", { tw: "w-[200px] h-[100px] bg-black" }),
        ),
    };
    const r = await renderTemplate({
      template: template as never,
      values: {},
      label,
      printer,
      fonts: await loadBuiltinFonts(),
      imageLoader: async () => Buffer.alloc(0),
    });
    const d = decode(r.png);
    const at = (x: number, y: number) => d.bits[y * d.w + x];
    // 0 is black in the 1-bit grayscale.
    expect(at(10, 10)).toBe(0);
    expect(at(190, 90)).toBe(0);
    expect(at(300, 10)).toBe(1);
    expect(at(10, 200)).toBe(1);
  });

  it("draws outlines in debug mode, as a regular color PNG", async () => {
    const args = {
      template: {
        default: () =>
          h(
            "div",
            { style: { display: "flex", width: 400, height: 300 } },
            h("div", { style: { width: 100, height: 100 } }),
          ),
      } as never,
      values: {},
      label,
      printer,
      fonts: await loadBuiltinFonts(),
      imageLoader: async () => Buffer.alloc(0),
    };
    const plain = await renderTemplate(args);
    const debug = await renderTemplate({ ...args, debug: true });
    expect(pngSize(debug.png)).toEqual({ width: 400, height: 300 });
    // The plain render is an empty white 1-bit PNG; the debug one is not.
    expect([plain.png[24], plain.png[25]]).toEqual([1, 0]);
    expect([debug.png[24], debug.png[25]]).not.toEqual([1, 0]);
    const raw = await sharp(debug.png).raw().toBuffer();
    expect(raw.some((v) => v !== 255)).toBe(true);
  });

  it("turns a throwing template into a RenderError", async () => {
    await expect(
      renderTemplate({
        template: {
          default: () => {
            throw new Error("boom");
          },
        },
        values: {},
        label,
        printer,
        fonts: await loadBuiltinFonts(),
        imageLoader: async () => Buffer.alloc(0),
      }),
    ).rejects.toThrow(RenderError);
  });

  it("still renders the png template", async () => {
    const png = encode1bitPng(new Uint8Array(16 * 8), 16, 8);
    const r = await render(PNG_TEMPLATE, { png: png.toString("base64") });
    expect(r).toMatchObject({ width: 16, height: 8 });
  });
});

describe("blackStats", () => {
  it("counts dots below the render threshold", () => {
    const gray = new Uint8Array([
      0,
      RENDER_THRESHOLD - 1,
      RENDER_THRESHOLD,
      255,
    ]);
    expect(blackStats(gray).blackPercent).toBe(50);
    expect(blackStats(new Uint8Array(0)).blackPercent).toBe(0);
  });
});
