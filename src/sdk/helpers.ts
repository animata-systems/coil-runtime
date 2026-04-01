import type { SendNode } from '../ast/nodes.js';

/**
 * Resolve the effective await policy for a SendNode (R-0045).
 *
 * AST preserves `null` when AWAIT is omitted (lossless for COIL-H round-trip).
 * This helper is the single point of truth for the default: null → 'none'.
 *
 * Use this in executor and validator logic. For IDE/COIL-H display,
 * read `node.await` directly to distinguish explicit from implicit.
 */
export function resolveAwaitPolicy(node: SendNode): 'none' | 'any' | 'all' {
  return node.await ?? 'none';
}
