import { deflateSync } from "node:zlib";

// The printer only takes 1-bit PNGs, and sharp ignores bitdepth: 1, so the
// encoding is done by hand.

/**
 * A pixel is white if its gray value is at least this. Below 128 on purpose:
 * thermal dot gain makes the printer's black spread, so a lower value makes
 * white strokes bolder and black strokes thinner. Test prints on a ZD421:
 * 128 loses small white-on-black text, 64 is clear but warps round letters,
 * 85 is OK, 80 is the pick. May become a per-printer setting.
 */
export const RENDER_THRESHOLD = 80;

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Thresholds 8-bit gray to a 1-bit PNG (grayscale, 1 = white). */
export function encode1bitPng(
  gray: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const stride = Math.ceil(width / 8);
  const raw = Buffer.alloc((stride + 1) * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      if ((gray[y * width + x] as number) >= RENDER_THRESHOLD) {
        raw[row + (x >> 3)] =
          (raw[row + (x >> 3)] as number) | (0x80 >> (x & 7));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
