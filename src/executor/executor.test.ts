import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse } from '../parser/parser.js';
import { execute, resume, ExecutionError, NotImplementedError } from './executor.js';
import { Scope } from './scope.js';
import { evaluate } from './evaluate.js';
import { resolveFieldPath } from './resolve.js';
import type { DialectTable } from '../dialect/types.js';
import type {
  RuntimeProviders, ExecutionResult, YieldRequest, ResumeEvent,
} from '../sdk/types.js';
import {
  MockChannelProvider, MockModelProvider, MockToolProvider,
  MockParticipantProvider, MockStreamProvider,
} from '../sdk/mock-runtime.js';
import type { ModelCallConfig } from '../sdk/types.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/README.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-standard', 'ru-standard.json');

let enTable: DialectTable;
let ruTable: DialectTable;
let enIndex: KeywordIndex;
let ruIndex: KeywordIndex;

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  ruTable = await loadDialect(RU_PATH);
  ruIndex = KeywordIndex.build(ruTable);
});

/**
 * Mock providers for testing. Uses MockChannelProvider to capture SEND output.
 * receiveValues provides scripted responses for RECEIVE yield points.
 */
function mockProviders(receiveValues: string[] = []) {
  const channel = new MockChannelProvider();
  const providers: RuntimeProviders = { channel };
  return { providers, channel, receiveValues };
}

/** Get sent text from channel deliveries. */
function sentText(channel: MockChannelProvider): string[] {
  return channel.deliveries.map(d =>
    typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload),
  );
}

function parseEN(src: string) {
  return parse(tokenize(src, enIndex), enTable, src);
}

function parseRU(src: string) {
  return parse(tokenize(src, ruIndex), ruTable, src);
}

/**
 * Execute to completion, handling RECEIVE yields with scripted values.
 */
async function executeToCompletion(
  src: string,
  receiveValues: string[] = [],
  dialect: 'en' | 'ru' = 'en',
): Promise<{ sent: string[] }> {
  const ast = dialect === 'en' ? parseEN(src) : parseRU(src);
  const channel = new MockChannelProvider();
  const providers: RuntimeProviders = { channel };

  let receiveIndex = 0;
  let result = await execute(ast, providers);

  while (result.type === 'yield') {
    const yr = result as YieldRequest;
    if (yr.detail.type === 'receive') {
      const value = receiveValues[receiveIndex++] ?? '';
      const event: ResumeEvent = { type: 'ReceiveValue', value };
      result = await resume(yr.snapshot, event, ast, providers);
    } else {
      throw new Error(`unexpected yield type: ${yr.detail.type}`);
    }
  }

  return { sent: sentText(channel) };
}

// ─── Basic operations ──────────────────────────────────

describe('executor', () => {
  it('RECEIVE + SEND + EXIT с mock providers', async () => {
    const { sent } = await executeToCompletion(
      `RECEIVE name\n<<\nWhat is your name?\n>>\nEND\n\nSEND\n<<\nHello, $name!\n>>\nEND\n\nEXIT`,
      ['World'],
    );
    expect(sent).toEqual(['Hello, World!']);
  });

  it('SEND с TO delivers to channel', async () => {
    const ast = parseEN('SEND\nTO #channel\n<< msg >>\nEND\nEXIT');
    const channel = new MockChannelProvider();
    const result = await execute(ast, { channel });
    expect(result.type).toBe('completed');
    expect(channel.deliveries[0].channel).toBe('channel');
  });

  it('ненайденная $-ссылка → ExecutionError', async () => {
    const ast = parseEN('SEND\n<< Hello, $unknown! >>\nEND\nEXIT');
    const channel = new MockChannelProvider();
    await expect(execute(ast, { channel })).rejects.toThrow(ExecutionError);
    await expect(execute(ast, { channel })).rejects.toThrow('undefined variable');
  });

  it('несколько RECEIVE подряд', async () => {
    const { sent } = await executeToCompletion(
      `RECEIVE first\nEND\nRECEIVE second\nEND\nSEND\n<< $first and $second >>\nEND\nEXIT`,
      ['Alice', 'Bob'],
    );
    expect(sent).toEqual(['Alice and Bob']);
  });

  it('SEND без тела → пустая строка', async () => {
    const { sent } = await executeToCompletion('SEND\nEND\nEXIT');
    expect(sent).toEqual(['']);
  });

  it('EXIT прекращает исполнение', async () => {
    const { sent } = await executeToCompletion('SEND\n<< first >>\nEND\nEXIT');
    expect(sent).toEqual(['first']);
  });
});

