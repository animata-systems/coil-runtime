import type { OperatorNode, CommentNode, IfNode, RepeatNode, EachNode } from '../ast/nodes.js';

/** Filter top-level operator nodes (excluding comments) */
export function topLevelOps(nodes: ReadonlyArray<OperatorNode | CommentNode>): OperatorNode[] {
  return nodes.filter((n): n is OperatorNode =>
    n.kind.startsWith('Op.') || n.kind === 'Unsupported');
}

export interface WalkContext {
  /** 0 = top-level, 1+ = inside control-flow block */
  depth: number;
}

export type OperatorVisitor = (node: OperatorNode, ctx: WalkContext) => void;

/**
 * Pre-order traversal of operator nodes, recursing into IfNode/RepeatNode/EachNode bodies.
 * Visitor is called on the parent BEFORE its children are visited.
 * Comments are skipped.
 */
export function walkOperators(
  nodes: ReadonlyArray<OperatorNode | CommentNode>,
  visitor: OperatorVisitor,
  depth = 0,
): void {
  for (const node of nodes) {
    if (node.kind === 'Comment') continue;
    const op = node as OperatorNode;
    visitor(op, { depth });

    if (op.kind === 'Op.If' || op.kind === 'Op.Repeat' || op.kind === 'Op.Each') {
      const block = op as IfNode | RepeatNode | EachNode;
      walkOperators(block.body, visitor, depth + 1);
    }
  }
}
