import type { ScriptNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { topLevelOps } from '../walk.js';

export const exitRequired: ValidationRule = {
  ruleId: 'exit-required',
  run(ast: ScriptNode, _scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const ops = topLevelOps(ast.nodes);

    if (ops.length === 0 || ops[ops.length - 1].kind !== 'Op.Exit') {
      const span = ops.length > 0
        ? ops[ops.length - 1].span
        : { line: 1, col: 1, offset: 0, length: 0 };
      return [{
        severity: 'error',
        ruleId: 'exit-required',
        message: 'script must end with EXIT',
        span,
      }];
    }
    return [];
  },
};
