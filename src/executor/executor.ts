import type {
  ScriptNode, OperatorNode, ReceiveNode, SendNode,
  DefineNode, SetNode, IfNode, RepeatNode, EachNode, DurationValue,
  ChannelRef, ThinkNode, ExecuteNode, WaitNode, SignalNode,
} from '../ast/nodes.js';
import type { ChannelSegment } from '../common/types.js';
import type {
  RuntimeProviders, ExecutionResult, YieldRequest,
  ExecutionSnapshot, ResumeEvent, ProgramCounter,
  PromiseEntry, StreamHandle,
} from '../sdk/types.js';
import { ExecutionError, NotImplementedError, HostError } from '../sdk/errors.js';
import { resolveAwaitPolicy } from '../sdk/helpers.js';
import type { ModelCallConfig } from '../sdk/types.js';
import { compileResult } from '../result/compile.js';
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

/**
 * Resolve a ChannelRef to a string address by evaluating dynamic segments.
 * Segments joined by '/' per R-0054 JSDoc convention.
 */
function resolveChannel(ref: ChannelRef, scope: Scope): string {
  return ref.segments.map((seg: ChannelSegment) => {
    if (seg.kind === 'literal') return seg.value;
    return String(resolveVar(seg.name, seg.path, scope, ref.span));
  }).join('/');
}

