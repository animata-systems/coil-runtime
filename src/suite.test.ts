/**
 * Phase 6: Run existing .coil test files from coil/tests through the pipeline.
 * Valid tests → parse succeeds (may contain UnsupportedOperatorNode).
 * Invalid tests → parse or tokenize throws.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tokenize, LexerError } from './lexer/index.js';
import { loadDialect, KeywordIndex } from './dialect/index.js';
import { parse, ParseError } from './parser/index.js';
import type { DialectTable } from './dialect/index.js';
import type { SendNode } from './ast/index.js';

const require = createRequire(import.meta.url);
const COIL_DIR = dirname(require.resolve('coil/package.json'));
const DIALECTS_DIR = join(COIL_DIR, 'dialects');
const TESTS_DIR = join(COIL_DIR, 'tests');
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');

let enTable: DialectTable;
let enIndex: KeywordIndex;

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
});

async function parseFile(path: string) {
  const src = await readFile(path, 'utf-8');
  const tokens = tokenize(src, enIndex);
  return parse(tokens, enTable);
}

// ─── valid/core ──────────────────────────────────────────

describe('valid/core — parse succeeds', () => {
  it('receive-with-prompt.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'receive-with-prompt.coil'));
    const ops = ast.nodes.filter(n => n.kind !== 'Comment');
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].kind).toBe('Op.Receive');
  });

  it('exit.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'exit.coil'));
    const ops = ast.nodes.filter(n => n.kind !== 'Comment');
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('Op.Exit');
  });

  it('send-fire-and-forget.coil — SEND без AWAIT парсится', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'send-fire-and-forget.coil'));
    const send = ast.nodes.find(op => op.kind === 'Op.Send') as SendNode | undefined;
    expect(send).toBeTruthy();
    expect(send!.await).toBeNull();
  });

  it('send-await-all.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'send-await-all.coil'));
    const send = ast.nodes.find(op => op.kind === 'Op.Send') as SendNode | undefined;
    expect(send).toBeTruthy();
    expect(send!.await).toBe('all');
  });

  it('send-await-any.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'send-await-any.coil'));
    const send = ast.nodes.find(op => op.kind === 'Op.Send') as SendNode | undefined;
    expect(send).toBeTruthy();
    expect(send!.await).toBe('any');
  });

  it('send-reply-to.coil — TO, FOR, REPLY TO распознаны', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'send-reply-to.coil'));
    const send = ast.nodes.find(op => op.kind === 'Op.Send') as SendNode | undefined;
    expect(send).toBeTruthy();
    expect(send!.replyTo).not.toBeNull();
    expect(send!.to).not.toBeNull();
    expect(send!.for.length).toBeGreaterThan(0);
  });

  it('actors-inline.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'actors-inline.coil'));
    expect(ast.nodes.some(op => op.kind === 'Unsupported')).toBe(true);
  });

  it('think-full.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'core', 'think-full.coil'));
    expect(ast.nodes.some(op => op.kind === 'Unsupported')).toBe(true);
  });
});

// ─── valid/extended — parse succeeds (all Unsupported) ──

describe('valid/extended — parse succeeds', () => {
  it('repeat-count-only.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'extended', 'repeat-count-only.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });

  it('each-from-list.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'extended', 'each-from-list.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });

  it('signal-context.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'extended', 'signal-context.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });
});

// ─── valid/patterns — complex scripts parse ─────────────

describe('valid/patterns — parse succeeds', () => {
  it('classify-and-route.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'patterns', 'classify-and-route.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });

  it('parallel-think-wait-all.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'patterns', 'parallel-think-wait-all.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });

  it('iterative-improve.coil', async () => {
    const ast = await parseFile(join(TESTS_DIR, 'valid', 'patterns', 'iterative-improve.coil'));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });
});

// ─── invalid — parser rejects ───────────────────────────

describe('invalid — parser/lexer rejects', () => {
  it('exit-with-args.coil', async () => {
    await expect(parseFile(join(TESTS_DIR, 'invalid', 'exit-with-args.coil')))
      .rejects.toSatisfy(
        (err: unknown) => err instanceof ParseError || err instanceof LexerError,
      );
  });
});
