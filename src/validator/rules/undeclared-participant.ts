import type { ScriptNode, SendNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';

export const undeclaredParticipant: ValidationRule = {
  ruleId: 'undeclared-participant',
  run(ast: ScriptNode, scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Op.Send') {
        const send = op as SendNode;
        for (const name of send.for) {
          if (!scope.participants.has(name)) {
            diagnostics.push({
              severity: 'error',
              ruleId: 'undeclared-participant',
              message: `participant @${name} is not declared in ACTORS`,
              span: send.span,
            });
          }
        }
      }
    });

    return diagnostics;
  },
};
