import type {
  ScriptNode, OperatorNode, CommentNode,
  ActorsNode, ToolsNode, DefineNode, ReceiveNode,
  ThinkNode, ExecuteNode, SendNode, WaitNode, EachNode,
  IfNode, RepeatNode,
} from '../ast/nodes.js';
import type { DialectTable } from '../dialect/types.js';
import type { ScopeModel } from './scope.js';
import { createScopeModel } from './scope.js';
import type { ValidationDiagnostic, VisitorRule, VisitorContext } from './validator.js';

/**
 * R-0033: Single AST walk that builds scope incrementally
 * and calls visitor rule hooks.
 *
 * Contract:
 *   1. enter(node, scopeBeforeThisNode) — called BEFORE scope update
 *   2. Scope is updated with this node's contributions
 *   3. Recurse into children (If, Repeat, Each)
 *   4. leave(node, scopeAfterChildren) — called after children
 *   After walk: finalize(finalScope, ast) for each rule
 */
export function scopeWalk(
  ast: ScriptNode,
  rules: VisitorRule[],
  dialect: DialectTable,
): { scope: ScopeModel; diagnostics: ValidationDiagnostic[] } {
  const scope = createScopeModel();
  const diagnostics: ValidationDiagnostic[] = [];

  const report = (d: ValidationDiagnostic): void => { diagnostics.push(d); };

  function walkNodes(
    nodes: ReadonlyArray<OperatorNode | CommentNode>,
    depth: number,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'Comment') continue;
      const op = node as OperatorNode;
      const ctx: VisitorContext = { depth, dialect, report };

      // 1. enter — before scope update
      for (const rule of rules) {
        rule.enter?.(op, scope, ctx);
      }

      // 2. Update scope with this node's contributions
      updateScope(scope, op, depth);

      // 3. Recurse into children
      if (op.kind === 'Op.If' || op.kind === 'Op.Repeat' || op.kind === 'Op.Each') {
        const block = op as IfNode | RepeatNode | EachNode;
        walkNodes(block.body, depth + 1);
      }

      // 4. leave — after children
      for (const rule of rules) {
        rule.leave?.(op, scope, ctx);
      }
    }
  }

  walkNodes(ast.nodes, 0);

  // finalize — after full walk, with final scope
  const finalCtx: VisitorContext = { depth: 0, dialect, report };
  for (const rule of rules) {
    rule.finalize?.(scope, ast, finalCtx);
  }

  return { scope, diagnostics };
}

/** Scope update logic — extracted from buildScope (scope.ts) */
export function updateScope(scope: ScopeModel, node: OperatorNode, depth: number): void {
  const conditional = depth > 0;

  switch (node.kind) {
    case 'Op.Actors': {
      const n = node as ActorsNode;
      for (const name of n.names) {
        scope.participants.set(name, { span: n.span });
      }
      break;
    }
    case 'Op.Tools': {
      const n = node as ToolsNode;
      for (const name of n.names) {
        scope.tools.set(name, { span: n.span });
      }
      break;
    }
    case 'Op.Define': {
      const n = node as DefineNode;
      const existing = scope.variables.get(n.name);
      if (!existing) {
        scope.variables.set(n.name, { span: n.span, state: 'defined', conditional });
      } else if (!conditional && existing.conditional) {
        existing.conditional = false;
        existing.span = n.span;
      }
      break;
    }
    case 'Op.Receive': {
      const n = node as ReceiveNode;
      scope.variables.set(n.name, { span: n.span, state: 'defined', conditional: false });
      break;
    }
    case 'Op.Think': {
      const n = node as ThinkNode;
      if (n.name) {
        scope.promises.set(n.name, { span: n.span });
        if (!scope.variables.has(n.name)) {
          scope.variables.set(n.name, { span: n.span, state: 'promised', conditional });
        }
      }
      break;
    }
    case 'Op.Execute': {
      const n = node as ExecuteNode;
      if (n.name) {
        scope.promises.set(n.name, { span: n.span });
        if (!scope.variables.has(n.name)) {
          scope.variables.set(n.name, { span: n.span, state: 'promised', conditional });
        }
      }
      break;
    }
    case 'Op.Send': {
      const n = node as SendNode;
      if (n.name) {
        scope.promises.set(n.name, { span: n.span });
        if (!scope.variables.has(n.name)) {
          scope.variables.set(n.name, { span: n.span, state: 'promised', conditional });
        }
      }
      break;
    }
    case 'Op.Wait': {
      const n = node as WaitNode;
      for (const ref of n.on) {
        const existing = scope.variables.get(ref.name);
        if (existing && existing.state === 'promised') {
          existing.state = 'defined';
        } else if (!existing) {
          scope.variables.set(ref.name, { span: n.span, state: 'defined', conditional });
        }
      }
      if (n.name) {
        scope.variables.set(n.name, { span: n.span, state: 'defined', conditional });
      }
      break;
    }
    case 'Op.Each': {
      const n = node as EachNode;
      if (!scope.variables.has(n.element.name)) {
        scope.variables.set(n.element.name, { span: n.element.span, state: 'defined', conditional: true });
      }
      break;
    }
  }
}
