import type { OperatorNode, DefineNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { SourceSpan } from '../../common/types.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { formatMessage } from '../messages.js';

export function createDuplicateDefine(): VisitorRule {
  const seen = new Map<string, { conditional: boolean; span: SourceSpan }>();

  return {
    ruleId: 'duplicate-define',
    enter(node: OperatorNode, _scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
      if (node.kind !== 'Op.Define') return;
      const def = node as DefineNode;
      const conditional = ctx.depth > 0;
      const existing = seen.get(def.name);

      if (existing) {
        // Unconditional + any → error. Two conditional → OK (D-007-1)
        if (!existing.conditional || !conditional) {
          ctx.report({
            severity: 'error',
            ruleId: 'duplicate-define',
            message: formatMessage('duplicate-define', ctx.dialect, def.name),
            span: def.span,
          });
        }
      } else {
        seen.set(def.name, { conditional, span: def.span });
      }
    },
  };
}
