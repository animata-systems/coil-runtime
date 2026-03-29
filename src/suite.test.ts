/**
 * Integration tests: Run .coil test files, examples, and dialect showcases
 * through the full pipeline (tokenize → parse → validate).
 *
 * File selection and expected outcomes are driven by metadata annotations
 * (@test, @dialect, @role, etc.) embedded in each .coil / .md file.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { tokenize, LexerError } from './lexer/index.js';
import { loadDialect, KeywordIndex } from './dialect/index.js';
import { parse, ParseError } from './parser/index.js';
import { validate } from './validator/index.js';
import type { DialectTable } from './dialect/index.js';

// ─── Paths ──────────────────────────────────────────────

const require = createRequire(import.meta.url);
const COIL_DIR = dirname(require.resolve('coil/package.json'));
const DIALECTS_DIR = join(COIL_DIR, 'dialects');
const TESTS_DIR = join(COIL_DIR, 'tests');
const EXAMPLES_DIR = join(COIL_DIR, 'examples');

// ─── Metadata extraction ────────────────────────────────

interface CoilMeta {
  test: 'valid' | 'invalid';
  role: string;
  dialect: string;
  errorPhase?: 'parse' | 'validate';
  errorCode?: string;
  description: string;
}

/** Extract metadata from .coil file header comments (`' @field value`). */
function extractCoilMeta(src: string, filePath: string): CoilMeta {
  const get = (field: string): string | undefined => {
    const m = src.match(new RegExp(`^'\\s*@${field}\\s+(.+)`, 'm'));
    return m?.[1].trim();
  };
  const test = get('test') as 'valid' | 'invalid' | undefined;
  const dialect = get('dialect');
  const role = get('role');
  if (!test) throw new Error(`Missing required @test in ${filePath}`);
  if (!dialect) throw new Error(`Missing required @dialect in ${filePath}`);
  if (!role) throw new Error(`Missing required @role in ${filePath}`);
  const errorRaw = get('error');
  let errorPhase: 'parse' | 'validate' | undefined;
  let errorCode: string | undefined;
  if (errorRaw) {
    const parts = errorRaw.split(/\s+/);
    errorPhase = parts[0] as 'parse' | 'validate';
    errorCode = parts[1];
  }
  return {
    test,
    role,
    dialect,
    errorPhase,
    errorCode,
    description: get('description') ?? '',
  };
}

/** Extract metadata from .md file HTML comments (`<!-- @field value -->`). */
function extractMdMeta(src: string, filePath: string): CoilMeta {
  const get = (field: string): string | undefined => {
    const m = src.match(new RegExp(`<!--\\s*@${field}\\s+(.+?)\\s*-->`));
    return m?.[1].trim();
  };
  const dialect = get('dialect');
  if (!dialect) throw new Error(`Missing required @dialect in ${filePath}`);
  const errorRaw = get('error');
  let errorPhase: 'parse' | 'validate' | undefined;
  let errorCode: string | undefined;
  if (errorRaw) {
    const parts = errorRaw.split(/\s+/);
    errorPhase = parts[0] as 'parse' | 'validate';
    errorCode = parts[1];
  }
  return {
    test: (get('test') as 'valid' | 'invalid') ?? 'valid',
    role: get('role') ?? 'unknown',
    dialect,
    errorPhase,
    errorCode,
    description: get('description') ?? '',
  };
}

// ─── Dialect cache ──────────────────────────────────────

const dialectCache = new Map<string, { table: DialectTable; index: KeywordIndex }>();

async function getDialect(name: string): Promise<{ table: DialectTable; index: KeywordIndex }> {
  if (!dialectCache.has(name)) {
    const path = join(DIALECTS_DIR, name, `${name}.json`);
    const table = await loadDialect(path);
    const index = KeywordIndex.build(table);
    dialectCache.set(name, { table, index });
  }
  return dialectCache.get(name)!;
}

// ─── Helpers ────────────────────────────────────────────

/** Recursively collect .coil files from a directory. */
function collectCoilFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectCoilFiles(full));
    } else if (entry.endsWith('.coil')) {
      results.push(full);
    }
  }
  return results.sort();
}

/** Collect .md files from a directory (non-recursive). */
function collectMdFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => join(dir, f));
}

