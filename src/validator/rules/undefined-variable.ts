import type { ScriptNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import { collectVariableRefs } from '../refs.js';

export const undefinedVariable: ValidationRule = {
  ruleId: 'undefined-variable',
  run(ast: ScriptNode, scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];
    const reported = new Set<string>();

    walkOperators(ast.nodes, (op) => {
      const refs = collectVariableRefs(op);
      for (const ref of refs) {
        if (reported.has(ref.name)) continue;
        if (!scope.variables.has(ref.name)) {
          reported.add(ref.name);
          diagnostics.push({
            severity: 'error',
            ruleId: 'undefined-variable',
            message: `variable $${ref.name} is not defined`,
            span: ref.span,
          });
        }
        // conditional: true → NOT an error (D-007-1)
        // state: 'promised' → NOT an error (use-before-wait handles this in phase 3)
      }
    });

    return diagnostics;
  },
};
