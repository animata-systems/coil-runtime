import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse } from '../parser/parser.js';
import { validate } from './validator.js';
import type { DialectTable } from '../dialect/types.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/SPEC.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');

let enTable: DialectTable;
let enIndex: KeywordIndex;

function validateEN(src: string) {
  const tokens = tokenize(src, enIndex);
  const ast = parse(tokens, enTable, src);
  return validate(ast, enTable);
}

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
});

describe('validate', () => {
  it('скрипт с EXIT → пустой массив ошибок', () => {
    const result = validateEN('RECEIVE name\nEND\nEXIT');
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('скрипт без EXIT → error exit-required', () => {
    const result = validateEN('RECEIVE name\nEND');
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe('exit-required');
  });

  it('операторы после EXIT → warning unreachable-after-exit (R-0009)', () => {
    const result = validateEN('EXIT\nRECEIVE name\nEND');
    const warnings = result.diagnostics.filter(d => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe('unreachable-after-exit');
  });

  it('EXIT в середине + EXIT в конце → warning на операторы между ними', () => {
    const result = validateEN('EXIT\nRECEIVE name\nEND\nEXIT');
    const warnings = result.diagnostics.filter(d => d.severity === 'warning');
    // RECEIVE и second EXIT are unreachable
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.every(w => w.ruleId === 'unreachable-after-exit')).toBe(true);
  });

  it('скрипт с UnsupportedOperatorNode (GATHER) → error unsupported-operator (R-0011)', () => {
    const result = validateEN('GATHER\nEND\nEXIT');
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors.some(e => e.ruleId === 'unsupported-operator')).toBe(true);
  });

  it('полный валидный скрипт → 0 errors, 0 warnings', () => {
    const src = `RECEIVE name
<<
What is your name?
>>
END

SEND
<<
Hello, $name!
>>
END

EXIT`;
    const result = validateEN(src);
    expect(result.diagnostics).toHaveLength(0);
  });
});
