import { type ExpressionDataInterface, Kind } from "./expressiondata.ts";

export class BooleanData implements ExpressionDataInterface {
  public readonly value: boolean;

  constructor(value: boolean) {
    this.value = value;
  }

  public readonly kind = Kind.Boolean;

  public primitive = true;

  coerceString(): string {
    if (this.value) {
      return "true";
    }

    return "false";
  }

  number(): number {
    if (this.value) {
      return 1;
    }

    return 0;
  }
}
