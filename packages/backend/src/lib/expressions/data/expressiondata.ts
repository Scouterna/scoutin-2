// biome-ignore lint/suspicious/noShadowRestrictedNames: ¯\_(ツ)_/¯
import type { Array } from "./array.ts";
import type { BooleanData } from "./boolean.ts";
import type { Dictionary } from "./dictionary.ts";
import type { Null } from "./null.ts";
import type { NumberData } from "./number.ts";
import type { StringData } from "./string.ts";

export const Kind = {
  String: 0,
  Array: 1,
  Dictionary: 2,
  Boolean: 3,
  Number: 4,
  CaseSensitiveDictionary: 5,
  Null: 6,
};
export type Kind = (typeof Kind)[keyof typeof Kind];

export function kindStr(k: Kind): string {
  switch (k) {
    case Kind.Array:
      return "Array";
    case Kind.Boolean:
      return "Boolean";
    case Kind.Null:
      return "Null";
    case Kind.Number:
      return "Number";
    case Kind.Dictionary:
      return "Object";
    case Kind.String:
      return "String";
  }

  return "unknown";
}

export interface ExpressionDataInterface {
  kind: Kind;
  primitive: boolean;

  coerceString(): string;

  number(): number;
}

export type ExpressionData =
  | Array
  | Dictionary
  | StringData
  | BooleanData
  | NumberData
  | Null;

export type Pair = {
  key: string;
  value: ExpressionData;
};
