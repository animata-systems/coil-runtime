import type { ScriptNode, WaitNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const undefinedPromise: VisitorRule = {
  ruleId: 'undefined-promise',
  finalize(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void {
    walkOperators(ast.nodes, (op) => {
      if (op.kind !== 'Op.Wait') return;
      const wait = op as WaitNode;
      for (const ref of wait.on) {
        if (!scope.promises.has(ref.name)) {
          ctx.report({
            severity: 'error',
            ruleId: 'undefined-promise',
            message: formatMessage('undefined-promise', ctx.dialect, ref.name),
            span: ref.span,
          });
        }
      }
    });
  },
};