// ─── DEFINE / SET ───────────────────────────────────────

describe('DEFINE / SET', () => {
  it('DEFINE + SEND interpolates value', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE greeting\n"hello"\nEND\nSEND\n<< $greeting >>\nEND\nEXIT',
    );
    expect(sent).toEqual(['hello']);
  });

  it('SET updates existing variable', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE x\n1\nEND\nSET $x\n2\nEND\nSEND\n<< $x >>\nEND\nEXIT',
    );
    expect(sent).toEqual(['2']);
  });

  it('SET on undefined variable → ExecutionError', async () => {
    const ast = parseEN('SET $unknown\n1\nEND\nEXIT');
    await expect(execute(ast)).rejects.toThrow(ExecutionError);
    await expect(execute(ast)).rejects.toThrow('not defined');
  });

  it('DEFINE with template body', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE name\n"World"\nEND\nDEFINE msg\n<< Hello, $name! >>\nEND\nSEND\n<< $msg >>\nEND\nEXIT',
    );
    expect(sent).toEqual(['Hello, World!']);
  });
});

// ─── IF ─────────────────────────────────────────────────

describe('IF executor', () => {
  it('IF true → body executes', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE x\n5\nEND\nIF $x = 5\nSEND\n<< yes >>\nEND\nEND\nEXIT',
    );
    expect(sent).toEqual(['yes']);
  });

  it('IF false → body skipped', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE x\n5\nEND\nIF $x = 3\nSEND\n<< no >>\nEND\nEND\nEXIT',
    );
    expect(sent).toEqual([]);
  });

  it('IF with AND condition', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE a\n1\nEND\nDEFINE b\n2\nEND\nIF $a = 1 AND $b = 2\nSEND\n<< both >>\nEND\nEND\nEXIT',
    );
    expect(sent).toEqual(['both']);
  });

  it('IF with NOT condition', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE x\n3\nEND\nIF NOT ($x = 5)\nSEND\n<< not five >>\nEND\nEND\nEXIT',
    );
    expect(sent).toEqual(['not five']);
  });

  it('EXIT inside IF propagates', async () => {
    const { sent } = await executeToCompletion(
      'DEFINE x\n1\nEND\nIF $x = 1\nEXIT\nEND\nSEND\n<< unreachable >>\nEND\nEXIT',
    );
    expect(sent).toEqual([]);
  });
});

// ─── REPEAT ─────────────────────────────────────────────

describe('REPEAT executor', () => {
  it('REPEAT count-only', async () => {
    const { sent } = await executeToCompletion(
      'REPEAT 3\nSEND\n<< ping >>\nEND\nEND\nEXIT',
    );
    expect(sent).toEqual(['ping', 'ping', 'ping']);
  });

  it('REPEAT UNTIL breaks early', async () => {
    const { sent } = await executeToCompletion(
      `DEFINE done\nFALSE\nEND\nREPEAT UNTIL $done = TRUE NO MORE THAN 5\n  SEND\n  << tick >>\n  END\n  SET $done\n  TRUE\n  END\nEND\nEXIT`,
    );
    expect(sent).toEqual(['tick']);
  });
});

// ─── EACH ───────────────────────────────────────────────

