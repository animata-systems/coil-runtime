import type { ScriptNode, SetNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const setWithoutDefine: VisitorRule = {
  ruleId: 'set-without-define',
  finalize(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void {
    walkOperators(ast.nodes, (op) => {
      if (op.kind !== 'Op.Set') return;
      const set = op as SetNode;
      const name = set.target.name;
      const entry = scope.variables.get(name);

      if (!entry) {
        ctx.report({
          severity: 'error',
          ruleId: 'set-without-define',
          message: formatMessage('set-without-define', ctx.dialect, name),
          span: set.span,
        });
      } else if (entry.state === 'promised') {
        ctx.report({
          severity: 'error',
          ruleId: 'set-without-define',
          message: formatMessage('set-without-define:promised', ctx.dialect, name),
          span: set.span,
        });
      }
    });
  },
};
