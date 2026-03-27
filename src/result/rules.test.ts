import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse } from '../parser/parser.js';
import { validate } from '../validator/validator.js';
import type { DialectTable } from '../dialect/types.js';
import type { ValidationDiagnostic } from '../validator/validator.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/SPEC.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-matrix', 'ru-matrix.json');

let enTable: DialectTable;
let enIndex: KeywordIndex;
let ruTable: DialectTable;
let ruIndex: KeywordIndex;

function validateEN(src: string) {
  const tokens = tokenize(src, enIndex);
  const ast = parse(tokens, enTable, src);
  return validate(ast, enTable);
}

function validateRU(src: string) {
  const tokens = tokenize(src, ruIndex);
  const ast = parse(tokens, ruTable, src);
  return validate(ast, ruTable);
}

function findByRule(diagnostics: ValidationDiagnostic[], ruleId: string) {
  return diagnostics.filter((d) => d.ruleId === ruleId);
}

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  ruTable = await loadDialect(RU_PATH);
  ruIndex = KeywordIndex.build(ruTable);
});

// ─── result-choice-min-options ────────────────────────────

describe('result-choice-min-options', () => {
  it('error: CHOICE with 1 option', () => {
    const src = `
THINK triage
  GOAL <<
  Classify.
  >>
  RESULT
  * kind: CHOICE(only_one) - bad choice
END

WAIT
  ON ?triage
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-choice-min-options');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('error: CHOICE with 0 options', () => {
    const src = `
THINK triage
  GOAL <<
  Classify.
  >>
  RESULT
  * kind: CHOICE() - empty choice
END

WAIT
  ON ?triage
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-choice-min-options');
    expect(found).toHaveLength(1);
  });

  it('error: CHOICE with 1 option inside LIST', () => {
    const src = `
THINK plan
  GOAL <<
  Plan.
  >>
  RESULT
  * items: LIST - items
    * kind: CHOICE(only) - bad
END

WAIT
  ON ?plan
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-choice-min-options');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('no error: CHOICE with 2+ options', () => {
    const src = `
THINK triage
  GOAL <<
  Classify.
  >>
  RESULT
  * kind: CHOICE(a, b) - valid choice
END

WAIT
  ON ?triage
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-choice-min-options');
    expect(found).toHaveLength(0);
  });
});

// ─── result-nested-list ───────────────────────────────────

describe('result-nested-list', () => {
  it('error: LIST inside LIST', () => {
    const src = `
THINK plan
  GOAL <<
  Plan.
  >>
  RESULT
  * items: LIST - outer
    * nested: LIST - inner (illegal)
END

WAIT
  ON ?plan
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-nested-list');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('no error: LIST at root only', () => {
    const src = `
THINK plan
  GOAL <<
  Plan.
  >>
  RESULT
  * items: LIST - steps
    * name: TEXT - step name
END

WAIT
  ON ?plan
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-nested-list');
    expect(found).toHaveLength(0);
  });
});

// ─── result-leaf-with-children ────────────────────────────

describe('result-leaf-with-children', () => {
  it('error: TEXT with nested field', () => {
    const src = `
THINK analysis
  GOAL <<
  Analyze.
  >>
  RESULT
  * title: TEXT - a title
    * sub: TEXT - sub field (illegal)
END

WAIT
  ON ?analysis
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-leaf-with-children');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('no error: LIST with nested field (valid)', () => {
    const src = `
THINK analysis
  GOAL <<
  Analyze.
  >>
  RESULT
  * items: LIST - items
    * name: TEXT - item name
END

WAIT
  ON ?analysis
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-leaf-with-children');
    expect(found).toHaveLength(0);
  });
});

// ─── result-list-no-children ──────────────────────────────

describe('result-list-no-children', () => {
  it('warning: LIST without item fields', () => {
    const src = `
THINK plan
  GOAL <<
  Plan.
  >>
  RESULT
  * items: LIST - steps
END

WAIT
  ON ?plan
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-list-no-children');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
  });

  it('no warning: LIST with children', () => {
    const src = `
THINK plan
  GOAL <<
  Plan.
  >>
  RESULT
  * items: LIST - steps
    * name: TEXT - step name
END

WAIT
  ON ?plan
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-list-no-children');
    expect(found).toHaveLength(0);
  });
});

// ─── result-duplicate-field ───────────────────────────────

describe('result-duplicate-field', () => {
  it('error: duplicate field names at same level', () => {
    const src = `
THINK analysis
  GOAL <<
  Analyze.
  >>
  RESULT
  * name: TEXT - first
  * name: TEXT - duplicate
END

WAIT
  ON ?analysis
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-duplicate-field');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('no error: same name at different levels', () => {
    const src = `
THINK analysis
  GOAL <<
  Analyze.
  >>
  RESULT
  * name: TEXT - root name
  * items: LIST - items
    * name: TEXT - item name
END

WAIT
  ON ?analysis
END

EXIT
`;
    const { diagnostics } = validateEN(src);
    const found = findByRule(diagnostics, 'result-duplicate-field');
    expect(found).toHaveLength(0);
  });
});

// ─── RU dialect ───────────────────────────────────────────

describe('result rules with RU dialect', () => {
  it('detects result-nested-list in Russian', () => {
    const src = `
ПРОЗРЕЙ план
  БЕЛЫЙ КРОЛИК <<
  Спланировать.
  >>
  ПРОРОЧЕСТВО
  * шаги: ПОТОК - шаги
    * вложенный: ПОТОК - вложенный (нельзя)
ПРОСНИСЬ

ЗАМРИ
  ПОКА НЕ СБУДЕТСЯ ?план
ПРОСНИСЬ

ОТКЛЮЧИСЬ
`;
    const { diagnostics } = validateRU(src);
    const found = findByRule(diagnostics, 'result-nested-list');
    expect(found).toHaveLength(1);
  });

  it('detects result-choice-min-options in Russian', () => {
    const src = `
ПРОЗРЕЙ анализ
  БЕЛЫЙ КРОЛИК <<
  Анализировать.
  >>
  ПРОРОЧЕСТВО
  * тип: ТАБЛЕТКА(один) - один вариант
ПРОСНИСЬ

ЗАМРИ
  ПОКА НЕ СБУДЕТСЯ ?анализ
ПРОСНИСЬ

ОТКЛЮЧИСЬ
`;
    const { diagnostics } = validateRU(src);
    const found = findByRule(diagnostics, 'result-choice-min-options');
    expect(found).toHaveLength(1);
  });
});
