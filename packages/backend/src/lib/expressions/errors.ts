import { type Pos, type Token, tokenString } from "./lexer.ts";

export const MAX_PARSER_DEPTH = 50;
export const MAX_EXPRESSION_LENGTH = 21000;

export const ErrorType = {
  ErrorUnexpectedSymbol: 0,
  ErrorUnrecognizedNamedValue: 1,
  ErrorUnexpectedEndOfExpression: 2,

  ErrorExceededMaxDepth: 3,
  ErrorExceededMaxLength: 4,
  ErrorTooFewParameters: 5,
  ErrorTooManyParameters: 6,
  ErrorUnrecognizedContext: 7,
  ErrorUnrecognizedFunction: 8,
};
export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export class ExpressionError extends Error {
  private typ: ErrorType;
  private tok: Token;

  constructor(typ: ErrorType, tok: Token) {
    super(`${errorDescription(typ)}: '${tokenString(tok)}'`);

    this.typ = typ;
    this.tok = tok;

    this.pos = this.tok.range.start;
  }

  public pos: Pos;
}

function errorDescription(typ: ErrorType): string {
  switch (typ) {
    case ErrorType.ErrorUnexpectedEndOfExpression:
      return "Unexpected end of expression";
    case ErrorType.ErrorUnexpectedSymbol:
      return "Unexpected symbol";
    case ErrorType.ErrorUnrecognizedNamedValue:
      return "Unrecognized named-value";
    case ErrorType.ErrorExceededMaxDepth:
      return `Exceeded max expression depth ${MAX_PARSER_DEPTH}`;
    case ErrorType.ErrorExceededMaxLength:
      return `Exceeded max expression length ${MAX_EXPRESSION_LENGTH}`;
    case ErrorType.ErrorTooFewParameters:
      return "Too few parameters supplied";
    case ErrorType.ErrorTooManyParameters:
      return "Too many parameters supplied";
    case ErrorType.ErrorUnrecognizedContext:
      return "Unrecognized named-value";
    case ErrorType.ErrorUnrecognizedFunction:
      return "Unrecognized function";
    default: // Should never reach here.
      return "Unknown error";
  }
}

export class ExpressionEvaluationError extends Error {}
