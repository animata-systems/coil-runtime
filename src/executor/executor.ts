import type { SourceSpan } from '../common/types.js';
import type {
  ScriptNode, OperatorNode, ReceiveNode, SendNode, TemplateNode,
  DefineNode, SetNode, IfNode, RepeatNode, EachNode,
} from '../ast/nodes.js';
import type { Environment } from './environment.js';
import { Scope } from './scope.js';
import { interpolate, resolveBodyValue, resolveVar } from './resolve.js';
import { evaluate } from './evaluate.js';

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

/**
 * Execute a validated AST step by step.
 * R-0006: SEND without address → stdout.
 * R-0036: Scope chain for nested blocks.
 */
export async function execute(ast: ScriptNode, env: Environment): Promise<void> {
  const scope = new Scope();
  await executeNodes(ast.nodes, scope, env);
}

async function executeNodes(
  nodes: ReadonlyArray<import('../ast/nodes.js').OperatorNode | import('../ast/nodes.js').CommentNode>,
  scope: Scope,
  env: Environment,
): Promise<void> {
  const ops = nodes.filter(
    (n): n is OperatorNode => n.kind !== 'Comment',
  );

  for (const node of ops) {
    const done = await executeNode(node, scope, env);
    if (done) return; // EXIT
  }
}

/** Execute a single node. Returns true if EXIT was hit. */
async function executeNode(
  node: OperatorNode,
  scope: Scope,
  env: Environment,
): Promise<boolean> {
  switch (node.kind) {
    case 'Op.Receive': {
      const recv = node as ReceiveNode;
      const promptText = recv.prompt
        ? interpolate(recv.prompt, scope)
        : `${recv.name}: `;
      const value = await env.receive(promptText);
      scope.set(recv.name, value);
      return false;
    }

    case 'Op.Send': {
      const send = node as SendNode;
      if (send.to) throw new NotImplementedError('SEND TO', send.to.span);
      if (send.for.length > 0) throw new NotImplementedError('SEND FOR', send.span);
      if (send.replyTo) throw new NotImplementedError('SEND REPLY TO', send.replyTo.span);
      if (send.await) throw new NotImplementedError(`SEND AWAIT ${send.await.toUpperCase()}`, send.span);
      if (send.timeout) throw new NotImplementedError('SEND TIMEOUT', send.timeout.span);

      let bodyText = '';
      if (send.body) {
        bodyText = interpolate(send.body, scope);
      }
      env.send(bodyText);
      return false;
    }

    case 'Op.Exit':
      return true;

    case 'Op.Define': {
      const def = node as DefineNode;
      const value = resolveBodyValue(def.body, scope);
      scope.set(def.name, value);
      return false;
    }

    case 'Op.Set': {
      const set = node as SetNode;
      if (!scope.has(set.target.name)) {
        throw new ExecutionError(
          `SET: variable $${set.target.name} is not defined`,
          set.target.span,
        );
      }
      const value = resolveBodyValue(set.body, scope);
      scope.set(set.target.name, value);
      return false;
    }

    case 'Op.If': {
      const ifNode = node as IfNode;
      const condition = evaluate(ifNode.condition, scope);
      if (condition) {
        // IF body runs in current scope (R-0036)
        const exited = await executeBlockNodes(ifNode.body, scope, env);
        if (exited) return true;
      }
      return false;
    }

    case 'Op.Repeat': {
      const repeat = node as RepeatNode;
      for (let i = 0; i < repeat.limit; i++) {
        if (repeat.until) {
          const untilVal = evaluate(repeat.until, scope);
          if (untilVal) break;
        }
        // REPEAT body runs in current scope (R-0036)
        const exited = await executeBlockNodes(repeat.body, scope, env);
        if (exited) return true;
      }
      return false;
    }

    case 'Op.Each': {
      const each = node as EachNode;
      const sourceVal = resolveVar(each.from.name, each.from.path, scope, each.from.span);
      // R-0038: only Array is iterable in v0.4
      if (!Array.isArray(sourceVal)) {
        throw new ExecutionError(
          `$${each.from.name} is not iterable (expected array, got ${typeof sourceVal})`,
          each.from.span,
        );
      }
      // D-0044: observable sequential iteration
      // D-0045: each iteration gets a child scope
      for (const element of sourceVal) {
        const iterScope = scope.child();
        iterScope.set(each.element.name, element);
        const exited = await executeBlockNodes(each.body, iterScope, env);
        if (exited) return true;
      }
      return false;
    }

    case 'Unsupported':
      throw new NotImplementedError(`operator ${node.operatorId}`, node.span);

    default:
      // Op.Actors, Op.Tools — no-op at execution time
      // Op.Think, Op.Execute, Op.Wait, Op.Signal — not implemented
      return false;
  }
}

/** Execute block body nodes (IF, REPEAT, EACH). */
async function executeBlockNodes(
  nodes: ReadonlyArray<import('../ast/nodes.js').OperatorNode | import('../ast/nodes.js').CommentNode>,
  scope: Scope,
  env: Environment,
): Promise<boolean> {
  const ops = nodes.filter(
    (n): n is OperatorNode => n.kind !== 'Comment',
  );
  for (const node of ops) {
    const done = await executeNode(node, scope, env);
    if (done) return true;
  }
  return false;
}
