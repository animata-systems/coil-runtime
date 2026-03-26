/**
 * Integration tests: Run .coil test files and examples through the pipeline.
 * Valid tests → parse succeeds, no UnsupportedOperatorNode (except GATHER).
 * Invalid syntactic tests → parse or tokenize throws.
 * Examples → parse succeeds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tokenize, LexerError } from './lexer/index.js';
import { loadDialect, KeywordIndex } from './dialect/index.js';
import { parse, ParseError } from './parser/index.js';
import type { DialectTable } from './dialect/index.js';

const require = createRequire(import.meta.url);
const COIL_DIR = dirname(require.resolve('coil/package.json'));
const DIALECTS_DIR = join(COIL_DIR, 'dialects');
const TESTS_DIR = join(COIL_DIR, 'tests');
const EXAMPLES_DIR = join(COIL_DIR, 'examples');
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_MATRIX_PATH = join(DIALECTS_DIR, 'ru-matrix', 'ru-matrix.json');
const RU_STD_PATH = join(DIALECTS_DIR, 'ru-standard', 'ru-standard.json');

let enTable: DialectTable;
let enIndex: KeywordIndex;
let ruMatrixTable: DialectTable;
let ruMatrixIndex: KeywordIndex;
let ruStdTable: DialectTable;
let ruStdIndex: KeywordIndex;

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  ruMatrixTable = await loadDialect(RU_MATRIX_PATH);
  ruMatrixIndex = KeywordIndex.build(ruMatrixTable);
  ruStdTable = await loadDialect(RU_STD_PATH);
  ruStdIndex = KeywordIndex.build(ruStdTable);
});

async function parseFileEN(path: string) {
  const src = await readFile(path, 'utf-8');
  const tokens = tokenize(src, enIndex);
  return parse(tokens, enTable, src);
}

async function parseFileRU(path: string) {
  const src = await readFile(path, 'utf-8');
  const tokens = tokenize(src, ruStdIndex);
  return parse(tokens, ruStdTable, src);
}

/** List .coil files in a directory */
function coilFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.coil'))
      .sort()
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

// ─── valid/core — all 22 files parse without UnsupportedOperatorNode ──

describe('valid/core — full parse', () => {
  const files = coilFiles(join(TESTS_DIR, 'valid', 'core'));

  for (const file of files) {
    const name = file.split('/').pop()!;
    it(name, async () => {
      const ast = await parseFileEN(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
      // No UnsupportedOperatorNode
      const unsupported = ast.nodes.filter(n => n.kind === 'Unsupported');
      expect(unsupported).toHaveLength(0);
    });
  }
});

// ─── valid/extended — all 6 files ────────────────────────

describe('valid/extended — full parse', () => {
  const files = coilFiles(join(TESTS_DIR, 'valid', 'extended'));

  for (const file of files) {
    const name = file.split('/').pop()!;
    it(name, async () => {
      const ast = await parseFileEN(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
      const unsupported = ast.nodes.filter(n => n.kind === 'Unsupported');
      expect(unsupported).toHaveLength(0);
    });
  }
});

// ─── valid/patterns — all 3 files ────────────────────────

describe('valid/patterns — full parse', () => {
  const files = coilFiles(join(TESTS_DIR, 'valid', 'patterns'));

  for (const file of files) {
    const name = file.split('/').pop()!;
    it(name, async () => {
      const ast = await parseFileEN(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
      const unsupported = ast.nodes.filter(n => n.kind === 'Unsupported');
      expect(unsupported).toHaveLength(0);
    });
  }
});

// ─── valid/result — all 5 files ──────────────────────────

describe('valid/result — full parse', () => {
  const files = coilFiles(join(TESTS_DIR, 'valid', 'result'));

  for (const file of files) {
    const name = file.split('/').pop()!;
    it(name, async () => {
      const ast = await parseFileEN(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
      const unsupported = ast.nodes.filter(n => n.kind === 'Unsupported');
      expect(unsupported).toHaveLength(0);
    });
  }
});

// ─── invalid — syntactic tests (6) rejected by parser ───

const SYNTACTIC_INVALID = [
  'exit-with-args.coil',
  'think-goal-before-as.coil',
  'think-result-not-last.coil',
  'execute-template-body.coil',
  'repeat-no-limit.coil',
  'wait-value-not-promise.coil',
];

describe('invalid — syntactic tests rejected by parser', () => {
  for (const name of SYNTACTIC_INVALID) {
    it(name, async () => {
      await expect(parseFileEN(join(TESTS_DIR, 'invalid', name)))
        .rejects.toSatisfy(
          (err: unknown) => err instanceof ParseError || err instanceof LexerError,
        );
    });
  }
});

// ─── invalid — semantic tests (4) — parser succeeds, validator scope ──

const SEMANTIC_INVALID = [
  'duplicate-define.coil',
  'set-undefined.coil',
  'undeclared-actor.coil',
  'undeclared-tool.coil',
];

describe('invalid — semantic tests (out of scope, parser succeeds)', () => {
  for (const name of SEMANTIC_INVALID) {
    it(`${name} — parser does not throw`, async () => {
      // These are semantic errors caught by validator, not parser
      const ast = await parseFileEN(join(TESTS_DIR, 'invalid', name));
      expect(ast.nodes.length).toBeGreaterThan(0);
    });
  }
});

// ─── examples — all 13 .coil files parse ────────────────

describe('examples — EN parse succeeds', () => {
  const enFiles = [
    join(EXAMPLES_DIR, 'hello.coil'),
    ...coilFiles(join(EXAMPLES_DIR, 'anti-patterns')),
  ];

  for (const file of enFiles) {
    const name = file.replace(EXAMPLES_DIR + '/', '');
    it(name, async () => {
      const ast = await parseFileEN(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
    });
  }
});

describe('examples — RU (ru-standard) parse succeeds', () => {
  const ruStdFiles = coilFiles(join(EXAMPLES_DIR, 'patterns'));

  for (const file of ruStdFiles) {
    const name = file.replace(EXAMPLES_DIR + '/', '');
    it(name, async () => {
      const ast = await parseFileRU(file);
      expect(ast.nodes.length).toBeGreaterThan(0);
    });
  }
});

describe('examples — RU (ru-matrix) parse succeeds', () => {
  it('hello.ru.coil', async () => {
    const src = await readFile(join(EXAMPLES_DIR, 'hello.ru.coil'), 'utf-8');
    const tokens = tokenize(src, ruMatrixIndex);
    const ast = parse(tokens, ruMatrixTable, src);
    expect(ast.nodes.length).toBeGreaterThan(0);
  });
});
