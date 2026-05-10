import {
  data,
  Evaluator,
  Lexer,
  Parser,
} from "./github-actions-expressions/index.ts";

const WHOLE_EXPR_REGEX = /^\$\{\{(?<expr>.*?)\}\}$/s;
const PARTIAL_EXPR_REGEX = /\$\{\{(.*?)\}\}/g;

export function recursivelyEvaluateExpressionsInObject(
  obj: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  return recursivelyEvaluateExpressions(obj, context) as Record<
    string,
    unknown
  >;
}

export function recursivelyEvaluateExpressions(
  obj: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof obj === "string") {
    return evaluateExpressionsInString(obj, context);
  } else if (Array.isArray(obj)) {
    return obj.map((item) => recursivelyEvaluateExpressions(item, context));
  } else if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = recursivelyEvaluateExpressions(value, context);
    }
    return result;
  } else {
    return obj;
  }
}

export function evaluateExpressionsInString(
  str: string,
  context: Record<string, unknown>,
): string | data.ExpressionData {
  // If whole string is an expression, evaluate and return it directly
  const wholeExprMatch = str.trim().match(WHOLE_EXPR_REGEX);
  if (wholeExprMatch?.groups?.expr) {
    const expr = wholeExprMatch.groups.expr.trim();
    return evaluateExpression(expr, context);
  }

  return str.replace(PARTIAL_EXPR_REGEX, (_, expr) => {
    const result = evaluateExpression(expr.trim(), context);
    return result.coerceString();
  });
}

export function evaluateExpression(
  expression: string,
  context: Record<string, unknown>,
) {
  // Strip line comments before lexing (# through end of line, not inside strings)
  expression = expression.replace(/\s*#[^\n"]*/g, "");
  const lexer = new Lexer(expression);
  const lr = lexer.lex();

  const parser = new Parser(lr.tokens, Object.keys(context), []);
  const expr = parser.parse();

  // This is the best way I've found to turn the data into a data dictionary.
  const contextDict = JSON.parse(JSON.stringify(context), data.reviver);

  const evaluator = new Evaluator(expr, contextDict);
  return evaluator.evaluate();
}
