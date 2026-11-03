// A template's fixed label size in dots. Pure, so it can be tested.

export type TemplateSizeMm = { widthMm?: number; lengthMm?: number };

export type Dots = { dpi: number; widthDots: number; lengthDots: number };

/**
 * Millimeters to dots. A copy of mmToDots in packages/print-templates
 * (src/label.ts), which is the source of truth and what the server renders
 * with; the frontend can't import that package. Printers sold as "203 dpi"
 * have exactly 8 dots per millimeter, so 203 counts as 203.2.
 */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * (dpi === 203 ? 203.2 : dpi)) / 25.4);
}

/** The size with the template's sides applied; the other sides stay as they are. */
export function applyTemplateSize(
  size: Dots,
  fixed: TemplateSizeMm | undefined,
): Dots {
  return {
    dpi: size.dpi,
    widthDots:
      fixed?.widthMm === undefined
        ? size.widthDots
        : mmToDots(fixed.widthMm, size.dpi),
    lengthDots:
      fixed?.lengthMm === undefined
        ? size.lengthDots
        : mmToDots(fixed.lengthMm, size.dpi),
  };
}

export type FitResult = "fits" | "too-small" | "unknown";

/**
 * How a canvas compares with the label a printer reports. A printer may have
 * reported only one side (or none yet), so each side is checked on its own and
 * "unknown" means there was nothing to compare.
 */
export function fitsPrinter(
  canvas: { widthDots: number; lengthDots: number },
  printer: { widthDots?: number | null; lengthDots?: number | null },
): FitResult {
  const { widthDots, lengthDots } = printer;
  const hasWidth = widthDots !== null && widthDots !== undefined;
  const hasLength = lengthDots !== null && lengthDots !== undefined;
  if (!hasWidth && !hasLength) return "unknown";
  if (
    (hasWidth && canvas.widthDots > widthDots) ||
    (hasLength && canvas.lengthDots > lengthDots)
  ) {
    return "too-small";
  }
  return "fits";
}

/** "50 x 100 mm", or just the side that is fixed. */
export function describeTemplateSize(fixed: TemplateSizeMm): string {
  const { widthMm, lengthMm } = fixed;
  if (widthMm !== undefined && lengthMm !== undefined) {
    return `${widthMm} x ${lengthMm} mm`;
  }
  return widthMm !== undefined
    ? `width ${widthMm} mm`
    : `length ${lengthMm} mm`;
}