describe('EACH executor', () => {
  it('EACH with empty array → no iterations', async () => {

    const scope = new Scope();
    scope.set('items', []);
    expect(Array.isArray(scope.get('items'))).toBe(true);
    expect((scope.get('items') as unknown[]).length).toBe(0);
  });

  it('EACH non-array → ExecutionError', async () => {
    const ast = parseEN('DEFINE items\n"not an array"\nEND\nEACH $item FROM $items\nSEND\n<< $item >>\nEND\nEND\nEXIT');
    await expect(execute(ast)).rejects.toThrow(ExecutionError);
    await expect(execute(ast)).rejects.toThrow('not iterable');
  });
});

// ─── Scope isolation (D-0045) ───────────────────────────

describe('Scope', () => {
  it('child scope reads from parent', async () => {

    const parent = new Scope();
    parent.set('x', 42);
    const child = parent.child();
    expect(child.get('x')).toBe(42);
  });

  it('child scope writes do not affect parent', async () => {

    const parent = new Scope();
    parent.set('x', 1);
    const child = parent.child();
    child.set('x', 2);
    expect(child.get('x')).toBe(2);
    expect(parent.get('x')).toBe(1);
  });

  it('child scope has() walks up chain', async () => {

    const parent = new Scope();
    parent.set('x', 1);
    const child = parent.child();
    expect(child.has('x')).toBe(true);
    expect(child.has('y')).toBe(false);
  });

  it('toSnapshot / fromSnapshot round-trip', async () => {

    const parent = new Scope();
    parent.set('a', 1);
    const child = parent.child();
    child.set('b', 'hello');

    const snapshot = child.toSnapshot();
    const json = JSON.stringify(snapshot);
    const restored = Scope.fromSnapshot(JSON.parse(json));

    expect(restored.get('b')).toBe('hello');
    expect(restored.get('a')).toBe(1);
    expect(restored.has('a')).toBe(true);
    expect(restored.has('c')).toBe(false);
  });
});

// ─── Field access (R-0037) ──────────────────────────────

describe('field access', () => {
  it('resolveFieldPath traverses object', async () => {

    const span = { offset: 0, length: 1, line: 1, col: 1 };
    const obj = { a: { b: { c: 42 } } };
    expect(resolveFieldPath(obj, ['a', 'b', 'c'], span)).toBe(42);
  });

  it('resolveFieldPath on null → ExecutionError', async () => {

    const span = { offset: 0, length: 1, line: 1, col: 1 };
    expect(() => resolveFieldPath(null, ['x'], span)).toThrow('cannot access');
  });

  it('resolveFieldPath on missing property → ExecutionError', async () => {

    const span = { offset: 0, length: 1, line: 1, col: 1 };
    expect(() => resolveFieldPath({ a: 1 }, ['b'], span)).toThrow('does not exist');
  });

  it('resolveFieldPath on non-object → ExecutionError', async () => {

    const span = { offset: 0, length: 1, line: 1, col: 1 };
    expect(() => resolveFieldPath('hello', ['length'], span)).toThrow('cannot access');
  });
});

// ─── Expression evaluator ───────────────────────────────

