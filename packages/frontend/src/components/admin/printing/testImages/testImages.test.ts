import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_PNG_BYTES, parsePngHeader } from "../JobPng";
import { TEST_IMAGES } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

// Vite rewrites "?url" imports (hashed names in a build), so the file is found
// by its base name in this folder.
function pathFor(url: string): string {
  return join(here, basename(url));
}

describe("TEST_IMAGES", () => {
  it("has unique ids", () => {
    const ids = TEST_IMAGES.map((image) => image.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const image of TEST_IMAGES) {
    it(`${image.id}: metadata matches the 1-bit PNG on disk`, () => {
      const path = pathFor(image.url);
      expect(existsSync(path)).toBe(true);

      const bytes = new Uint8Array(readFileSync(path));
      expect(bytes.length).toBeLessThan(MAX_PNG_BYTES);

      expect(parsePngHeader(bytes)).toEqual({
        width: image.width,
        height: image.height,
      });

      // IHDR: bit depth at byte 24, color type at byte 25.
      expect(bytes[24]).toBe(1);
      expect(bytes[25]).toBe(0);
    });
  }
});
