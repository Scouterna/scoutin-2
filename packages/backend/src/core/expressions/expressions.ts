import { data, Evaluator, Lexer, Parser } from "@actions/expressions";

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
    const result = evaluateExpressionsInString(obj, context);
    if (typeof result === "string") return result;
    return JSON.parse(JSON.stringify(result, data.replacer));
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

/**
 * Strips `#`-to-end-of-line comments, ignoring `#` that appears inside string
 * literals. Tracks single- and double-quoted strings so an expression like
 * `name == 'Team #1'` is left intact instead of being truncated.
 */
function stripLineComments(expression: string): string {
  let result = "";
  let quote: string | null = null;

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];

    if (quote) {
      result += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }

    if (char === "#") {
      const newline = expression.indexOf("\n", i);
      if (newline === -1) break; // comment runs to the end of the expression
      i = newline - 1; // resume at the newline (preserved next iteration)
      continue;
    }

    result += char;
  }

  return result;
}

export function evaluateExpression(
  expression: string,
  context: Record<string, unknown>,
) {
  // Strip line comments before lexing (# through end of line, not inside strings)
  expression = stripLineComments(expression);
  const lexer = new Lexer(expression);
  const lr = lexer.lex();

  const parser = new Parser(lr.tokens, Object.keys(context), []);
  const expr = parser.parse();

  // This is the best way I've found to turn the data into a data dictionary.
  const contextDict = JSON.parse(JSON.stringify(context), data.reviver);

  const evaluator = new Evaluator(expr, contextDict);
  return evaluator.evaluate();
}
