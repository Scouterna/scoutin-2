import { describe, expect, it } from "vitest";
import {
  applyTemplateSize,
  describeTemplateSize,
  fitsPrinter,
  mmToDots,
} from "./templateSize";

describe("mmToDots", () => {
  it("counts 203 dpi as exactly 8 dots per millimeter", () => {
    expect(mmToDots(100, 203)).toBe(800);
    expect(mmToDots(257.5, 203)).toBe(2060);
  });

  it("uses the real dpi otherwise", () => {
    expect(mmToDots(25.4, 300)).toBe(300);
  });
});

describe("applyTemplateSize", () => {
  const size = { dpi: 203, widthDots: 812, lengthDots: 2114 };

  it("replaces the sides the template fixes", () => {
    expect(applyTemplateSize(size, { widthMm: 100, lengthMm: 257.5 })).toEqual({
      dpi: 203,
      widthDots: 800,
      lengthDots: 2060,
    });
    expect(applyTemplateSize(size, { lengthMm: 100 })).toEqual({
      dpi: 203,
      widthDots: 812,
      lengthDots: 800,
    });
  });

  it("keeps the size without a template size", () => {
    expect(applyTemplateSize(size, undefined)).toEqual(size);
  });
});

describe("fitsPrinter", () => {
  const canvas = { widthDots: 800, lengthDots: 2060 };

  it("fits when the label is larger, and when it is equal", () => {
    expect(fitsPrinter(canvas, { widthDots: 812, lengthDots: 2114 })).toBe(
      "fits",
    );
    expect(fitsPrinter(canvas, { widthDots: 800, lengthDots: 2060 })).toBe(
      "fits",
    );
  });

  it("is too small on width or on length", () => {
    expect(fitsPrinter(canvas, { widthDots: 799, lengthDots: 2114 })).toBe(
      "too-small",
    );
    expect(fitsPrinter(canvas, { widthDots: 812, lengthDots: 2000 })).toBe(
      "too-small",
    );
  });

  it("is unknown when the printer reports neither side", () => {
    expect(fitsPrinter(canvas, {})).toBe("unknown");
    expect(fitsPrinter(canvas, { widthDots: null, lengthDots: null })).toBe(
      "unknown",
    );
  });

  it("compares the one side that is reported", () => {
    expect(fitsPrinter(canvas, { widthDots: 812, lengthDots: null })).toBe(
      "fits",
    );
    expect(fitsPrinter(canvas, { widthDots: null, lengthDots: 100 })).toBe(
      "too-small",
    );
  });
});

describe("describeTemplateSize", () => {
  it("names the fixed sides", () => {
    expect(describeTemplateSize({ widthMm: 100, lengthMm: 257.5 })).toBe(
      "100 x 257.5 mm",
    );
    expect(describeTemplateSize({ lengthMm: 60 })).toBe("length 60 mm");
  });
});