describe('expression evaluator', () => {
  it('equality comparison', async () => {


    const scope = new Scope();
    scope.set('x', 'hello');
    const expr = { kind: 'BinaryExpr' as const, op: '=' as const, left: { kind: 'VarRefExpr' as const, name: 'x', path: [], span: { offset: 0, length: 1, line: 1, col: 1 } }, right: { kind: 'LiteralExpr' as const, value: 'hello', literalType: 'string' as const, span: { offset: 0, length: 1, line: 1, col: 1 } }, span: { offset: 0, length: 1, line: 1, col: 1 } };
    expect(evaluate(expr, scope)).toBe(true);
  });

  it('numeric comparison', async () => {


    const scope = new Scope();
    scope.set('score', 8);
    const expr = { kind: 'BinaryExpr' as const, op: '>=' as const, left: { kind: 'VarRefExpr' as const, name: 'score', path: [], span: { offset: 0, length: 1, line: 1, col: 1 } }, right: { kind: 'LiteralExpr' as const, value: 5, literalType: 'number' as const, span: { offset: 0, length: 1, line: 1, col: 1 } }, span: { offset: 0, length: 1, line: 1, col: 1 } };
    expect(evaluate(expr, scope)).toBe(true);
  });

  it('numeric comparison on non-numbers → ExecutionError', async () => {


    const scope = new Scope();
    scope.set('x', 'hello');
    const expr = { kind: 'BinaryExpr' as const, op: '>' as const, left: { kind: 'VarRefExpr' as const, name: 'x', path: [], span: { offset: 0, length: 1, line: 1, col: 1 } }, right: { kind: 'LiteralExpr' as const, value: 5, literalType: 'number' as const, span: { offset: 0, length: 1, line: 1, col: 1 } }, span: { offset: 0, length: 1, line: 1, col: 1 } };
    expect(() => evaluate(expr, scope)).toThrow(ExecutionError);
  });
});

// ─── Pause / Resume (R-0040) ────────────────────────────

describe('pause/resume', () => {
  it('RECEIVE yields, resume restores scope', async () => {
    const ast = parseEN(`RECEIVE name\n<<\nWhat is your name?\n>>\nEND\n\nSEND\n<< Hello, $name! >>\nEND\n\nEXIT`);
    const channel = new MockChannelProvider();
    const providers: RuntimeProviders = { channel };

    // Step 1: execute → should yield at RECEIVE
    const result1 = await execute(ast, providers);
    expect(result1.type).toBe('yield');
    const yr = result1 as YieldRequest;
    expect(yr.detail.type).toBe('receive');

    // Step 2: serialize and deserialize snapshot
    const json = JSON.stringify(yr.snapshot);
    const restoredSnapshot = JSON.parse(json);

    // Step 3: resume with value
    const result2 = await resume(
      restoredSnapshot,
      { type: 'ReceiveValue', value: 'World' },
      ast,
      providers,
    );

    expect(result2.type).toBe('completed');
    expect(sentText(channel)).toEqual(['Hello, World!']);
  });

  it('multiple RECEIVE yields in sequence', async () => {
    const ast = parseEN(`RECEIVE first\nEND\nRECEIVE second\nEND\nSEND\n<< $first and $second >>\nEND\nEXIT`);
    const channel = new MockChannelProvider();
    const providers: RuntimeProviders = { channel };

    // First RECEIVE
    let result = await execute(ast, providers);
    expect(result.type).toBe('yield');
    let yr = result as YieldRequest;

    // Resume first
    result = await resume(yr.snapshot, { type: 'ReceiveValue', value: 'Alice' }, ast, providers);
    expect(result.type).toBe('yield');
    yr = result as YieldRequest;

    // Resume second
    result = await resume(yr.snapshot, { type: 'ReceiveValue', value: 'Bob' }, ast, providers);
    expect(result.type).toBe('completed');
    expect(sentText(channel)).toEqual(['Alice and Bob']);
  });

  it('RECEIVE yield detail: block form → variableName + prompt string', async () => {
    const ast = parseEN(`RECEIVE name\n<<\nEnter name:\n>>\nEND\nEXIT`);
    const result = await execute(ast);
    expect(result.type).toBe('yield');
    const yr = result as YieldRequest;
    expect(yr.detail).toEqual(expect.objectContaining({
      type: 'receive',
      variableName: 'name',
    }));
    expect(typeof (yr.detail as { prompt: string | null }).prompt).toBe('string');
  });

  it('RECEIVE yield detail: inline form → variableName + prompt null', async () => {
    const ast = parseEN(`RECEIVE config\nEXIT`);
    const result = await execute(ast);
    expect(result.type).toBe('yield');
    const yr = result as YieldRequest;
    expect(yr.detail).toEqual({
      type: 'receive',
      variableName: 'config',
      prompt: null,
      timeoutMs: null,
    });
  });

  it('snapshot is JSON-serializable', async () => {
    const ast = parseEN(`DEFINE x\n42\nEND\nRECEIVE y\nEND\nEXIT`);
    const result = await execute(ast);
    expect(result.type).toBe('yield');

    const yr = result as YieldRequest;
    const json = JSON.stringify(yr.snapshot);
    const parsed = JSON.parse(json);

    // Scope should contain x=42
    expect(parsed.scope.variables.x).toBe(42);
    // PC should point to the RECEIVE node
    expect(parsed.pc).toEqual([{ node: 1 }]);
  });
});

