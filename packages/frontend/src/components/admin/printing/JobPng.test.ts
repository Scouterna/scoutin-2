import { describe, expect, it } from "vitest";
import { bytesToBase64, PngError, parsePngHeader } from "./JobPng";

function header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("parsePngHeader", () => {
  it("reads big-endian width and height", () => {
    expect(parsePngHeader(header(812, 1218))).toEqual({
      width: 812,
      height: 1218,
    });
    expect(parsePngHeader(header(70000, 3))).toEqual({
      width: 70000,
      height: 3,
    });
  });

  it("rejects other files", () => {
    expect(() => parsePngHeader(new Uint8Array(40))).toThrow(PngError);
    expect(() => parsePngHeader(new Uint8Array(4))).toThrow(PngError);
    const bad = header(1, 1);
    bad[1] = 0x51;
    expect(() => parsePngHeader(bad)).toThrow(PngError);
  });

  it("rejects a missing IHDR and zero sizes", () => {
    const noIhdr = header(1, 1);
    noIhdr[12] = 0x41;
    expect(() => parsePngHeader(noIhdr)).toThrow(PngError);
    expect(() => parsePngHeader(header(0, 5))).toThrow(PngError);
  });
});

describe("bytesToBase64", () => {
  it("matches btoa for small input", () => {
    expect(bytesToBase64(new Uint8Array([72, 105, 33]))).toBe("SGkh");
  });

  it("handles large arrays in chunks", () => {
    const big = new Uint8Array(2 * 1024 * 1024).map((_, i) => i % 251);
    const expected = Buffer.from(big).toString("base64");
    expect(bytesToBase64(big)).toBe(expected);
  });
});
