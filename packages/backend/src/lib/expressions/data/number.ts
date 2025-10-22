import { type ExpressionDataInterface, Kind } from "./expressiondata.ts";

export class NumberData implements ExpressionDataInterface {
  public readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  public readonly kind = Kind.Number;

  public primitive = true;

  coerceString(): string {
    if (this.value === 0) {
      return "0";
    }

    // Workaround to limit the precision to at most 15 digits. Format the number to a string, then parse
    // it back to a number to remove trailing zeroes to prevent numbers to be converted to 1.200000000...
    return (+this.value.toFixed(15)).toString();
  }

  number(): number {
    return this.value;
  }
}
