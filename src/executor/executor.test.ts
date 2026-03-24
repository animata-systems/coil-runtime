import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse } from '../parser/parser.js';
import { execute, NotImplementedError, ExecutionError } from './executor.js';
import type { Environment } from './environment.js';
import type { DialectTable } from '../dialect/types.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/SPEC.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-matrix', 'ru-matrix.json');

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

/** Mock environment for testing */
function mockEnv(receiveValue: string) {
  const sent: string[] = [];
  const env: Environment = {
    receive: async () => receiveValue,
    send: (body) => { sent.push(body); },
  };
  return { env, sent };
}

function parseEN(src: string) {
  return parse(tokenize(src, enIndex), enTable);
}

function parseRU(src: string) {
  return parse(tokenize(src, ruIndex), ruTable);
}

describe('executor', () => {
  it('RECEIVE + SEND + EXIT с mock environment', async () => {
    const ast = parseEN(`RECEIVE name
<<
What is your name?
>>
END

SEND
<<
Hello, $name!
>>
END

EXIT`);
    const { env, sent } = mockEnv('World');
    await execute(ast, env);
    expect(sent).toEqual(['Hello, World!']);
  });

  it('SEND с TO → NotImplementedError', async () => {
    const ast = parseEN('SEND\nTO #channel\n<< msg >>\nEND\nEXIT');
    const { env } = mockEnv('');
    await expect(execute(ast, env)).rejects.toThrow(NotImplementedError);
  });

  it('ненайденная $-ссылка → ExecutionError', async () => {
    const ast = parseEN('SEND\n<< Hello, $unknown! >>\nEND\nEXIT');
    const { env } = mockEnv('');
    await expect(execute(ast, env)).rejects.toThrow(ExecutionError);
    await expect(execute(ast, env)).rejects.toThrow('undefined variable');
  });

  it('несколько RECEIVE подряд', async () => {
    const ast = parseEN(`RECEIVE first
END
RECEIVE second
END
SEND
<< $first and $second >>
END
EXIT`);
    let callCount = 0;
    const values = ['Alice', 'Bob'];
    const sent: string[] = [];
    const env: Environment = {
      receive: async () => values[callCount++],
      send: (body) => { sent.push(body); },
    };
    await execute(ast, env);
    expect(sent).toEqual(['Alice and Bob']);
  });

  it('SEND без тела → пустая строка', async () => {
    const ast = parseEN('SEND\nEND\nEXIT');
    const { env, sent } = mockEnv('');
    await execute(ast, env);
    expect(sent).toEqual(['']);
  });

  it('EXIT прекращает исполнение', async () => {
    // After EXIT, remaining operators should not execute
    const ast = parseEN('SEND\n<< first >>\nEND\nEXIT');
    const { env, sent } = mockEnv('');
    await execute(ast, env);
    expect(sent).toEqual(['first']);
  });
});

// ─── Integration: полный пайплайн ────────────────────────

describe('integration', () => {
  it('EN: полный пайплайн — критерий готовности', async () => {
    const ast = parseEN(`RECEIVE name
<<
What is your name?
>>
END

SEND
<<
Hello, $name!
>>
END

EXIT`);
    const { env, sent } = mockEnv('World');
    await execute(ast, env);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe('Hello, World!');
  });

  it('RU: тот же скрипт на ru-matrix', async () => {
    const ast = parseRU(`ПРИМИ имя
<<
Как тебя зовут?
>>
ПРОСНИСЬ

ПЕРЕДАЙ
<<
Привет, $имя!
>>
ПРОСНИСЬ

ОТКЛЮЧИСЬ`);
    const { env, sent } = mockEnv('Мир');
    await execute(ast, env);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe('Привет, Мир!');
  });
});
