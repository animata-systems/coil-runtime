import type { OperatorNode, SendNode } from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { VisitorRule, VisitorContext } from '../validator.js';
import { formatMessage } from '../messages.js';
import { resolveAwaitPolicy } from '../../sdk/helpers.js';

/**
 * D-0036: SEND with result name + AWAIT NONE (explicit or default) is a preparation error.
 * Fire-and-forget does not create a promise, so naming the result is meaningless.
 */
export const sendNameAwaitNone: VisitorRule = {
  ruleId: 'send-name-await-none',
  enter(node: OperatorNode, _scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
    if (node.kind !== 'Op.Send') return;
    const send = node as SendNode;
    if (send.name !== null && resolveAwaitPolicy(send) === 'none') {
      ctx.report({
        severity: 'error',
        ruleId: 'send-name-await-none',
        message: formatMessage('send-name-await-none', ctx.dialect, send.name),
        span: send.span,
      });
    }
  },
};
