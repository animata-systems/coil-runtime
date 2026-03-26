import type { ScriptNode, UnsupportedOperatorNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';

export const unsupportedOperator: ValidationRule = {
  ruleId: 'unsupported-operator',
  run(ast: ScriptNode, _scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    // Walks nested blocks (IF/REPEAT/EACH) — expanded from top-level-only in phase 1 migration
    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Unsupported') {
        const unsup = op as UnsupportedOperatorNode;
        diagnostics.push({
          severity: 'error',
          ruleId: 'unsupported-operator',
          message: `operator ${unsup.operatorId} is not supported in this version`,
          span: unsup.span,
        });
      }
    });

    return diagnostics;
  },
};
