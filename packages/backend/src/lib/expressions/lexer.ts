import { StringData } from "./data/index.ts";
import { MAX_EXPRESSION_LENGTH } from "./errors.ts";

export const TokenType = {
  UNKNOWN: 0,
  LEFT_PAREN: 1,
  RIGHT_PAREN: 2,
  LEFT_BRACKET: 3,
  RIGHT_BRACKET: 4,
  COMMA: 5,
  DOT: 6,

  BANG: 7,
  BANG_EQUAL: 8,
  EQUAL_EQUAL: 9,
  GREATER: 10,
  GREATER_EQUAL: 11,
  LESS: 12,
  LESS_EQUAL: 13,
  AND: 14,
  OR: 15,

  STAR: 16,
  NUMBER: 17,
  STRING: 18,
  IDENTIFIER: 19,
  TRUE: 20,
  FALSE: 21,
  NULL: 22,

  EOF: 23,
};
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export type Pos = {
  line: number;
  column: number;
};

export type Range = {
  start: Pos;
  end: Pos;
};

export type Token = {
  type: TokenType;

  lexeme: string;
  value?: string | number | boolean;

  range: Range;
};

export function tokenString(tok: Token): string {
  switch (tok.type) {
    case TokenType.EOF:
      return "EOF";
    case TokenType.NUMBER:
      return tok.lexeme;
    case TokenType.STRING:
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return tok.value!.toString();
    default:
      return tok.lexeme;
  }
}

export type Result = {
  tokens: Token[];
};

export class Lexer {
  private input: string;

  private start = 0;
  private offset = 0;

  private line = 0;
  private lastLineOffset = 0;

  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  lex(): Result {
    if (this.input.length > MAX_EXPRESSION_LENGTH) {
      throw new Error("ErrorExceededMaxLength");
    }

    while (!this.atEnd()) {
      this.start = this.offset;
      const c = this.next();

      switch (c) {
        case "(":
          this.addToken(TokenType.LEFT_PAREN);
          break;
        case ")":
          this.addToken(TokenType.RIGHT_PAREN);
          break;
        case "[":
          this.addToken(TokenType.LEFT_BRACKET);
          break;
        case "]":
          this.addToken(TokenType.RIGHT_BRACKET);
          break;
        case ",":
          this.addToken(TokenType.COMMA);
          break;
        case ".":
          if (
            this.previous() != TokenType.IDENTIFIER &&
            this.previous() != TokenType.RIGHT_BRACKET &&
            this.previous() != TokenType.RIGHT_PAREN &&
            this.previous() != TokenType.STAR
          ) {
            this.consumeNumber();
          } else {
            this.addToken(TokenType.DOT);
          }
          break;

        case "-":
        case "+":
          this.consumeNumber();
          break;

        case "!":
          this.addToken(
            this.match("=") ? TokenType.BANG_EQUAL : TokenType.BANG,
          );
          break;

        case "=":
          if (!this.match("=")) {
            // Illegal; continue reading until we hit a boundary character and return an error
            this.consumeIdentifier();
            break;
          }

          this.addToken(TokenType.EQUAL_EQUAL);
          break;

        case "<":
          this.addToken(
            this.match("=") ? TokenType.LESS_EQUAL : TokenType.LESS,
          );
          break;

        case ">":
          this.addToken(
            this.match("=") ? TokenType.GREATER_EQUAL : TokenType.GREATER,
          );
          break;

        case "&":
          if (!this.match("&")) {
            // Illegal; continue reading until we hit a boundary character and return an error
            this.consumeIdentifier();
            break;
          }

          this.addToken(TokenType.AND);
          break;
        case "|":
          if (!this.match("|")) {
            // Illegal; continue reading until we hit a boundary character and return an error
            this.consumeIdentifier();
            break;
          }

          this.addToken(TokenType.OR);
          break;

        case "*":
          this.addToken(TokenType.STAR);
          break;

        // Ignore whitespace.
        case " ":
        case "\r":
        case "\t":
          break;

        case "\n":
          ++this.line;
          this.lastLineOffset = this.offset;
          break;

        case "'":
          this.consumeString();
          break;

        default:
          switch (true) {
            case isDigit(c):
              this.consumeNumber();
              break;

            default:
              this.consumeIdentifier();
              break;
          }
      }
    }

    this.tokens.push({
      type: TokenType.EOF,
      lexeme: "",
      range: this.range(),
    });

    return {
      tokens: this.tokens,
    };
  }

