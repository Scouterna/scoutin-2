import { type ExpressionDataInterface, Kind } from "./expressiondata.ts";

export class StringData implements ExpressionDataInterface {
  public readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  public readonly kind = Kind.String;

  public primitive = true;

  coerceString(): string {
    return this.value;
  }

  number(): number {
    return Number(this.value);
  }
}
