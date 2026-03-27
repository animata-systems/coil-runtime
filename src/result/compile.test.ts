import { describe, it, expect } from 'vitest';
import type { ResultField } from '../ast/nodes.js';
import type { SourceSpan } from '../common/types.js';
import type { ResultSchemaField } from './schema.js';
import { compileResult } from './compile.js';

/** Helper: create a minimal span for tests */
function span(line = 1): SourceSpan {
  return { line, col: 1, offset: 0, length: 1 };
}

/** Helper: create a ResultField */
function rf(
  name: string,
  typeId: ResultField['typeId'],
  opts?: { depth?: number; typeArgs?: string[]; description?: string; line?: number },
): ResultField {
  return {
    name,
    typeId,
    typeArgs: opts?.typeArgs ?? [],
    description: opts?.description ?? '',
    depth: opts?.depth ?? 0,
    span: span(opts?.line ?? 1),
  };
}

describe('compileResult', () => {
  it('returns empty output for empty input', () => {
    const out = compileResult([]);
    expect(out.fields).toEqual([]);
    expect(out.diagnostics).toEqual([]);
  });

  // ─── Scalar types ───────────────────────────────────────

  it('compiles TEXT field', () => {
    const out = compileResult([rf('summary', 'Typ.Text', { description: 'brief summary' })]);
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0].name).toBe('summary');
    expect(out.fields[0].description).toBe('brief summary');
    expect(out.fields[0].schema).toEqual({ kind: 'text' });
    expect(out.diagnostics).toEqual([]);
  });

  it('compiles NUMBER field', () => {
    const out = compileResult([rf('score', 'Typ.Number')]);
    expect(out.fields[0].schema).toEqual({ kind: 'number' });
  });

  it('compiles FLAG field', () => {
    const out = compileResult([rf('active', 'Typ.Flag')]);
    expect(out.fields[0].schema).toEqual({ kind: 'flag' });
  });

  it('compiles CHOICE field with options', () => {
    const out = compileResult([
      rf('severity', 'Typ.Choice', { typeArgs: ['high', 'medium', 'low'] }),
    ]);
    expect(out.fields[0].schema).toEqual({
      kind: 'choice',
      options: ['high', 'medium', 'low'],
    });
  });

  // ─── LIST with nesting ──────────────────────────────────

  it('compiles LIST with nested fields', () => {
    const out = compileResult([
      rf('items', 'Typ.List', { depth: 0 }),
      rf('name', 'Typ.Text', { depth: 1 }),
      rf('count', 'Typ.Number', { depth: 1 }),
    ]);

    expect(out.fields).toHaveLength(1);
    const list = out.fields[0];
    expect(list.schema.kind).toBe('list');
    const listSchema = list.schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    expect(listSchema.itemFields).toHaveLength(2);
    expect(listSchema.itemFields[0].name).toBe('name');
    expect(listSchema.itemFields[0].schema).toEqual({ kind: 'text' });
    expect(listSchema.itemFields[1].name).toBe('count');
    expect(listSchema.itemFields[1].schema).toEqual({ kind: 'number' });
    expect(out.diagnostics).toEqual([]);
  });

  it('compiles LIST without children (empty itemFields)', () => {
    const out = compileResult([rf('items', 'Typ.List')]);
    expect(out.fields[0].schema).toEqual({ kind: 'list', itemFields: [] });
    expect(out.diagnostics).toEqual([]);
  });

  // ─── Multiple root fields ──────────────────────────────

  it('compiles multiple root fields', () => {
    const out = compileResult([
      rf('title', 'Typ.Text'),
      rf('score', 'Typ.Number'),
      rf('done', 'Typ.Flag'),
    ]);
    expect(out.fields).toHaveLength(3);
    expect(out.fields.map((f) => f.name)).toEqual(['title', 'score', 'done']);
  });

  // ─── Multiple LISTs at root ────────────────────────────

  it('compiles multiple LISTs at root', () => {
    const out = compileResult([
      rf('pros', 'Typ.List', { depth: 0 }),
      rf('text', 'Typ.Text', { depth: 1 }),
      rf('cons', 'Typ.List', { depth: 0 }),
      rf('text', 'Typ.Text', { depth: 1 }),
    ]);

    expect(out.fields).toHaveLength(2);
    const pros = out.fields[0].schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    const cons = out.fields[1].schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    expect(pros.itemFields).toHaveLength(1);
    expect(cons.itemFields).toHaveLength(1);
    expect(out.diagnostics).toEqual([]);
  });

  // ─── Exit nesting back to root ─────────────────────────

  it('exits nesting back to root level', () => {
    const out = compileResult([
      rf('items', 'Typ.List', { depth: 0, line: 1 }),
      rf('name', 'Typ.Text', { depth: 1, line: 2 }),
      rf('summary', 'Typ.Text', { depth: 0, line: 3 }),
    ]);

    expect(out.fields).toHaveLength(2);
    expect(out.fields[0].name).toBe('items');
    expect(out.fields[1].name).toBe('summary');
    const list = out.fields[0].schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    expect(list.itemFields).toHaveLength(1);
    expect(out.diagnostics).toEqual([]);
  });

  // ─── Leaf with children (diagnostic) ───────────────────

  it('emits result-leaf-with-children for TEXT with nested field', () => {
    const out = compileResult([
      rf('title', 'Typ.Text', { depth: 0, line: 1 }),
      rf('sub', 'Typ.Text', { depth: 1, line: 2 }),
    ]);

    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].ruleId).toBe('result-leaf-with-children');
    expect(out.diagnostics[0].severity).toBe('error');
    expect(out.diagnostics[0].span.line).toBe(2);
    // Tolerant: sub is attached at root level
    expect(out.fields).toHaveLength(2);
  });

  it('emits result-leaf-with-children for CHOICE with nested field', () => {
    const out = compileResult([
      rf('kind', 'Typ.Choice', { depth: 0, typeArgs: ['a', 'b'] }),
      rf('detail', 'Typ.Text', { depth: 1 }),
    ]);

    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].ruleId).toBe('result-leaf-with-children');
  });

  it('emits result-leaf-with-children for FLAG with nested field', () => {
    const out = compileResult([
      rf('active', 'Typ.Flag', { depth: 0 }),
      rf('reason', 'Typ.Text', { depth: 1 }),
    ]);

    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].ruleId).toBe('result-leaf-with-children');
  });

  it('emits result-leaf-with-children for NUMBER with nested field', () => {
    const out = compileResult([
      rf('score', 'Typ.Number', { depth: 0 }),
      rf('unit', 'Typ.Text', { depth: 1 }),
    ]);

    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].ruleId).toBe('result-leaf-with-children');
  });

  // ─── Orphan depth ──────────────────────────────────────

  it('emits result-orphan-depth when first field has depth > 0', () => {
    const out = compileResult([rf('x', 'Typ.Text', { depth: 2 })]);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].ruleId).toBe('result-orphan-depth');
    expect(out.diagnostics[0].severity).toBe('error');
    // Tolerant: field is preserved at root
    expect(out.fields).toHaveLength(1);
  });

  // ─── LIST nested in LIST (deferred validation) ────────

  it('accepts LIST nested in LIST (validation deferred to rules.ts)', () => {
    const out = compileResult([
      rf('outer', 'Typ.List', { depth: 0 }),
      rf('inner', 'Typ.List', { depth: 1 }),
    ]);
    expect(out.diagnostics).toEqual([]);
    const outer = out.fields[0].schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    expect(outer.itemFields[0].schema.kind).toBe('list');
  });

  // ─── Complex tree ──────────────────────────────────────

  it('compiles complex tree with mixed types', () => {
    const out = compileResult([
      rf('summary', 'Typ.Text', { depth: 0, description: 'plan overview' }),
      rf('steps', 'Typ.List', { depth: 0, description: 'implementation steps' }),
      rf('description', 'Typ.Text', { depth: 1 }),
      rf('effort', 'Typ.Choice', { depth: 1, typeArgs: ['small', 'medium', 'large'] }),
      rf('dependencies', 'Typ.Text', { depth: 1 }),
    ]);

    expect(out.fields).toHaveLength(2);
    expect(out.fields[0].schema.kind).toBe('text');
    const steps = out.fields[1].schema as { kind: 'list'; itemFields: ResultSchemaField[] };
    expect(steps.itemFields).toHaveLength(3);
    expect(steps.itemFields[1].schema).toEqual({
      kind: 'choice',
      options: ['small', 'medium', 'large'],
    });
    expect(out.diagnostics).toEqual([]);
  });

  // ─── Span preservation ─────────────────────────────────

  it('preserves span from original field', () => {
    const out = compileResult([rf('x', 'Typ.Text', { line: 42 })]);
    expect(out.fields[0].span.line).toBe(42);
  });
});