  private pos(): Pos {
    return {
      line: this.line,
      column: this.start - this.lastLineOffset,
    };
  }

  private endPos(): Pos {
    return {
      line: this.line,
      column: this.offset - this.lastLineOffset,
    };
  }

  private range(): Range {
    return {
      start: this.pos(),
      end: this.endPos(),
    };
  }

  private atEnd(): boolean {
    return this.offset >= this.input.length;
  }

  private peek(): string {
    if (this.atEnd()) {
      return "\0";
    }

    return this.input[this.offset];
  }

  private peekNext(): string {
    if (this.offset + 1 >= this.input.length) {
      return "\0";
    }

    return this.input[this.offset + 1];
  }

  private previous(): TokenType {
    const l = this.tokens.length;
    if (l == 0) {
      return TokenType.EOF;
    }

    return this.tokens[l - 1].type;
  }

  private next(): string {
    return this.input[this.offset++];
  }

  private match(expected: string): boolean {
    if (this.atEnd()) {
      return false;
    }
    if (this.input[this.offset] !== expected) {
      return false;
    }

    this.offset++;
    return true;
  }

  private addToken(type: TokenType, value?: string | number | boolean) {
    this.tokens.push({
      type,
      lexeme: this.input.substring(this.start, this.offset),
      range: this.range(),
      value,
    });
  }

  private consumeNumber() {
    while (!this.atEnd() && (!isBoundary(this.peek()) || this.peek() == ".")) {
      this.next();
    }

    const lexeme = this.input.substring(this.start, this.offset);
    const value = new StringData(lexeme).number();

    if (isNaN(value)) {
      throw new Error(
        `Unexpected symbol: '${lexeme}'. Located at position ${this.start + 1} within expression: ${this.input}`,
      );
    }

    this.addToken(TokenType.NUMBER, value);
  }

  private consumeString() {
    while ((this.peek() !== "'" || this.peekNext() === "'") && !this.atEnd()) {
      if (this.peek() === "\n") this.line++;
      if (this.peek() === "'" && this.peekNext() === "'") {
        // Escaped "'", consume
        this.next();
      }
      this.next();
    }

    if (this.atEnd()) {
      // Unterminated string
      throw new Error(
        `Unexpected symbol: '${this.input.substring(this.start)}'. Located at position ${
          this.start + 1
        } within expression: ${this.input}`,
      );
    }

    // Closing '
    this.next();

    // Trim the surrounding quotes.
    let value = this.input.substring(this.start + 1, this.offset - 1);
    value = value.replace("''", "'");

    this.addToken(TokenType.STRING, value);
  }

  private consumeIdentifier() {
    while (!this.atEnd() && !isBoundary(this.peek())) {
      this.next();
    }

    let tokenType = TokenType.IDENTIFIER;
    let tokenValue = undefined;

    const lexeme = this.input.substring(this.start, this.offset);

    if (this.previous() != TokenType.DOT) {
      switch (lexeme) {
        case "true":
          tokenType = TokenType.TRUE;
          break;

        case "false":
          tokenType = TokenType.FALSE;
          break;

        case "null":
          tokenType = TokenType.NULL;
          break;

        case "NaN":
          tokenType = TokenType.NUMBER;
          tokenValue = NaN;
          break;

        case "Infinity":
          tokenType = TokenType.NUMBER;
          tokenValue = Infinity;
          break;
      }
    }

    if (!isLegalIdentifier(lexeme)) {
      throw new Error(
        `Unexpected symbol: '${lexeme}'. Located at position ${this.start + 1} within expression: ${this.input}`,
      );
    }

    this.addToken(tokenType, tokenValue);
  }
}

function isDigit(c: string) {
  return c >= "0" && c <= "9";
}

function isBoundary(c: string): boolean {
  switch (c) {
    case "(":
    case "[":
    case ")":
    case "]":
    case ",":
    case ".":
    case "!":
    case ">":
    case "<":
    case "=":
    case "&":
    case "|":
      return true;
  }

  return /\s/.test(c);
}

function isLegalIdentifier(str: string): boolean {
  if (str == "") {
    return false;
  }

  const first = str[0];
  if (
    (first >= "a" && first <= "z") ||
    (first >= "A" && first <= "Z") ||
    first == "_"
  ) {
    for (const c of str.substring(1).split("")) {
      if (
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c == "_" ||
        c == "-"
      ) {
        // OK
      } else {
        return false;
      }
    }

    return true;
  }
  return false;
}
