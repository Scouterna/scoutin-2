import { type ExpressionData, StringData } from "../data/index.ts";
import { replacer } from "../data/replacer.ts";
import type { FunctionDefinition } from "./info.ts";

export const tojson: FunctionDefinition = {
  name: "toJson",
  description:
    "`toJSON(value)`\n\nReturns a pretty-print JSON representation of `value`. You can use this function to debug the information provided in contexts.",
  minArgs: 1,
  maxArgs: 1,
  call: (...args: ExpressionData[]): ExpressionData => {
    return new StringData(JSON.stringify(args[0], replacer, "  "));
  },
};
