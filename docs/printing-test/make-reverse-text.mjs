// White-on-black text ladder, thresholded three ways (a pixel turns white at or
// above the threshold, so LOWER values make white strokes bolder), stacked in one 800x2060 label,
// so a single print shows which threshold keeps small reverse text readable.
// Needs: npm i satori @resvg/resvg-js sharp, and Roboto static .woff files
// (Apache 2.0, e.g. from @fontsource/roboto) in ROBOTO_FILES.
//   ROBOTO_FILES=path/to/roboto/files/ node make-reverse-text.mjs out.png
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const F = process.env.ROBOTO_FILES ?? "";
const fonts = [400, 500, 700].map((w) => ({ name: "Roboto", weight: w, style: "normal", data: readFileSync(`${F}roboto-latin-${w}-normal.woff`) }));
const h = (type, style, ...c) => ({ type, props: { style, children: c.length === 1 ? c[0] : c } });
const W = 800, BAND = 420, GAP = 70, TOP = 60, THRESHOLDS = [128, 85, 45];
const line = (size, weight, text) => h("div", { fontSize: size, fontWeight: weight, color: "#fff", marginBottom: 6 }, text);

async function band(label) {
  const tree = h("div", { width: W, height: BAND, display: "flex", flexDirection: "column", background: "#000", padding: "22px 40px", fontFamily: "Roboto" },
    line(40, 700, label),
    line(24, 400, "Löddeköpinge Scoutkår 24 regular"),
    line(28, 400, "Löddeköpinge Scoutkår 28 regular"),
    line(32, 400, "Löddeköpinge Scoutkår 32 regular"),
    line(28, 500, "Löddeköpinge Scoutkår 28 medium"),
    line(32, 700, "Löddeköpinge Scoutkår 32 bold"),
    line(40, 700, "Löddeköpinge Scoutkår 40 bold"),
    line(22, 700, "ÅÄÖ åäö 0123456789 Karin Andersson"),
  );
  const svg = await satori(tree, { width: W, height: BAND, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
  return sharp(png).flatten({ background: "#000" }).greyscale().raw().toBuffer();
}

// 1-bit grayscale PNG from 8-bit gray rows; >= threshold -> white (1).
function encode1bit(gray, w, hgt, threshold) {
  const stride = Math.ceil(w / 8), raw = Buffer.alloc((stride + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) if (gray[y * w + x] >= threshold) raw[y * (stride + 1) + 1 + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return raw;
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };
function png1bit(raw, w, hgt) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 1; // depth 1, color type 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const stride = W / 8;
const whiteRows = (n) => { const b = Buffer.alloc((stride + 1) * n, 0xff); for (let y = 0; y < n; y++) b[y * (stride + 1)] = 0; return b; };
const parts = [whiteRows(TOP)];
let used = TOP;
for (const t of THRESHOLDS) {
  const gray = await band(`threshold ${t}`);
  parts.push(encode1bit(gray, W, BAND, t), whiteRows(GAP));
  used += BAND + GAP;
}
parts.push(whiteRows(2060 - used));
const out = png1bit(Buffer.concat(parts), W, 2060);
writeFileSync(process.argv[2], out);
console.log(`wrote ${out.length} bytes; header ${out.readUInt32BE(16)}x${out.readUInt32BE(20)} depth ${out[24]} colortype ${out[25]}; black bands ${THRESHOLDS.length * BAND} of 2060 rows`);
