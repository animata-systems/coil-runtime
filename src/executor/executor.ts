import type {
  ScriptNode, OperatorNode, ReceiveNode, SendNode,
  DefineNode, SetNode, IfNode, RepeatNode, EachNode, DurationValue,
} from '../ast/nodes.js';
import type {
  RuntimeProviders, ExecutionResult, YieldRequest,
  ExecutionSnapshot, ResumeEvent, ProgramCounter,
  PromiseEntry, StreamHandle,
} from '../sdk/types.js';
import { ExecutionError, NotImplementedError, HostError } from '../sdk/errors.js';
import { Scope } from './scope.js';
import { interpolate, resolveBodyValue, resolveVar } from './resolve.js';
import { evaluate } from './evaluate.js';

export { ExecutionError, NotImplementedError };

function durationToMs(dur: DurationValue): number {
  switch (dur.unitId) {
    case 'Dur.Seconds': return dur.value * 1000;
    case 'Dur.Minutes': return dur.value * 60_000;
    case 'Dur.Hours': return dur.value * 3_600_000;
    default: return dur.value * 1000;
  }
}

/** Filter operator nodes from a mixed array of operators and comments. */
function operatorNodes(
  nodes: ReadonlyArray<OperatorNode | import('../ast/nodes.js').CommentNode>,
): OperatorNode[] {
  return nodes.filter(
    (n): n is OperatorNode => n.kind !== 'Comment',
  );
}

// ─── Main API (R-0053) ─────────────────────────────────

/**
 * Execute a validated AST step by step.
 *
 * Returns ExecutionResult when the script completes (EXIT),
 * or YieldRequest when the executor needs external input (RECEIVE, WAIT, SEND AWAIT).
 *
 * R-0040: explicit state machine, not generators.
 * R-0052: all providers optional — checked on demand.
 */
export async function execute(
  ast: ScriptNode,
  providers: RuntimeProviders = {},
): Promise<ExecutionResult | YieldRequest> {
  const scope = new Scope();
  return executeFrom(ast, scope, [{ node: 0 }], providers, {}, {}, {});
}

/**
 * Resume execution from a snapshot after a yield point.
 *
 * The host provides the ResumeEvent corresponding to the yield request.
 * The executor restores state from the snapshot and continues.
 */
export async function resume(
  snapshot: ExecutionSnapshot,
  event: ResumeEvent,
  ast: ScriptNode,
  providers: RuntimeProviders = {},
): Promise<ExecutionResult | YieldRequest> {
  const scope = Scope.fromSnapshot(snapshot.scope);

  // Apply the resume event to scope
  if (event.type === 'ReceiveValue') {
    // The program counter points to the RECEIVE node that yielded.
    // We need to bind the value and advance past it.
    const ops = operatorNodes(resolveNodesAtPc(ast, snapshot.pc));
    const pcTip = snapshot.pc[snapshot.pc.length - 1];
    const node = ops[pcTip.node];
    if (node && node.kind === 'Op.Receive') {
      const recv = node as ReceiveNode;
      scope.set(recv.name, event.value);
    }
  }

  // Advance past the yielded node
  const advancedPc = advancePc(snapshot.pc);

  return executeFrom(
    ast, scope, advancedPc, providers,
    snapshot.promises, snapshot.promiseStreamMap, snapshot.budgetConsumed,
  );
}

// ─── Internal execution engine ─────────────────────────

/**
 * Resolve the node array at the given program counter depth.
 * Returns the nodes array that the tip of the PC indexes into.
 */
function resolveNodesAtPc(
  ast: ScriptNode,
  pc: ProgramCounter,
): ReadonlyArray<OperatorNode | import('../ast/nodes.js').CommentNode> {
  let nodes: ReadonlyArray<OperatorNode | import('../ast/nodes.js').CommentNode> = ast.nodes;
  // Walk all segments except the last one (which indexes into the current nodes)
  const ops = operatorNodes(nodes);
  for (let i = 0; i < pc.length - 1; i++) {
    const seg = pc[i];
    const node = ops[seg.node];
    if (node && ('body' in node) && Array.isArray((node as IfNode).body)) {
      nodes = (node as IfNode | RepeatNode | EachNode).body;
    }
    // For the next level, recalculate ops
    return nodes; // simplified — deep nesting handled recursively
  }
  return nodes;
}

/**
 * Advance the program counter past the current node.
 */
function advancePc(pc: ProgramCounter): ProgramCounter {
  const result = pc.map(seg => ({ ...seg }));
  result[result.length - 1].node += 1;
  return result;
}

/**
 * Core execution loop. Starts from a given position in the AST.
 */
