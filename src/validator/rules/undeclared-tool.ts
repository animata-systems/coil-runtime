import type { ScriptNode, ThinkNode, ExecuteNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { walkOperators } from '../walk.js';
import { formatMessage } from '../messages.js';

export const undeclaredTool: VisitorRule = {
  ruleId: 'undeclared-tool',
  finalize(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void {
    walkOperators(ast.nodes, (op) => {
      if (op.kind === 'Op.Think') {
        const think = op as ThinkNode;
        for (const toolRef of think.using) {
          if (!scope.tools.has(toolRef.name)) {
            ctx.report({
              severity: 'error',
              ruleId: 'undeclared-tool',
              message: formatMessage('undeclared-tool', ctx.dialect, toolRef.name),
              span: toolRef.span,
            });
          }
        }
      } else if (op.kind === 'Op.Execute') {
        const exec = op as ExecuteNode;
        if (!scope.tools.has(exec.tool.name)) {
          ctx.report({
            severity: 'error',
            ruleId: 'undeclared-tool',
            message: formatMessage('undeclared-tool', ctx.dialect, exec.tool.name),
            span: exec.tool.span,
          });
        }
      }
    });
  },
};
