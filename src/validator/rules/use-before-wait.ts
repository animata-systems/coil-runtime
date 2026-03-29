import type { OperatorNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { collectVariableRefs } from '../refs.js';
import { formatMessage } from '../messages.js';

/**
 * Positional rule (D-007-6, R-0033): uses ScopeWalker's incremental scope.
 * enter() is called BEFORE scope update — sees scope without current node.
 * Reports info when $name is used while still in 'promised' state.
 */
export function createUseBeforeWait(): VisitorRule {
  const reported = new Set<string>();

  return {
    ruleId: 'use-before-wait',
    enter(node: OperatorNode, scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
      const refs = collectVariableRefs(node);
      for (const ref of refs) {
        if (reported.has(ref.name)) continue;
        const entry = scope.variables.get(ref.name);
        if (entry && entry.state === 'promised') {
          reported.add(ref.name);
          ctx.report({
            severity: 'info',
            ruleId: 'use-before-wait',
            message: formatMessage('use-before-wait', ctx.dialect, ref.name),
            span: ref.span,
          });
        }
      }
    },
  };
}
