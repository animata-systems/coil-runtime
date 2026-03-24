import type { SourceSpan } from '../common/types.js';
import type { ScriptNode, ReceiveNode, SendNode, TemplateNode, RefPart } from '../ast/nodes.js';
import type { Environment } from './environment.js';

export class ExecutionError extends Error {
  readonly span: SourceSpan;
  constructor(message: string, span: SourceSpan) {
    super(message);
    this.name = 'ExecutionError';
    this.span = span;
  }
}

export class NotImplementedError extends ExecutionError {
  constructor(feature: string, span: SourceSpan) {
    super(`not implemented: ${feature}`, span);
    this.name = 'NotImplementedError';
  }
}

/** Interpolate a TemplateNode with $-references from scope */
function interpolate(template: TemplateNode, scope: Map<string, unknown>): string {
  let result = '';
  for (const part of template.parts) {
    if (part.type === 'text') {
      result += part.value;
    } else {
      const ref = part as RefPart;
      const value = scope.get(ref.name);
      if (value === undefined) {
        throw new ExecutionError(
          `undefined variable: $${ref.name}`,
          ref.span,
        );
      }
      if (ref.path.length > 0) {
        throw new NotImplementedError(
          `field access $${ref.name}.${ref.path.join('.')}`,
          ref.span,
        );
      }
      result += String(value);
    }
  }
  // TODO: trim() removes all leading/trailing whitespace including intentional spaces.
  // For structured messages, consider trimming only \n from << >> delimiters instead.
  return result.trim();
}

/**
 * Execute a validated AST step by step.
 *   RECEIVE → env.receive(prompt) → store in scope
 *   SEND (no modifiers) → interpolate body → env.send (R-0006)
 *   SEND (with modifiers) → NotImplementedError
 *   EXIT → return
 */
export async function execute(ast: ScriptNode, env: Environment): Promise<void> {
  const scope = new Map<string, unknown>();

  for (const op of ast.operators) {
    switch (op.kind) {
      case 'Op.Receive': {
        const node = op as ReceiveNode;
        let promptText = node.prompt
          ? interpolate(node.prompt, scope)
          : `${node.name}: `;
        const value = await env.receive(promptText);
        scope.set(node.name, value);
        break;
      }

      case 'Op.Send': {
        const node = op as SendNode;
        // Check for unsupported modifiers (R-0006)
        if (node.to) throw new NotImplementedError('SEND TO', node.to.span);
        if (node.for.length > 0) throw new NotImplementedError('SEND FOR', node.span);
        if (node.replyTo) throw new NotImplementedError('SEND REPLY TO', node.replyTo.span);
        if (node.await) throw new NotImplementedError(`SEND AWAIT ${node.await.toUpperCase()}`, node.span);
        if (node.timeout) throw new NotImplementedError('SEND TIMEOUT', node.timeout.span);

        let bodyText = '';
        if (node.body) {
          bodyText = interpolate(node.body, scope);
        }
        env.send(bodyText);
        break;
      }

      case 'Op.Exit': {
        return;
      }

      case 'Unsupported': {
        // Should have been caught by validator, but just in case
        throw new NotImplementedError(`operator ${op.operatorId}`, op.span);
      }
    }
  }
}
