import type { ScriptNode, WaitNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';

export const undefinedPromise: ValidationRule = {
  ruleId: 'undefined-promise',
  run(ast: ScriptNode, scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind !== 'Op.Wait') return;
      const wait = op as WaitNode;
      for (const ref of wait.on) {
        if (!scope.promises.has(ref.name)) {
          diagnostics.push({
            severity: 'error',
            ruleId: 'undefined-promise',
            message: `promise ?${ref.name} is not defined by any launching operator`,
            span: ref.span,
          });
        }
      }
    });

    return diagnostics;
  },
};
