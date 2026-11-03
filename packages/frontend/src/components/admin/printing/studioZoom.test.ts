import { describe, expect, it } from "vitest";
import {
  clampPercent,
  DEFAULT_ZOOM,
  isPixelated,
  MAX_PERCENT,
  MIN_PERCENT,
  parseZoom,
  scaleToPercent,
  wheelZoomPercent,
  zoomScale,
} from "./studioZoom";

const image = { width: 800, height: 2000 };
const stage = { width: 1000, height: 1048 };

describe("zoomScale", () => {
  it("fits the height inside the padding", () => {
    expect(zoomScale({ kind: "height" }, image, stage)).toBeCloseTo(0.5);
  });

  it("fits the width inside the padding", () => {
    expect(
      zoomScale({ kind: "width" }, { width: 400, height: 10 }, stage),
    ).toBeCloseTo(2.38);
  });

  it("splits the width between panes, gaps included", () => {
    // (1000 - 48 - 2 * 24) / (3 * 300) = 1
    expect(
      zoomScale({ kind: "width" }, { width: 300, height: 10 }, stage, {
        panes: 3,
      }),
    ).toBeCloseTo(1);
  });

  it("leaves room for labels when fitting the height", () => {
    expect(
      zoomScale({ kind: "height" }, image, stage, { reservedHeight: 48 }),
    ).toBeCloseTo(0.476);
  });

  it("uses the percentage as is, clamped", () => {
    expect(zoomScale({ kind: "percent", percent: 150 }, image, stage)).toBe(
      1.5,
    );
    expect(zoomScale({ kind: "percent", percent: 1000 }, image, stage)).toBe(4);
  });

  it("never gives a zero or negative scale for a tiny stage", () => {
    expect(
      zoomScale({ kind: "height" }, image, { width: 10, height: 10 }),
    ).toBeGreaterThan(0);
  });

  it("falls back to 1 for an empty image", () => {
    expect(zoomScale({ kind: "width" }, { width: 0, height: 0 }, stage)).toBe(
      1,
    );
  });
});

describe("zoom helpers", () => {
  it("clamps percentages", () => {
    expect(clampPercent(10)).toBe(25);
    expect(clampPercent(999)).toBe(400);
    expect(clampPercent(Number.NaN)).toBe(100);
  });

  it("rounds a scale to a percentage", () => {
    expect(scaleToPercent(0.476)).toBe(48);
  });

  it("is pixelated from 100% up", () => {
    expect(isPixelated(0.99)).toBe(false);
    expect(isPixelated(1)).toBe(true);
  });

  it("parses stored modes and rejects garbage", () => {
    expect(parseZoom({ kind: "width" })).toEqual({ kind: "width" });
    expect(parseZoom({ kind: "percent", percent: 900 })).toEqual({
      kind: "percent",
      percent: 400,
    });
    expect(parseZoom({ kind: "percent" })).toEqual(DEFAULT_ZOOM);
    expect(parseZoom(null)).toEqual(DEFAULT_ZOOM);
    expect(parseZoom("x")).toEqual(DEFAULT_ZOOM);
  });
});

describe("wheelZoomPercent", () => {
  it("zooms in on negative deltas and out on positive ones", () => {
    expect(wheelZoomPercent(100, -100)).toBeGreaterThan(100);
    expect(wheelZoomPercent(100, 100)).toBeLessThan(100);
  });

  it("always moves at least one percent", () => {
    expect(wheelZoomPercent(100, -1)).toBe(101);
    expect(wheelZoomPercent(100, 1)).toBe(99);
  });

  it("stays within the limits", () => {
    expect(wheelZoomPercent(MAX_PERCENT, -1000)).toBe(MAX_PERCENT);
    expect(wheelZoomPercent(MIN_PERCENT, 1000)).toBe(MIN_PERCENT);
  });
});
