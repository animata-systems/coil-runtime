/**
 * Expression validation rules (R-0035).
 *
 * These rules check ExpressionNode trees in IfNode.condition and
 * RepeatNode.until for structural issues that the tolerant expression
 * parser intentionally does not reject:
 *
 * - chained-comparison: left side of a comparison is itself a comparison
 * - mixed-and-or-without-parens: AND and OR at the same level without GroupExpr
 * - truthiness-deferred: bare variable reference as condition (no comparison/logical)
 */

import type {
  OperatorNode, IfNode, RepeatNode, ExpressionNode, BinaryExpr,
  UnaryExpr, GroupExpr,
} from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';

// ─── Generic expression walker ──────────────────────────

/** Visit every node in an expression tree, descending into all node kinds. */
function walkExpr(expr: ExpressionNode, fn: (node: ExpressionNode) => void): void {
  fn(expr);
  switch (expr.kind) {
    case 'BinaryExpr':
      walkExpr(expr.left, fn);
      walkExpr(expr.right, fn);
      break;
    case 'UnaryExpr':
      walkExpr(expr.operand, fn);
      break;
    case 'GroupExpr':
      walkExpr(expr.inner, fn);
      break;
    // LiteralExpr, VarRefExpr — leaf nodes
  }
}

// ─── Chained comparison ─────────────────────────────────

const COMP_OPS = new Set(['=', '<', '>', '<=', '>=']);

function checkChainedComparison(expr: ExpressionNode, ctx: VisitorContext): void {
  walkExpr(expr, (node) => {
    if (node.kind !== 'BinaryExpr') return;
    const bin = node as BinaryExpr;
    if (!COMP_OPS.has(bin.op as string)) return;

    // Left side of a comparison is itself a comparison → chained
    if (bin.left.kind === 'BinaryExpr' && COMP_OPS.has((bin.left as BinaryExpr).op as string)) {
      ctx.report({
        severity: 'error',
        ruleId: 'chained-comparison',
        message: 'chained comparisons are not valid — compare one pair at a time',
        span: node.span,
      });
    }
  });
}

// ─── Mixed AND / OR ─────────────────────────────────────

/** Check if a subtree contains an unwrapped (not inside GroupExpr) logical op. */
function hasUnwrappedOp(node: ExpressionNode, op: string): boolean {
  if (node.kind === 'GroupExpr') return false; // grouped — ok
  if (node.kind === 'BinaryExpr') {
    const b = node as BinaryExpr;
    if (b.op === op) return true;
    return hasUnwrappedOp(b.left, op) || hasUnwrappedOp(b.right, op);
  }
  return false;
}

function checkMixedAndOr(expr: ExpressionNode, ctx: VisitorContext): void {
  // Walk to find the FIRST (outermost) node that mixes AND/OR.
  // Report once and stop — inner nodes are part of the same problem.
  let reported = false;

  walkExpr(expr, (node) => {
    if (reported) return;
    if (node.kind !== 'BinaryExpr') return;
    const bin = node as BinaryExpr;

    if (bin.op !== 'And' && bin.op !== 'Or') return;
    const otherOp = bin.op === 'And' ? 'Or' : 'And';

    if (hasUnwrappedOp(bin.left, otherOp) || hasUnwrappedOp(bin.right, otherOp)) {
      ctx.report({
        severity: 'error',
        ruleId: 'mixed-and-or-without-parens',
        message: 'mixing AND and OR without parentheses is ambiguous — use parentheses to clarify',
        span: node.span,
      });
      reported = true;
    }
  });
}

// ─── Truthiness ─────────────────────────────────────────

function checkTruthiness(expr: ExpressionNode, ctx: VisitorContext): void {
  // Only top-level: bare variable reference or literal without comparison/logical
  if (expr.kind === 'VarRefExpr') {
    ctx.report({
      severity: 'error',
      ruleId: 'truthiness-deferred',
      message: 'bare variable reference in condition is not valid in v0.4 — use a comparison',
      span: expr.span,
    });
  }
  if (expr.kind === 'LiteralExpr') {
    ctx.report({
      severity: 'error',
      ruleId: 'truthiness-deferred',
      message: 'bare literal in condition is not valid in v0.4 — use a comparison',
      span: expr.span,
    });
  }
}

// ─── Entry point ────────────────────────────────────────

function checkExpression(expr: ExpressionNode, ctx: VisitorContext): void {
  checkChainedComparison(expr, ctx);
  checkMixedAndOr(expr, ctx);
  checkTruthiness(expr, ctx);
}

export const expressionRules: VisitorRule = {
  ruleId: 'expression-rules',

  enter(node: OperatorNode, _scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
    if (node.kind === 'Op.If') {
      const ifNode = node as IfNode;
      checkExpression(ifNode.condition, ctx);
    }
    if (node.kind === 'Op.Repeat') {
      const repeatNode = node as RepeatNode;
      if (repeatNode.until) {
        checkExpression(repeatNode.until, ctx);
      }
    }
  },
};