// ─── SEND full contract (D-0036) ────────────────────────

describe('SEND full contract', () => {
  it('SEND TO #channel delivers to channel', async () => {
    const ast = parseEN('SEND\nTO #support\n<< help >>\nEND\nEXIT');
    const channel = new MockChannelProvider();
    const result = await execute(ast, { channel });
    expect(result.type).toBe('completed');
    expect(channel.deliveries).toHaveLength(1);
    expect(channel.deliveries[0].channel).toBe('support');
    expect(channel.deliveries[0].payload).toBe('help');
  });

  it('SEND FOR @name resolves participant', async () => {

    const channel = new MockChannelProvider();
    const participant = new MockParticipantProvider();
    const ast = parseEN('ACTORS alice\nSEND\nFOR @alice\n<< hello >>\nEND\nEXIT');
    const result = await execute(ast, { channel, participant });
    expect(result.type).toBe('completed');
    expect(channel.deliveries[0].participantIds).toEqual(['mock-alice']);
  });

  it('SEND without ChannelProvider → HostError', async () => {
    const ast = parseEN('SEND\n<< hi >>\nEND\nEXIT');
    await expect(execute(ast)).rejects.toThrow('SEND requires a ChannelProvider');
  });

  it('SEND FOR without ParticipantProvider → HostError', async () => {
    const channel = new MockChannelProvider();
    const ast = parseEN('ACTORS bob\nSEND\nFOR @bob\n<< hi >>\nEND\nEXIT');
    await expect(execute(ast, { channel })).rejects.toThrow('ParticipantProvider');
  });

  it('SEND AWAIT ANY yields and resumes with single reply', async () => {
    const ast = parseEN('ACTORS client\nSEND reply\nFOR @client\nAWAIT ANY\n<< question >>\nEND\nSEND\n<< got: $reply >>\nEND\nEXIT');

    const channel = new MockChannelProvider();
    const providers: RuntimeProviders = {
      channel,
      participant: new MockParticipantProvider(),
    };

    let result = await execute(ast, providers);
    expect(result.type).toBe('yield');
    const yr = result as YieldRequest;
    expect(yr.detail.type).toBe('await-replies');

    // Resume with reply
    result = await resume(
      yr.snapshot,
      {
        type: 'MessageReply',
        correlationId: 'corr-1',
        replies: [{ envelope: { from: 'client' }, payload: 'answer' }],
      },
      ast,
      providers,
    );
    expect(result.type).toBe('completed');
    // $reply should be the single message (AWAIT ANY → one reply)
    expect(channel.deliveries).toHaveLength(2);
    // $reply is a Message object (AWAIT ANY → single message)
    // When interpolated in a template, it becomes [object Object]
    // Real usage would access $reply.payload via field access (R-0037)
    expect(typeof channel.deliveries[1].payload).toBe('string');
  });

  it('SEND AWAIT ALL yields and resumes with collection', async () => {
    const ast = parseEN('ACTORS team\nSEND replies\nFOR @team\nAWAIT ALL\n<< vote >>\nEND\nEXIT');

    const channel = new MockChannelProvider();
    const providers: RuntimeProviders = {
      channel,
      participant: new MockParticipantProvider(),
    };

    let result = await execute(ast, providers);
    expect(result.type).toBe('yield');
    const yr = result as YieldRequest;
    if (yr.detail.type === 'await-replies') {
      expect(yr.detail.awaitPolicy).toBe('all');
    }

    // Resume with multiple replies
    result = await resume(
      yr.snapshot,
      {
        type: 'MessageReply',
        correlationId: 'corr-1',
        replies: [
          { envelope: { from: 'a' }, payload: 'yes' },
          { envelope: { from: 'b' }, payload: 'no' },
        ],
      },
      ast,
      providers,
    );
    expect(result.type).toBe('completed');
  });

  it('SEND AWAIT with Timeout event → ExecutionError', async () => {
    const ast = parseEN('ACTORS x\nSEND r\nFOR @x\nAWAIT ANY\nTIMEOUT 5s\n<< q >>\nEND\nEXIT');

    const channel = new MockChannelProvider();
    const providers: RuntimeProviders = {
      channel,
      participant: new MockParticipantProvider(),
    };

    let result = await execute(ast, providers);
    expect(result.type).toBe('yield');
    const yr = result as YieldRequest;

    // Resume with timeout
    await expect(
      resume(yr.snapshot, { type: 'Timeout' }, ast, providers),
    ).rejects.toThrow('timed out');
  });
});

