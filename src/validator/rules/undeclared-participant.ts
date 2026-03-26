import type { ScriptNode, SendNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const undeclaredParticipant: ValidationRule = {
  ruleId: 'undeclared-participant',
  run(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Op.Send') {
        const send = op as SendNode;
        for (const name of send.for) {
          if (!scope.participants.has(name)) {
            diagnostics.push({
              severity: 'error',
              ruleId: 'undeclared-participant',
              message: formatMessage('undeclared-participant', dialect, name),
              span: send.span,
            });
          }
        }
      }
    });

    return diagnostics;
  },
};
