/**
 * Expression parser for COIL condition slots (R-0035).
 *
 * Grammar (D-0033):
 *   expr     = logic
 *   logic    = compare ( (AND | OR) compare )*
 *   compare  = unary ( compOp unary )*       ← tolerant: allows chained
 *   unary    = NOT unary | primary
 *   primary  = '(' expr ')' | literal | varRef
 *   literal  = StringLiteral | NumberLiteral | TRUE | FALSE
 *   varRef   = ValueRef ($name or $name.a.b)
 *   compOp   = '=' | '<' | '>' | '<=' | '>='
 *
 * Tolerant: builds AST even for structurally invalid expressions
 * (chained comparisons, mixed AND/OR, truthiness). Validation rules
 * catch these after parsing.
 *
 * Rejects at parse time (ParseError):
 *   - == → disallowed-operator
 *   - != → disallowed-operator
 *   - empty condition → expr-empty-condition
 *   - unexpected tokens → expr-unexpected-token
 */

import type {
  Token, ValueRefToken, NumberLiteralToken,
  StringLiteralToken, ComparisonToken, IdentifierToken,
} from '../lexer/tokens.js';
import type { SourceSpan } from '../common/types.js';
import type { DialectTable, AbstractId } from '../dialect/types.js';
import type {
  ExpressionNode, ComparisonOp, LogicOp,
} from '../ast/nodes.js';
import { ParseError } from './parser.js';

/** Result of parsing an expression from a token slice. */
export interface ExpressionParseResult {
  expr: ExpressionNode;
  nextIndex: number;
}

/** Reverse map from dialect word → expression abstract ID (built once per parse). */
type ExprWordMap = Map<string, AbstractId>;

function buildExprWordMap(dialect: DialectTable): ExprWordMap {
  const map = new Map<string, AbstractId>();
  for (const [id, word] of Object.entries(dialect.expressions)) {
    map.set(word, id as AbstractId);
  }
  return map;
}

/**
 * Parse an expression from a token array starting at `start`.
 * Stops before Newline, EOF, or any non-expression keyword.
 */
export function parseExpression(
  tokens: Token[],
  start: number,
  dialect: DialectTable,
): ExpressionParseResult {
  const exprWords = buildExprWordMap(dialect);
  let pos = start;

  // Skip leading trivia
  while (pos < tokens.length && (tokens[pos].type === 'Newline' || tokens[pos].type === 'Comment')) {
    pos++;
  }

  if (pos >= tokens.length || isExprEnd(tokens[pos], exprWords)) {
    throw new ParseError(
      'expected expression',
      tokens[Math.min(pos, tokens.length - 1)].span,
      'expr-empty-condition',
    );
  }

  return parseLogic(tokens, pos, exprWords);
}

// ─── Helpers ────────────────────────────────────────────

function identifierName(token: Token): string | null {
  return token.type === 'Identifier' ? (token as IdentifierToken).name : null;
}

function isExprId(token: Token, id: AbstractId, exprWords: ExprWordMap): boolean {
  // Expression keywords arrive as Identifier tokens (not in keyword index)
  const name = identifierName(token);
  if (name === null) return false;
  const matchedId = exprWords.get(name);
  return matchedId === id;
}

function isExprEnd(token: Token, exprWords: ExprWordMap): boolean {
  if (token.type === 'Newline' || token.type === 'EOF') return true;
  if (token.type === 'Keyword') return true;
  if (token.type === 'Identifier') {
    return !exprWords.has((token as IdentifierToken).name);
  }
  return false;
}

// ─── Logic level: AND / OR (same precedence, tolerant) ──

function parseLogic(
  tokens: Token[],
  pos: number,
  ew: ExprWordMap,
): ExpressionParseResult {
  let result = parseCompare(tokens, pos, ew);
  let left = result.expr;
  pos = result.nextIndex;

  while (pos < tokens.length && !isExprEnd(tokens[pos], ew)) {
    let op: LogicOp | null = null;
    if (isExprId(tokens[pos], 'Expr.And', ew)) op = 'And';
    else if (isExprId(tokens[pos], 'Expr.Or', ew)) op = 'Or';
    if (!op) break;

    pos++; // consume AND/OR
    const right = parseCompare(tokens, pos, ew);
    pos = right.nextIndex;

    left = { kind: 'BinaryExpr', op, left, right: right.expr, span: makeSpan(left.span, right.expr.span) };
  }

  return { expr: left, nextIndex: pos };
}

// ─── Comparison level (tolerant: allows chained) ────────

