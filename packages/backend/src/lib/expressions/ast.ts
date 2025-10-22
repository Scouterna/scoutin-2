import type { ExpressionData } from "./data/index.ts";
import type { Token } from "./lexer.ts";

export interface ExprVisitor<R> {
  visitLiteral(literal: Literal): R;
  visitUnary(unary: Unary): R;
  visitBinary(binary: Binary): R;
  visitLogical(binary: Logical): R;
  visitGrouping(grouping: Grouping): R;
  visitContextAccess(contextAccess: ContextAccess): R;
  visitIndexAccess(indexAccess: IndexAccess): R;
  visitFunctionCall(functionCall: FunctionCall): R;
}

export abstract class Expr {
  abstract accept<R>(v: ExprVisitor<R>): R;
}

export class Literal extends Expr {
  public literal: ExpressionData;
  public token: Token;

  constructor(literal: ExpressionData, token: Token) {
    super();
    this.literal = literal;
    this.token = token;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitLiteral(this);
  }
}

export class Unary extends Expr {
  public operator: Token;
  public expr: Expr;

  constructor(operator: Token, expr: Expr) {
    super();
    this.operator = operator;
    this.expr = expr;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitUnary(this);
  }
}

export class FunctionCall extends Expr {
  public functionName: Token;
  public args: Expr[];

  constructor(functionName: Token, args: Expr[]) {
    super();
    this.functionName = functionName;
    this.args = args;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitFunctionCall(this);
  }
}

export class Binary extends Expr {
  public left: Expr;
  public operator: Token;
  public right: Expr;

  constructor(left: Expr, operator: Token, right: Expr) {
    super();
    this.left = left;
    this.operator = operator;
    this.right = right;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitBinary(this);
  }
}

export class Logical extends Expr {
  public operator: Token;
  public args: Expr[];

  constructor(operator: Token, args: Expr[]) {
    super();
    this.operator = operator;
    this.args = args;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitLogical(this);
  }
}

export class Grouping extends Expr {
  public group: Expr;

  constructor(group: Expr) {
    super();
    this.group = group;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitGrouping(this);
  }
}

export class ContextAccess extends Expr {
  public name: Token;

  constructor(name: Token) {
    super();
    this.name = name;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitContextAccess(this);
  }
}

export class IndexAccess extends Expr {
  public expr: Expr;
  public index: Expr;

  constructor(expr: Expr, index: Expr) {
    super();
    this.expr = expr;
    this.index = index;
  }

  accept<R>(v: ExprVisitor<R>): R {
    return v.visitIndexAccess(this);
  }
}

export class Star extends Expr {
  accept<R>(): R {
    throw new Error("Method not implemented.");
  }
}
