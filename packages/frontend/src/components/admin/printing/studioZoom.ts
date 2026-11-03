// Zoom math for the template studio stage. Pure, so it can be tested.

export const MIN_PERCENT = 25;
export const MAX_PERCENT = 400;

export type ZoomMode =
  | { kind: "height" }
  | { kind: "width" }
  | { kind: "percent"; percent: number };

export const DEFAULT_ZOOM: ZoomMode = { kind: "height" };

export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.round(Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percent)));
}

/** A zoom mode from stored JSON; anything unusable gives the default. */
export function parseZoom(raw: unknown): ZoomMode {
  if (typeof raw !== "object" || raw === null) return DEFAULT_ZOOM;
  const { kind, percent } = raw as { kind?: unknown; percent?: unknown };
  if (kind === "height" || kind === "width") return { kind };
  if (kind === "percent" && typeof percent === "number") {
    return { kind, percent: clampPercent(percent) };
  }
  return DEFAULT_ZOOM;
}

type Dims = { width: number; height: number };

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

/**
 * Scale factor (1 = one image pixel per CSS pixel) for a zoom mode.
 * `panes` bitmaps of the same size share the stage side by side, so fit width
 * divides the width between them. `reservedHeight` is room for what sits above
 * each bitmap (the compare labels).
 */
export function zoomScale(
  mode: ZoomMode,
  image: Dims,
  stage: Dims,
  options: {
    panes?: number;
    padding?: number;
    gap?: number;
    reservedHeight?: number;
  } = {},
): number {
  const { panes = 1, padding = 24, gap = 24, reservedHeight = 0 } = options;
  if (mode.kind === "percent") return clampPercent(mode.percent) / 100;
  if (image.width <= 0 || image.height <= 0) return 1;
  const raw =
    mode.kind === "height"
      ? (stage.height - 2 * padding - reservedHeight) / image.height
      : (stage.width - 2 * padding - gap * (panes - 1)) / (panes * image.width);
  if (!Number.isFinite(raw) || raw <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

/**
 * The zoom percent after a wheel event (deltaY > 0 zooms out). Exponential, so
 * each notch feels the same at any zoom; always moves at least one percent, or
 * slow trackpad deltas would round away and never change anything.
 */
export function wheelZoomPercent(
  currentPercent: number,
  deltaY: number,
): number {
  const next = clampPercent(currentPercent * Math.exp(-deltaY * 0.0015));
  const current = clampPercent(currentPercent);
  if (next !== current || deltaY === 0) return next;
  return clampPercent(current + (deltaY < 0 ? 1 : -1));
}

export function scaleToPercent(scale: number): number {
  return Math.round(scale * 100);
}

/** Enlarged bitmaps stay crisp; reduced ones are smoothed so they stay readable. */
export function isPixelated(scale: number): boolean {
  return scale >= 1;
}
