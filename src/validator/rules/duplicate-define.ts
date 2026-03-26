import type { ScriptNode, DefineNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import type { SourceSpan } from '../../common/types.js';

export const duplicateDefine: ValidationRule = {
  ruleId: 'duplicate-define',
  run(ast: ScriptNode, _scope: ScopeModel, _dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];
    const seen = new Map<string, { conditional: boolean; span: SourceSpan }>();

    walkOperators(ast.nodes, (op, ctx) => {
      if (op.kind !== 'Op.Define') return;
      const def = op as DefineNode;
      const conditional = ctx.depth > 0;
      const existing = seen.get(def.name);

      if (existing) {
        // Unconditional + any → error. Two conditional → OK (D-007-1)
        if (!existing.conditional || !conditional) {
          diagnostics.push({
            severity: 'error',
            ruleId: 'duplicate-define',
            message: `variable $${def.name} is already defined`,
            span: def.span,
          });
        }
      } else {
        seen.set(def.name, { conditional, span: def.span });
      }
    });

    return diagnostics;
  },
};
