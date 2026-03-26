import type { ScriptNode, ThinkNode, ExecuteNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const undeclaredTool: ValidationRule = {
  ruleId: 'undeclared-tool',
  run(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Op.Think') {
        const think = op as ThinkNode;
        for (const toolRef of think.using) {
          if (!scope.tools.has(toolRef.name)) {
            diagnostics.push({
              severity: 'error',
              ruleId: 'undeclared-tool',
              message: formatMessage('undeclared-tool', dialect, toolRef.name),
              span: toolRef.span,
            });
          }
        }
      } else if (op.kind === 'Op.Execute') {
        const exec = op as ExecuteNode;
        if (!scope.tools.has(exec.tool.name)) {
          diagnostics.push({
            severity: 'error',
            ruleId: 'undeclared-tool',
            message: formatMessage('undeclared-tool', dialect, exec.tool.name),
            span: exec.tool.span,
          });
        }
      }
    });

    return diagnostics;
  },
};
