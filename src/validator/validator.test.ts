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

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  ruTable = await loadDialect(RU_PATH);
  ruIndex = KeywordIndex.build(ruTable);
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

// ─── Phase 2 rules ─────────────────────────────────────────

describe('undeclared-participant', () => {
  it('SEND FOR @name без ACTORS → error', () => {
    const src = `SEND
  FOR @alice
<<
Hello
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-participant');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('SEND FOR @name с ACTORS → OK', () => {
    const src = `ACTORS alice

SEND
  FOR @alice
<<
Hello
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-participant');
    expect(errors).toHaveLength(0);
  });

  it('SEND без FOR → OK (никого не адресует)', () => {
    const src = `RECEIVE msg
<<
prompt
>>
END

SEND
<<
$msg
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-participant');
    expect(errors).toHaveLength(0);
  });
});

describe('undeclared-tool', () => {
  it('THINK USING !tool без TOOLS → error', () => {
    const src = `THINK plan
  USING !search
  GOAL <<
  Find something.
  >>
END
WAIT
  ON ?plan
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-tool');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('THINK USING !tool с TOOLS → OK', () => {
    const src = `TOOLS search

THINK plan
  USING !search
  GOAL <<
  Find something.
  >>
END
WAIT
  ON ?plan
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-tool');
    expect(errors).toHaveLength(0);
  });

  it('EXECUTE USING !tool без TOOLS → error', () => {
    const src = `EXECUTE action
  USING !api_call
  - endpoint: "test"
END
WAIT
  ON ?action
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undeclared-tool');
    expect(errors).toHaveLength(1);
  });
});

describe('undefined-variable', () => {
  it('$name в SEND без определения → error', () => {
    const src = `SEND
<<
Hello, $unknown!
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-variable');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('$name после DEFINE → OK', () => {
    const src = `DEFINE greeting
<<
Hello
>>
END

SEND
<<
$greeting, world!
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-variable');
    expect(errors).toHaveLength(0);
  });

  it('$name после RECEIVE → OK', () => {
    const src = `RECEIVE msg
<<
prompt
>>
END

SEND
<<
$msg
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-variable');
    expect(errors).toHaveLength(0);
  });

  it('$name с state promised → NOT error (use-before-wait handles it)', () => {
    const src = `TOOLS search

THINK plan
  USING !search
  GOAL <<
  Plan something.
  >>
END

SEND
<<
$plan
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-variable');
    expect(errors).toHaveLength(0);
  });
});