/** Extract contents of ```coil fenced code blocks from markdown. */
function extractCoilBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /^```coil\s*\n([\s\S]*?)^```\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/** Recursively remove `span` keys from an object tree for snapshot comparison. */
function stripSpans(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripSpans);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'span') out[k] = stripSpans(v);
    }
    return out;
  }
  return obj;
}

function runValidChecks(src: string, table: DialectTable, index: KeywordIndex) {
  const tokens = tokenize(src, index);
  const ast = parse(tokens, table, src);
  expect(ast.nodes.length).toBeGreaterThan(0);
  const unsupported = ast.nodes.filter(n => n.kind === 'Unsupported');
  expect(unsupported).toHaveLength(0);
  const result = validate(ast, table);
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  expect(errors).toHaveLength(0);
  expect(stripSpans(ast)).toMatchSnapshot();
}

function runInvalidChecks(src: string, meta: CoilMeta, table: DialectTable, index: KeywordIndex) {
  expect(meta.errorPhase).toBeDefined();
  expect(['parse', 'validate']).toContain(meta.errorPhase);

  if (meta.errorPhase === 'parse') {
    // Must throw a ParseError or LexerError at tokenize/parse phase.
    let thrown: unknown;
    try {
      const tokens = tokenize(src, index);
      parse(tokens, table, src);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(
      thrown instanceof ParseError || thrown instanceof LexerError,
    ).toBe(true);
    expect(meta.errorCode, 'parse tests must specify error code').toBeTruthy();
    expect((thrown as ParseError | LexerError).errorCode).toBe(meta.errorCode);
  } else {
    // Parser must succeed, validator must report errors with specific ruleId.
    expect(meta.errorCode, 'validate tests must specify error code').toBeTruthy();
    const tokens = tokenize(src, index);
    const ast = parse(tokens, table, src);
    const result = validate(ast, table);
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors.some(e => e.ruleId === meta.errorCode)).toBe(true);
  }
}

// ─── Tests: conformance corpus (tests/) ─────────────────

describe('conformance tests', () => {
  const allFiles = collectCoilFiles(TESTS_DIR);

  for (const file of allFiles) {
    const label = relative(TESTS_DIR, file);

    it(label, async () => {
      const src = await readFile(file, 'utf-8');
      const meta = extractCoilMeta(src, label);
      const { table, index } = await getDialect(meta.dialect);

      if (meta.test === 'valid') {
        runValidChecks(src, table, index);
      } else {
        runInvalidChecks(src, meta, table, index);
      }
    });
  }
});

// ─── Tests: executable examples (examples/**/*.coil) ────

describe('executable examples', () => {
  const allFiles = collectCoilFiles(EXAMPLES_DIR);

  for (const file of allFiles) {
    const label = relative(EXAMPLES_DIR, file);

    it(label, async () => {
      const src = await readFile(file, 'utf-8');
      const meta = extractCoilMeta(src, label);
      const { table, index } = await getDialect(meta.dialect);

      if (meta.test === 'valid') {
        runValidChecks(src, table, index);
      } else {
        runInvalidChecks(src, meta, table, index);
      }
    });
  }
});

// ─── Tests: narrative examples (examples/**/*.md) ───────

describe('narrative examples', () => {
  const mdFiles = collectMdFiles(EXAMPLES_DIR);

  for (const file of mdFiles) {
    const label = relative(EXAMPLES_DIR, file);

    it(label, async () => {
      const md = await readFile(file, 'utf-8');
      const meta = extractMdMeta(md, label);
      const blocks = extractCoilBlocks(md);
      expect(blocks.length).toBeGreaterThan(0);

      const { table, index } = await getDialect(meta.dialect);

      for (const block of blocks) {
        runValidChecks(block, table, index);
      }
    });
  }
});

// ─── Tests: dialect showcases (dialects/*/README.md) ────

describe('dialect showcases', () => {
  const dialectDirs = readdirSync(DIALECTS_DIR)
    .filter(d => statSync(join(DIALECTS_DIR, d)).isDirectory())
    .sort();

  for (const dialectName of dialectDirs) {
    const readmePath = join(DIALECTS_DIR, dialectName, 'README.md');

    it(dialectName, async () => {
      const md = await readFile(readmePath, 'utf-8');
      const meta = extractMdMeta(md, dialectName);
      const blocks = extractCoilBlocks(md);
      expect(blocks.length).toBeGreaterThan(0);

      const { table, index } = await getDialect(meta.dialect);

      for (const block of blocks) {
        runValidChecks(block, table, index);
      }
    });
  }
});
