// biome-ignore lint/suspicious/noShadowRestrictedNames: ¯\_(ツ)_/¯
import { Array } from "./array.ts";
import { BooleanData } from "./boolean.ts";
import { Dictionary } from "./dictionary.ts";
import { Null } from "./null.ts";
import { NumberData } from "./number.ts";
import { StringData } from "./string.ts";

/**
 * Replacer can be passed to JSON.stringify to convert an ExpressionData object into plain JSON
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#replacer
 */
export function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Null) {
    return null;
  }

  if (value instanceof BooleanData) {
    return value.value;
  }

  if (value instanceof NumberData) {
    return value.number();
  }

  if (value instanceof StringData) {
    return value.coerceString();
  }

  if (value instanceof Array) {
    return value.values();
  }

  if (value instanceof Dictionary) {
    const pairs = value.pairs();

    const r: Record<string, unknown> = {};
    for (const p of pairs) {
      r[p.key] = p.value;
    }

    return r;
  }

  return value;
}
