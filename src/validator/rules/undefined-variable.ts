import type { ScriptNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { walkOperators } from '../walk.js';
import { collectVariableRefs } from '../refs.js';
import { formatMessage } from '../messages.js';

export const undefinedVariable: VisitorRule = {
  ruleId: 'undefined-variable',
  finalize(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void {
    const reported = new Set<string>();

    walkOperators(ast.nodes, (op) => {
      const refs = collectVariableRefs(op);
      for (const ref of refs) {
        if (reported.has(ref.name)) continue;
        if (!scope.variables.has(ref.name)) {
          reported.add(ref.name);
          ctx.report({
            severity: 'error',
            ruleId: 'undefined-variable',
            message: formatMessage('undefined-variable', ctx.dialect, ref.name),
            span: ref.span,
          });
        }
        // conditional: true → NOT an error (D-007-1)
        // state: 'promised' → NOT an error (use-before-wait handles this)
      }
    });
  },
};
