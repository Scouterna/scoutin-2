export type Label = {
  /** Width and height in printer dots. */
  width: number;
  height: number;
  dpi: number;
  /** Millimeters to dots. */
  mm(n: number): number;
  /** Points to dots. */
  pt(n: number): number;
};

/**
 * Printers sold as "203 dpi" really have 8 dots per millimeter (203.2 dpi), so
 * that is what a label's millimeters are measured in. With the nominal 203 a
 * 100 mm label would be 799 dots instead of 800.
 */
function dotsPerInch(dpi: number): number {
  return dpi === 203 ? 203.2 : dpi;
}

/** Millimeters to dots at a printer's dpi. The one place this is computed. */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dotsPerInch(dpi)) / 25.4);
}

export function makeLabel(input: {
  dpi: number;
  widthDots: number;
  heightDots: number;
}): Label {
  const { dpi } = input;
  return {
    width: input.widthDots,
    height: input.heightDots,
    dpi,
    mm: (n) => mmToDots(n, dpi),
    pt: (n) => Math.round((n * dotsPerInch(dpi)) / 72),
  };
}
