/**
 * Expression evaluator for COIL conditions (R-0035, D-0033).
 *
 * Evaluates ExpressionNode against a Scope and returns a value.
 * Used by IF and REPEAT UNTIL.
 *
 * Comparison semantics:
 * - '=' is structural equality (==)
 * - '<', '>', '<=', '>=' are numeric only
 * - AND/OR are boolean logic
 * - NOT inverts boolean
 */

import type { ExpressionNode, BinaryExpr, ComparisonOp, LogicOp } from '../ast/nodes.js';
import type { Scope } from './scope.js';
import { resolveVar, resolveFieldPath } from './resolve.js';
import { ExecutionError } from './executor.js';

/** Evaluate an expression in the given scope. Returns the result value. */
export function evaluate(expr: ExpressionNode, scope: Scope): unknown {
  switch (expr.kind) {
    case 'LiteralExpr':
      return expr.value;

    case 'VarRefExpr':
      return resolveVar(expr.name, expr.path, scope, expr.span);

    case 'GroupExpr':
      return evaluate(expr.inner, scope);

    case 'UnaryExpr': {
      const operand = evaluate(expr.operand, scope);
      // NOT — expects boolean
      return !operand;
    }

    case 'BinaryExpr': {
      const bin = expr as BinaryExpr;
      return evaluateBinary(bin, scope);
    }
  }
}

function evaluateBinary(bin: BinaryExpr, scope: Scope): unknown {
  const op = bin.op;

  // Short-circuit for logical operators
  if (op === 'And') {
    const left = evaluate(bin.left, scope);
    if (!left) return false;
    return !!evaluate(bin.right, scope);
  }
  if (op === 'Or') {
    const left = evaluate(bin.left, scope);
    if (left) return true;
    return !!evaluate(bin.right, scope);
  }

  // Comparison operators
  const left = evaluate(bin.left, scope);
  const right = evaluate(bin.right, scope);
  return applyComparison(op as ComparisonOp, left, right, bin.span);
}

function applyComparison(op: ComparisonOp, left: unknown, right: unknown, span: import('../common/types.js').SourceSpan): boolean {
  switch (op) {
    case '=':
      // Structural equality
      return left === right;

    case '<':
    case '>':
    case '<=':
    case '>=': {
      // Numeric comparisons only
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ExecutionError(
          `comparison '${op}' requires numbers, got ${typeof left} and ${typeof right}`,
          span,
        );
      }
      switch (op) {
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
      }
    }
  }
}
