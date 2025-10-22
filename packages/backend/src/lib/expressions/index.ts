export { Expr } from "./ast.ts";
export {
  DescriptionDictionary,
  type DescriptionPair,
  isDescriptionDictionary,
} from "./completion/descriptionDictionary.ts";
export { type CompletionItem, complete } from "./completion.ts";
export * as data from "./data/index.ts";
export { ExpressionError, ExpressionEvaluationError } from "./errors.ts";
export { Evaluator } from "./evaluator.ts";
export { wellKnownFunctions } from "./funcs.ts";
export { Lexer, type Result } from "./lexer.ts";
export { Parser } from "./parser.ts";
