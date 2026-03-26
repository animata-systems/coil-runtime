import type { ScriptNode, SetNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const setWithoutDefine: ValidationRule = {
  ruleId: 'set-without-define',
  run(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind !== 'Op.Set') return;
      const set = op as SetNode;
      const name = set.target.name;
      const entry = scope.variables.get(name);

      if (!entry) {
        diagnostics.push({
          severity: 'error',
          ruleId: 'set-without-define',
          message: formatMessage('set-without-define', dialect, name),
          span: set.span,
        });
      } else if (entry.state === 'promised') {
        diagnostics.push({
          severity: 'error',
          ruleId: 'set-without-define',
          message: formatMessage('set-without-define:promised', dialect, name),
          span: set.span,
        });
      }
    });

    return diagnostics;
  },
};