function parseCompare(
  tokens: Token[],
  pos: number,
  ew: ExprWordMap,
): ExpressionParseResult {
  const result = parseUnary(tokens, pos, ew);
  let left = result.expr;
  pos = result.nextIndex;

  while (pos < tokens.length && tokens[pos].type === 'Comparison') {
    const ct = tokens[pos] as ComparisonToken;

    if (ct.operator === '==' || ct.operator === '!=') {
      throw new ParseError(
        ct.operator === '=='
          ? '== is not a valid operator — use = for equality'
          : '!= is not a valid operator — use NOT ($x = value)',
        ct.span,
        'disallowed-operator',
      );
    }

    pos++;
    const right = parseUnary(tokens, pos, ew);
    pos = right.nextIndex;
    left = { kind: 'BinaryExpr', op: ct.operator as ComparisonOp, left, right: right.expr, span: makeSpan(left.span, right.expr.span) };
  }

  return { expr: left, nextIndex: pos };
}

// ─── Unary level: NOT ───────────────────────────────────

function parseUnary(
  tokens: Token[],
  pos: number,
  ew: ExprWordMap,
): ExpressionParseResult {
  if (pos < tokens.length && isExprId(tokens[pos], 'Expr.Not', ew)) {
    const notToken = tokens[pos];
    pos++;
    const operand = parseUnary(tokens, pos, ew);
    return {
      expr: { kind: 'UnaryExpr', op: 'Not', operand: operand.expr, span: makeSpan(notToken.span, operand.expr.span) },
      nextIndex: operand.nextIndex,
    };
  }
  return parsePrimary(tokens, pos, ew);
}

// ─── Primary level ──────────────────────────────────────

function parsePrimary(
  tokens: Token[],
  pos: number,
  ew: ExprWordMap,
): ExpressionParseResult {
  if (pos >= tokens.length || isExprEnd(tokens[pos], ew)) {
    throw new ParseError(
      'expected expression',
      tokens[Math.min(pos, tokens.length - 1)].span,
      'expr-unexpected-token',
    );
  }

  const token = tokens[pos];

  // Grouped expression: ( expr )
  if (token.type === 'ParenOpen') {
    pos++;
    const inner = parseLogic(tokens, pos, ew);
    pos = inner.nextIndex;
    if (pos >= tokens.length || tokens[pos].type !== 'ParenClose') {
      throw new ParseError(
        'expected closing parenthesis',
        tokens[Math.min(pos, tokens.length - 1)].span,
        'expr-unexpected-token',
      );
    }
    const closeSpan = tokens[pos].span;
    pos++;
    return { expr: { kind: 'GroupExpr', inner: inner.expr, span: makeSpan(token.span, closeSpan) }, nextIndex: pos };
  }

  // Variable reference: $name or $name.field.subfield
  if (token.type === 'ValueRef') {
    const vr = token as ValueRefToken;
    pos++;
    return { expr: { kind: 'VarRefExpr', name: vr.name, path: vr.path, span: vr.span }, nextIndex: pos };
  }

  // Number literal
  if (token.type === 'NumberLiteral') {
    const nl = token as NumberLiteralToken;
    pos++;
    return { expr: { kind: 'LiteralExpr', value: nl.value, literalType: 'number', span: nl.span }, nextIndex: pos };
  }

  // String literal
  if (token.type === 'StringLiteral') {
    const sl = token as StringLiteralToken;
    pos++;
    return { expr: { kind: 'LiteralExpr', value: sl.value, literalType: 'string', span: sl.span }, nextIndex: pos };
  }

  // Boolean literals: TRUE / FALSE (arrive as Identifier)
  if (isExprId(token, 'Expr.True', ew)) {
    pos++;
    return { expr: { kind: 'LiteralExpr', value: true, literalType: 'boolean', span: token.span }, nextIndex: pos };
  }
  if (isExprId(token, 'Expr.False', ew)) {
    pos++;
    return { expr: { kind: 'LiteralExpr', value: false, literalType: 'boolean', span: token.span }, nextIndex: pos };
  }

  // Disallowed comparison operators at primary position
  if (token.type === 'Comparison') {
    const ct = token as ComparisonToken;
    if (ct.operator === '==' || ct.operator === '!=') {
      throw new ParseError(
        ct.operator === '=='
          ? '== is not a valid operator — use = for equality'
          : '!= is not a valid operator — use NOT ($x = value)',
        ct.span,
        'disallowed-operator',
      );
    }
  }

  // Dash (-) and Star (*) in expression context → arithmetic error
  if (token.type === 'Dash' || token.type === 'Star') {
    throw new ParseError(
      `arithmetic operator '${token.type === 'Dash' ? '-' : '*'}' is not supported in v0.4`,
      token.span,
      'arithmetic-deferred',
    );
  }

  throw new ParseError(
    `unexpected token in expression: ${token.type}`,
    token.span,
    'expr-unexpected-token',
  );
}

// ─── Span helper ────────────────────────────────────────

function makeSpan(start: SourceSpan, end: SourceSpan): SourceSpan {
  return {
    offset: start.offset,
    length: (end.offset + end.length) - start.offset,
    line: start.line,
    col: start.col,
  };
}
