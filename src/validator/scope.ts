import type { SourceSpan } from '../common/types.js';
import type { ScriptNode } from '../ast/nodes.js';
import { walkOperators } from './walk.js';
import { updateScope } from './scope-walker.js';

export interface ScopeEntry {
  span: SourceSpan;
}

export interface VariableEntry {
  span: SourceSpan;
  state: 'defined' | 'promised';
  conditional: boolean;
}

export interface ScopeModel {
  participants: Map<string, ScopeEntry>;
  tools: Map<string, ScopeEntry>;
  variables: Map<string, VariableEntry>;
  promises: Map<string, ScopeEntry>;
}

export function createScopeModel(): ScopeModel {
  return {
    participants: new Map(),
    tools: new Map(),
    variables: new Map(),
    promises: new Map(),
  };
}

/**
 * Build a flat global scope model by walking the AST top-down.
 * Uses walkOperators + updateScope directly — no dialect needed (R-0033).
 */
export function buildScope(ast: ScriptNode): ScopeModel {
  const scope = createScopeModel();
  walkOperators(ast.nodes, (node, ctx) => {
    updateScope(scope, node, ctx.depth);
  });
  return scope;
}
