import type { ScriptNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { topLevelOps } from '../walk.js';

export const unreachableAfterExit: ValidationRule = {
  ruleId: 'unreachable-after-exit',
  run(ast: ScriptNode, _scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];
    // Only top-level EXIT counts as script termination (D-007-5)
    const ops = topLevelOps(ast.nodes);

    for (let i = 0; i < ops.length - 1; i++) {
      if (ops[i].kind === 'Op.Exit') {
        for (let j = i + 1; j < ops.length; j++) {
          diagnostics.push({
            severity: 'warning',
            ruleId: 'unreachable-after-exit',
            message: 'unreachable code after EXIT',
            span: ops[j].span,
          });
        }
        break;
      }
    }

    return diagnostics;
  },
};
