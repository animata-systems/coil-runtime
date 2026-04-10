import type { ScriptNode, SendNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const undeclaredParticipant: VisitorRule = {
  ruleId: 'undeclared-participant',
  finalize(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void {
    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Op.Send') {
        const send = op as SendNode;
        for (const pRef of send.for) {
          if (pRef.ref.kind === 'literal' && !scope.participants.has(pRef.ref.value)) {
            ctx.report({
              severity: 'error',
              ruleId: 'undeclared-participant',
              message: formatMessage('undeclared-participant', ctx.dialect, pRef.ref.value),
              span: pRef.span,
            });
          }
        }
      }
    });
  },
};
