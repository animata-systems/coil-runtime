import type { SourceSpan } from '../common/types.js';
import type {
  ScriptNode, ActorsNode, ToolsNode, DefineNode, ReceiveNode,
  ThinkNode, ExecuteNode, SendNode, WaitNode, EachNode,
} from '../ast/nodes.js';
import { walkOperators } from './walk.js';

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
 * Used by global validation rules. Positional rules build their own incremental scope.
 */
export function buildScope(ast: ScriptNode): ScopeModel {
  const scope = createScopeModel();

  walkOperators(ast.nodes, (node, ctx) => {
    const conditional = ctx.depth > 0;

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
          // Unconditional DEFINE is stronger — update entry
          existing.conditional = false;
          existing.span = n.span;
        }
        // duplicate-define logic is in the rule, not here
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
        break;
      }
      case 'Op.Each': {
        const n = node as EachNode;
        // Element variable is scoped to EACH body → always conditional
        if (!scope.variables.has(n.element.name)) {
          scope.variables.set(n.element.name, { span: n.element.span, state: 'defined', conditional: true });
        }
        break;
      }
    }
  });

  return scope;
}
