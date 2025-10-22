import { ExpressionError } from "./lib/expressions/errors.ts";
import { evaluateExpression } from "./steps/expression.ts";

try {
  const result = evaluateExpression("context.name == 'monalisa'", {
    context: { name: "monalisa" },
  });

  const isTrue = result.number() === 1;

  console.log(isTrue);
} catch (e) {
  if (e instanceof ExpressionError) {
    console.log(`${e.message} at line ${e.pos.line}, position ${e.pos.column}`);
  } else {
    throw e;
  }
}