/** R-0056: close stream if a promise has an associated stream handle. */
function closeStreamIfExists(
  promiseName: string,
  promiseStreamMap: Record<string, StreamHandle>,
  providers: RuntimeProviders,
): void {
  const handle = promiseStreamMap[promiseName];
  if (handle && providers.stream) {
    providers.stream.close(handle);
  }
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
  const ops = operatorNodes(resolveNodesAtPc(ast, snapshot.pc));
  const pcTip = snapshot.pc[snapshot.pc.length - 1];
  const node = ops[pcTip.node];

  if (event.type === 'ReceiveValue') {
    if (node && node.kind === 'Op.Receive') {
      const recv = node as ReceiveNode;
      scope.set(recv.name, event.value);
    }
  } else if (event.type === 'MessageReply') {
    if (node && node.kind === 'Op.Send') {
      const send = node as SendNode;
      if (send.name) {
        const awaitPolicy = resolveAwaitPolicy(send);
        const value = awaitPolicy === 'any'
          ? event.replies[0] ?? null
          : event.replies;
        scope.set(send.name, value);

        // R-0056: close stream on promise resolve
        closeStreamIfExists(send.name, snapshot.promiseStreamMap, providers);
      }
    }
  } else if (event.type === 'PromiseResolved') {
    const entry = snapshot.promises[event.promiseName];
    if (entry) {
      entry.status = 'resolved';
      entry.result = event.result;
    }
    snapshot.promises[event.promiseName] = {
      status: 'resolved',
      origin: entry?.origin ?? 'think',
      result: event.result,
    };
    scope.set(event.promiseName, event.result);

    // R-0056: close stream on promise resolve
    closeStreamIfExists(event.promiseName, snapshot.promiseStreamMap, providers);

    if (node && node.kind === 'Op.Wait') {
      const wait = node as WaitNode;
      if (wait.name) {
        scope.set(wait.name, event.result);
      }
    }
  } else if (event.type === 'Timeout') {
    if (node) {
      throw new ExecutionError('operation timed out', node.span);
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

  const ctx: ExecContext = { providers, promises, promiseStreamMap };
  const ops = operatorNodes(ast.nodes);
  const startIndex = pc.length === 1 ? pc[0].node : 0;

  for (let i = startIndex; i < ops.length; i++) {
    const node = ops[i];
    const result = await executeNode(node, scope, ctx);

    if (result === 'exit') {
      return { type: 'completed' };
    }

    if (result && typeof result === 'object' && result.type === 'yield') {
      // Build snapshot at this position
      const snapshot: ExecutionSnapshot = {
        pc: [{ node: i }],
        scope: scope.toSnapshot(),
        promises: { ...ctx.promises },
        promiseStreamMap: { ...ctx.promiseStreamMap },
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

/** Mutable execution context threaded through the execution loop. */
interface ExecContext {
  providers: RuntimeProviders;
  promises: Record<string, PromiseEntry>;
  promiseStreamMap: Record<string, StreamHandle>;
}

type NodeResult = 'exit' | 'continue' | { type: 'yield'; detail: YieldRequest['detail'] };

/** Execute a single node. */
async function executeNode(
  node: OperatorNode,
  scope: Scope,
  ctx: ExecContext,
): Promise<NodeResult> {
  switch (node.kind) {
    case 'Op.Receive': {
      const recv = node as ReceiveNode;
      const promptText = recv.prompt
        ? interpolate(recv.prompt, scope)
        : null;

      // Yield to the host for input
      return {
        type: 'yield',
        detail: {
          type: 'receive',
          variableName: recv.name,
          prompt: promptText,
          timeoutMs: recv.timeout ? durationToMs(recv.timeout) : null,
        },
      };
    }

    case 'Op.Send': {
      const send = node as SendNode;
      if (send.replyTo) throw new NotImplementedError('SEND REPLY TO', send.replyTo.span);

      if (!ctx.providers.channel) {
        throw new HostError('SEND requires a ChannelProvider', send.span);
      }

      // Resolve payload
      const payload: string | Record<string, unknown> = send.body
        ? interpolate(send.body, scope)
        : '';

      // Resolve channel address (D-014-05)
      const channel = send.to ? resolveChannel(send.to, scope) : null;

      // Resolve participants (D-014-05)
      const participantIds: string[] = [];
      if (send.for.length > 0) {
        if (!ctx.providers.participant) {
          throw new HostError('SEND FOR requires a ParticipantProvider', send.span);
        }
        for (const name of send.for) {
          const info = await ctx.providers.participant.resolve(name);
          if (!info) {
            throw new ExecutionError(`participant @${name} could not be resolved`, send.span);
          }
          participantIds.push(info.id);
        }
      }

      // Deliver message
      const { correlationId } = await ctx.providers.channel.deliver(channel, participantIds, payload);

      // Determine await policy (R-0045)
      const awaitPolicy = resolveAwaitPolicy(send);

      if (awaitPolicy === 'none') {
        return 'continue';
      }

      // Store pending promise in registry (R-0043)
      ctx.promises[send.name!] = { status: 'pending', origin: 'send', correlationId };

      // AWAIT ANY or AWAIT ALL → yield to host for reply aggregation (R-0044)
      return {
        type: 'yield',
        detail: {
          type: 'await-replies',
          correlationId,
          awaitPolicy,
          promiseName: send.name!,
        },
      };
    }

    case 'Op.Think': {
      const think = node as ThinkNode;
      if (!ctx.providers.model) {
        throw new HostError('THINK requires a ModelProvider', think.span);
      }

      // Build ModelCallConfig (R-0042)
      const config: ModelCallConfig = {
        via: think.via ? String(resolveVar(think.via.name, think.via.path, scope, think.via.span)) : null,
        as: think.as.map(ref => String(resolveVar(ref.name, ref.path, scope, ref.span))),
        using: think.using.map(ref => ref.name),
        goal: think.goal ? interpolate(think.goal, scope) : null,
        input: think.input ? interpolate(think.input, scope) : null,
        context: think.context ? interpolate(think.context, scope) : null,
        resultSchema: think.result.length > 0
          ? compileResult(think.result).fields
          : null,
        body: think.body ? interpolate(think.body, scope) : null,
      };

      // Call model inline — NOT a yield point (R-0051)
      const modelResult = await ctx.providers.model.call(config);

      // Store promise as resolved (R-0043)
      ctx.promises[think.name] = { status: 'resolved', origin: 'think', result: modelResult.output };

      // Bind $name in scope immediately
      scope.set(think.name, modelResult.output);

      // Optional stream creation (D-0042: host-decided)
      if (ctx.providers.stream) {
        const handle = ctx.providers.stream.createStream(think.name, 'executor');
        if (handle) {
          ctx.promiseStreamMap[think.name] = handle;
          // D-0041: stream closes when promise resolves — THINK resolves inline
          ctx.providers.stream.close(handle);
        }
      }

      return 'continue';
    }

    case 'Op.Execute': {
      const exec = node as ExecuteNode;
      if (!ctx.providers.tool) {
        throw new HostError('EXECUTE requires a ToolProvider', exec.span);
      }

      // Resolve args (R-0055)
      const resolvedArgs: Record<string, unknown> = {};
      for (const arg of exec.args) {
        resolvedArgs[arg.key] = resolveBodyValue(arg.value, scope);
      }

      // Call tool inline — NOT a yield point (R-0051)
      const toolResult = await ctx.providers.tool.invoke(exec.tool.name, resolvedArgs);

      // Store promise as resolved (R-0043)
      ctx.promises[exec.name] = { status: 'resolved', origin: 'execute', result: toolResult.output };

      // Bind $name in scope immediately
      scope.set(exec.name, toolResult.output);

      // Optional stream creation (D-0042: host-decided)
      if (ctx.providers.stream) {
        const handle = ctx.providers.stream.createStream(exec.name, 'executor');
        if (handle) {
          ctx.promiseStreamMap[exec.name] = handle;
          // D-0041: stream closes when promise resolves — EXECUTE resolves inline
          ctx.providers.stream.close(handle);
        }
      }

      return 'continue';
    }

    case 'Op.Wait': {
      const wait = node as WaitNode;
      const promiseNames = wait.on.map(ref => ref.name);

      // Check which promises are already resolved
      const pending = promiseNames.filter(name => {
        const entry = ctx.promises[name];
        return !entry || entry.status === 'pending';
      });

      if (pending.length === 0) {
        // All promises already resolved — bind $name and continue
        if (wait.name) {
          const mode = wait.mode ?? 'all';
          if (mode === 'any') {
            // First resolved promise value
            const firstName = promiseNames[0];
            scope.set(wait.name, ctx.promises[firstName]?.result ?? null);
          } else {
            // All resolved — collect results in order
            const results = promiseNames.map(n => ctx.promises[n]?.result ?? null);
            scope.set(wait.name, results.length === 1 ? results[0] : results);
          }
        }
        return 'continue';
      }

      // Some promises still pending — yield to host
      return {
        type: 'yield',
        detail: {
          type: 'wait-promises',
          promiseNames: pending,
          mode: wait.mode ?? 'all',
        },
      };
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
        const result = await executeBlockNodes(ifNode.body, scope, ctx);
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
        const result = await executeBlockNodes(repeat.body, scope, ctx);
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
        const result = await executeBlockNodes(each.body, iterScope, ctx);
        if (result === 'exit') return 'exit';
      }
      return 'continue';
    }

    case 'Op.Signal': {
      const sig = node as SignalNode;

      // Find stream handle by target name
      const handle = ctx.promiseStreamMap[sig.target.name];
      if (!handle) {
        throw new ExecutionError(
          `stream ~${sig.target.name} does not exist`,
          sig.target.span,
        );
      }

      if (!ctx.providers.stream) {
        throw new HostError('SIGNAL requires a StreamProvider', sig.span);
      }

      // R-0048: check isOpen before each SIGNAL
      if (!ctx.providers.stream.isOpen(handle)) {
        throw new ExecutionError(
          `stream ~${sig.target.name} is closed — cannot send SIGNAL after close`,
          sig.target.span,
        );
      }

      // D-0040: SIGNAL is async — places payload in buffer, executor continues
      const payload = interpolate(sig.body, scope);
      ctx.providers.stream.signal(handle, payload);
      return 'continue';
    }

    case 'Unsupported':
      throw new NotImplementedError(`operator ${node.operatorId}`, node.span);

    default:
      // Op.Actors, Op.Tools — no-op at execution time
      return 'continue';
  }
}

/** Execute block body nodes (IF, REPEAT, EACH). */
async function executeBlockNodes(
  nodes: ReadonlyArray<OperatorNode | import('../ast/nodes.js').CommentNode>,
  scope: Scope,
  ctx: ExecContext,
): Promise<'exit' | 'continue'> {
  const ops = operatorNodes(nodes);
  for (const node of ops) {
    const result = await executeNode(node, scope, ctx);
    if (result === 'exit') return 'exit';
    if (result && typeof result === 'object' && result.type === 'yield') {
      throw new ExecutionError(
        'yield inside control-flow blocks is not supported in this version',
        node.span,
      );
    }
  }
  return 'continue';
}