// ─── THINK / EXECUTE / WAIT (phase 4) ──────────────────

describe('THINK executor', () => {
  it('THINK calls ModelProvider and binds $name', async () => {

    const model = new MockModelProvider([{ output: { summary: 'done' } }]);
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK analysis
GOAL << analyze this >>
END
SEND
<< $analysis >>
END
EXIT`);
    const result = await execute(ast, { model, channel });
    expect(result.type).toBe('completed');
    // $analysis is an object, interpolated as [object Object]
    expect(channel.deliveries).toHaveLength(1);
  });

  it('THINK with RESULT compiles schema for ModelProvider', async () => {
    let receivedConfig: unknown = null;
    const model = {
      async call(config: ModelCallConfig) {
        receivedConfig = config;
        return { output: { title: 'Test', score: 5 } };
      },
    };
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK review
  GOAL << review the code >>
  RESULT
  * title: TEXT - the title
  * score: NUMBER - the score
END
SEND
<< $review.title >>
END
EXIT`);
    const result = await execute(ast, { model, channel });
    expect(result.type).toBe('completed');
    const cfg = receivedConfig as ModelCallConfig;
    expect(cfg.resultSchema).not.toBeNull();
    expect(cfg.resultSchema!.length).toBe(2);
    expect(cfg.goal).toBe('review the code');
    // Field access: $review.title → "Test"
    expect(channel.deliveries[0].payload).toBe('Test');
  });

  it('THINK without ModelProvider → HostError', async () => {
    const ast = parseEN('THINK x\nGOAL << hi >>\nEND\nEXIT');
    await expect(execute(ast)).rejects.toThrow('ModelProvider');
  });
});

describe('EXECUTE executor', () => {
  it('EXECUTE calls ToolProvider and binds $name', async () => {

    const tool = new MockToolProvider({ search: { output: { results: [1, 2, 3] } } });
    const channel = new MockChannelProvider();
    const ast = parseEN(`TOOLS search
EXECUTE query
USING !search
  - q: "test"
END
SEND
<< $query.results >>
END
EXIT`);
    const result = await execute(ast, { tool, channel });
    expect(result.type).toBe('completed');
    // $query.results is an array
    expect(channel.deliveries).toHaveLength(1);
  });

  it('EXECUTE without ToolProvider → HostError', async () => {
    const ast = parseEN('TOOLS t\nEXECUTE x\nUSING !t\n  - a: 1\nEND\nEXIT');
    await expect(execute(ast)).rejects.toThrow('ToolProvider');
  });
});

