import type { ExpressionData } from "../data/index.ts";

export interface FunctionInfo {
  name: string;

  description?: string;

  minArgs: number;
  maxArgs: number;
}

export interface FunctionDefinition extends FunctionInfo {
  call: (...args: ExpressionData[]) => ExpressionData;
}