async function executeFrom(
  ast: ScriptNode,
  scope: Scope,
  pc: ProgramCounter,
  providers: RuntimeProviders,
  promises: Record<string, PromiseEntry>,
  promiseStreamMap: Record<string, StreamHandle>,
  budgetConsumed: Record<string, number>,
): Promise<ExecutionResult | YieldRequest> {
  // For now, execute top-level nodes sequentially from pc position.
  // Deep nesting resume (yield inside IF/REPEAT/EACH) is deferred
  // until those operators gain yield points (phases 3-5).
  // In v0.4 phase 2, only RECEIVE yields, and RECEIVE cannot appear
  // inside IF/REPEAT/EACH in practical scripts (it's top-level).

  const ops = operatorNodes(ast.nodes);
  const startIndex = pc.length === 1 ? pc[0].node : 0;

  for (let i = startIndex; i < ops.length; i++) {
    const node = ops[i];
    const result = await executeNode(node, scope, providers);

    if (result === 'exit') {
      return { type: 'completed' };
    }

    if (result && typeof result === 'object' && result.type === 'yield') {
      // Build snapshot at this position
      const snapshot: ExecutionSnapshot = {
        pc: [{ node: i }],
        scope: scope.toSnapshot(),
        promises: { ...promises },
        promiseStreamMap: { ...promiseStreamMap },
        budgetConsumed: { ...budgetConsumed },
      };
      return {
        type: 'yield',
        snapshot,
        detail: result.detail,
      };
    }
  }

  // Fell off the end without EXIT — treat as completed
  return { type: 'completed' };
}

type NodeResult = 'exit' | 'continue' | { type: 'yield'; detail: YieldRequest['detail'] };

/** Execute a single node. */
async function executeNode(
  node: OperatorNode,
  scope: Scope,
  providers: RuntimeProviders,
): Promise<NodeResult> {
  switch (node.kind) {
    case 'Op.Receive': {
      const recv = node as ReceiveNode;
      const promptText = recv.prompt
        ? interpolate(recv.prompt, scope)
        : `${recv.name}: `;

      // Yield to the host for input
      return {
        type: 'yield',
        detail: { type: 'receive', prompt: promptText },
      };
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

      if (!providers.channel) {
        throw new HostError('SEND requires a ChannelProvider', send.span);
      }
      await providers.channel.deliver(null, [], bodyText);
      return 'continue';
    }

    case 'Op.Exit':
      return 'exit';

    case 'Op.Define': {
      const def = node as DefineNode;
      const value = resolveBodyValue(def.body, scope);
      scope.set(def.name, value);
      return 'continue';
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
      return 'continue';
    }

    case 'Op.If': {
      const ifNode = node as IfNode;
      const condition = evaluate(ifNode.condition, scope);
      if (condition) {
        const result = await executeBlockNodes(ifNode.body, scope, providers);
        if (result === 'exit') return 'exit';
      }
      return 'continue';
    }

    case 'Op.Repeat': {
      const repeat = node as RepeatNode;
      for (let i = 0; i < repeat.limit; i++) {
        if (repeat.until) {
          const untilVal = evaluate(repeat.until, scope);
          if (untilVal) break;
        }
        const result = await executeBlockNodes(repeat.body, scope, providers);
        if (result === 'exit') return 'exit';
      }
      return 'continue';
    }

    case 'Op.Each': {
      const each = node as EachNode;
      const sourceVal = resolveVar(each.from.name, each.from.path, scope, each.from.span);
      if (!Array.isArray(sourceVal)) {
        throw new ExecutionError(
          `$${each.from.name} is not iterable (expected array, got ${typeof sourceVal})`,
          each.from.span,
        );
      }
      for (const element of sourceVal) {
        const iterScope = scope.child();
        iterScope.set(each.element.name, element);
        const result = await executeBlockNodes(each.body, iterScope, providers);
        if (result === 'exit') return 'exit';
      }
      return 'continue';
    }

    case 'Unsupported':
      throw new NotImplementedError(`operator ${node.operatorId}`, node.span);

    default:
      // Op.Actors, Op.Tools — no-op at execution time
      // Op.Think, Op.Execute, Op.Wait, Op.Signal — not implemented yet (phases 3-5)
      return 'continue';
  }
}

/** Execute block body nodes (IF, REPEAT, EACH). */
async function executeBlockNodes(
  nodes: ReadonlyArray<OperatorNode | import('../ast/nodes.js').CommentNode>,
  scope: Scope,
  providers: RuntimeProviders,
): Promise<'exit' | 'continue'> {
  const ops = operatorNodes(nodes);
  for (const node of ops) {
    const result = await executeNode(node, scope, providers);
    if (result === 'exit') return 'exit';
    // Yield inside blocks not supported in phase 2 (no yield points in block context)
    if (result && typeof result === 'object' && result.type === 'yield') {
      throw new ExecutionError(
        'RECEIVE inside control-flow blocks is not supported in this version',
        node.span,
      );
    }
  }
  return 'continue';
}