describe('duplicate-define', () => {
  it('два безусловных DEFINE одного имени → error', () => {
    const src = `DEFINE x
<<
first
>>
END

DEFINE x
<<
second
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'duplicate-define');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('два условных DEFINE одного имени → OK (D-007-1)', () => {
    const src = `TOOLS search

THINK verdict
  USING !search
  GOAL <<
  Classify.
  >>
  RESULT
  * type: CHOICE(a, b) - request type
END

WAIT
  ON ?verdict
END

IF $verdict.type == "a"
  DEFINE role
  <<
  Role A.
  >>
  END
END

IF $verdict.type == "b"
  DEFINE role
  <<
  Role B.
  >>
  END
END

EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'duplicate-define');
    expect(errors).toHaveLength(0);
  });

  it('безусловный + условный DEFINE → error', () => {
    const src = `TOOLS search

THINK verdict
  USING !search
  GOAL <<
  Classify.
  >>
  RESULT
  * type: CHOICE(a, b) - type
END

WAIT
  ON ?verdict
END

DEFINE role
<<
Default.
>>
END

IF $verdict.type == "a"
  DEFINE role
  <<
  Override.
  >>
  END
END

EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'duplicate-define');
    expect(errors).toHaveLength(1);
  });
});

describe('set-without-define', () => {
  it('SET $x без DEFINE → error', () => {
    const src = `SET $x
<<
value
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'set-without-define');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('SET $x после DEFINE → OK', () => {
    const src = `DEFINE x
<<
initial
>>
END

SET $x
<<
updated
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'set-without-define');
    expect(errors).toHaveLength(0);
  });

  it('SET $x на promised переменную (без WAIT) → error', () => {
    const src = `TOOLS api

EXECUTE data
  USING !api
  - endpoint: "test"
END

SET $data
<<
override
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'set-without-define');
    expect(errors).toHaveLength(1);
  });

  it('SET $x на resolved promise (после WAIT) → OK', () => {
    const src = `TOOLS api

EXECUTE data
  USING !api
  - endpoint: "test"
END

WAIT
  ON ?data
END

SET $data
<<
updated
>>
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'set-without-define');
    expect(errors).toHaveLength(0);
  });
});

// ─── ru-matrix smoke tests ─────────────────────────────────

describe('ru-matrix dialect', () => {
  it('валидный скрипт на ru-matrix → 0 errors', () => {
    const src = `ПРИМИ имя
<<
Как вас зовут?
>>
ПРОСНИСЬ

ПЕРЕДАЙ
<<
Привет, $имя!
>>
ПРОСНИСЬ

ОТКЛЮЧИСЬ`;
    const result = validateRU(src);
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
  });

  it('undefined-variable на ru-matrix → error', () => {
    const src = `ПЕРЕДАЙ
<<
$неизвестная
>>
ПРОСНИСЬ
ОТКЛЮЧИСЬ`;
    const result = validateRU(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-variable');
    expect(errors).toHaveLength(1);
  });
});

// ─── Phase 3 rules ─────────────────────────────────────────

describe('undefined-promise', () => {
  it('WAIT ON ?name без запускающего оператора → error', () => {
    const src = `WAIT
  ON ?phantom
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-promise');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('WAIT ON ?name после THINK → OK', () => {
    const src = `TOOLS search

THINK plan
  USING !search
  GOAL <<
  Plan something.
  >>
END

WAIT
  ON ?plan
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-promise');
    expect(errors).toHaveLength(0);
  });

  it('WAIT ON ?name после EXECUTE → OK', () => {
    const src = `TOOLS api

EXECUTE data
  USING !api
  - endpoint: "test"
END

WAIT
  ON ?data
END
EXIT`;
    const result = validateEN(src);
    const errors = result.diagnostics.filter(d => d.ruleId === 'undefined-promise');
    expect(errors).toHaveLength(0);
  });
});

describe('use-before-wait', () => {
  it('$name от THINK использован до WAIT → info', () => {
    const src = `TOOLS search

THINK plan
  USING !search
  GOAL <<
  Plan something.
  >>
END

SEND
<<
$plan
>>
END

WAIT
  ON ?plan
END
EXIT`;
    const result = validateEN(src);
    const infos = result.diagnostics.filter(d => d.ruleId === 'use-before-wait');
    expect(infos).toHaveLength(1);
    expect(infos[0].severity).toBe('info');
  });

  it('$name от THINK использован после WAIT → OK', () => {
    const src = `TOOLS search

THINK plan
  USING !search
  GOAL <<
  Plan something.
  >>
END

WAIT
  ON ?plan
END

SEND
<<
$plan
>>
END
EXIT`;
    const result = validateEN(src);
    const infos = result.diagnostics.filter(d => d.ruleId === 'use-before-wait');
    expect(infos).toHaveLength(0);
  });

  it('$name от DEFINE не триггерит use-before-wait', () => {
    const src = `DEFINE greeting
<<
Hello
>>
END

SEND
<<
$greeting
>>
END
EXIT`;
    const result = validateEN(src);
    const infos = result.diagnostics.filter(d => d.ruleId === 'use-before-wait');
    expect(infos).toHaveLength(0);
  });
});

describe('unreachable-after-exit (D-007-5)', () => {
  it('EXIT внутри IF → НЕ считается завершением скрипта', () => {
    const src = `DEFINE flag
<<
true
>>
END

IF $flag == "true"
  EXIT
END

SEND
<<
After conditional exit.
>>
END
EXIT`;
    const result = validateEN(src);
    const warnings = result.diagnostics.filter(d => d.ruleId === 'unreachable-after-exit');
    expect(warnings).toHaveLength(0);
  });
});
