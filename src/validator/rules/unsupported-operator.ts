import type { OperatorNode, UnsupportedOperatorNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { formatMessage } from '../messages.js';

export const unsupportedOperator: VisitorRule = {
  ruleId: 'unsupported-operator',
  enter(node: OperatorNode, _scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
    if (node.kind === 'Unsupported') {
      const unsup = node as UnsupportedOperatorNode;
      ctx.report({
        severity: 'error',
        ruleId: 'unsupported-operator',
        message: formatMessage('unsupported-operator', ctx.dialect, unsup.operatorId),
        span: unsup.span,
      });
    }
  },
};
