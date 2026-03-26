import type { ScriptNode, UnsupportedOperatorNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const unsupportedOperator: ValidationRule = {
  ruleId: 'unsupported-operator',
  run(ast: ScriptNode, _scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Unsupported') {
        const unsup = op as UnsupportedOperatorNode;
        diagnostics.push({
          severity: 'error',
          ruleId: 'unsupported-operator',
          message: formatMessage('unsupported-operator', dialect, unsup.operatorId),
          span: unsup.span,
        });
      }
    });

    return diagnostics;
  },
};