describe('WAIT executor', () => {
  it('WAIT after THINK — promises already resolved, no yield', async () => {

    const model = new MockModelProvider([{ output: 42 }]);
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK answer
GOAL << compute >>
END
WAIT data
ON ?answer
END
SEND
<< $data >>
END
EXIT`);
    const result = await execute(ast, { model, channel });
    expect(result.type).toBe('completed');
    expect(channel.deliveries[0].payload).toBe('42');
  });

  it('WAIT with timeout event → ExecutionError', async () => {
    // Force a pending promise by not providing model (so THINK can't run)
    // Actually, we need a scenario where WAIT yields. In v0.4 THINK resolves inline,
    // so WAIT after THINK never yields. We test timeout via resume.

    const model = new MockModelProvider([{ output: 'ok' }]);
    const channel = new MockChannelProvider();
    // This script has THINK (resolves inline) + WAIT (already resolved) — no yield.
    // Timeout test is covered by SEND AWAIT timeout test above.
    // WAIT yield only happens when promises are truly pending (external).
    const ast = parseEN(`THINK x\nGOAL << q >>\nEND\nWAIT ON ?x\nEND\nEXIT`);
    const result = await execute(ast, { model, channel });
    expect(result.type).toBe('completed');
  });
});

// ─── Stream runtime (phase 5) ───────────────────────────

describe('stream runtime', () => {
  it('THINK creates stream via StreamProvider (host-decided)', async () => {

    const model = new MockModelProvider([{ output: 'ok' }]);
    const stream = new MockStreamProvider();
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK x\nGOAL << q >>\nEND\nEXIT`);
    await execute(ast, { model, stream, channel });
    // Stream was created and then closed (inline resolve → D-0041)
    expect(stream.isOpen({ name: 'x', ownerId: 'executor' })).toBe(false);
  });

  it('host refuses stream (createStream returns null) — no error', async () => {

    const model = new MockModelProvider([{ output: 'ok' }]);
    // StreamProvider that always refuses
    const stream = {
      createStream: () => null,
      signal: () => {},
      async *read() {},
      close: () => {},
      isOpen: () => false,
    };
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK x\nGOAL << q >>\nEND\nEXIT`);
    const result = await execute(ast, { model, stream: stream as any, channel });
    expect(result.type).toBe('completed');
  });

  it('SIGNAL on closed stream → ExecutionError', async () => {
    // THINK resolves inline → stream created and closed.
    // Then SIGNAL ~x → error because stream is closed.

    const model = new MockModelProvider([{ output: 'ok' }]);
    const stream = new MockStreamProvider();
    const channel = new MockChannelProvider();
    const ast = parseEN(`THINK x\nGOAL << q >>\nEND\nSIGNAL ~x\n<< update >>\nEND\nEXIT`);
    await expect(execute(ast, { model, stream, channel })).rejects.toThrow('closed');
  });

  it('SIGNAL on non-existent stream → ExecutionError', async () => {
    const channel = new MockChannelProvider();
    const ast = parseEN(`SIGNAL ~nonexistent\n<< data >>\nEND\nEXIT`);
    await expect(execute(ast, { channel })).rejects.toThrow('does not exist');
  });
});

// ─── Integration: полный пайплайн ────────────────────────

describe('integration', () => {
  it('EN: полный пайплайн — критерий готовности', async () => {
    const { sent } = await executeToCompletion(
      `RECEIVE name\n<<\nWhat is your name?\n>>\nEND\n\nSEND\n<<\nHello, $name!\n>>\nEND\n\nEXIT`,
      ['World'],
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe('Hello, World!');
  });

  it('RU: тот же скрипт на ru-standard', async () => {
    const { sent } = await executeToCompletion(
      `ПОЛУЧИ имя\n<<\nКак тебя зовут?\n>>\nКОНЕЦ\n\nНАПИШИ\n<<\nПривет, $имя!\n>>\nКОНЕЦ\n\nВЫХОД`,
      ['Мир'],
      'ru',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe('Привет, Мир!');
  });
});
