import { type ExpressionDataInterface, Kind } from "./expressiondata.ts";

export class Null implements ExpressionDataInterface {
  public readonly kind = Kind.Null;

  public primitive = true;

  coerceString(): string {
    return "";
  }

  number(): number {
    return 0;
  }
}
