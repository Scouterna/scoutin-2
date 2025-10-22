import type { ExpressionData } from "./data/index.ts";

export class idxHelper {
  public readonly star: boolean;
  public readonly str: string | undefined;
  public readonly int: number | undefined;

  constructor(star: boolean, idx: ExpressionData | undefined) {
    this.star = star;
    if (!idx) {
      return;
    }
    if (!star) {
      if (idx.primitive) {
        this.str = idx.coerceString();
      }

      let f = idx.number();
      if (!isNaN(f) && isFinite(f) && f >= 0) {
        f = Math.floor(f);
        this.int = f;
      }
    }
  }
}
