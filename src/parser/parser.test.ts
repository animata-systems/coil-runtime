import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse, ParseError } from './parser.js';
import type { DialectTable } from '../dialect/types.js';
import type { ReceiveNode, SendNode, ExitNode, UnsupportedOperatorNode, CommentNode } from '../ast/nodes.js';
import { validate } from '../validator/index.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/SPEC.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-matrix', 'ru-matrix.json');

let enTable: DialectTable;
let ruTable: DialectTable;
let enIndex: KeywordIndex;
let ruIndex: KeywordIndex;

function parseEN(src: string) {
  return parse(tokenize(src, enIndex), enTable);
}

function parseRU(src: string) {
  return parse(tokenize(src, ruIndex), ruTable);
}

beforeAll(async () => {
  enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  ruTable = await loadDialect(RU_PATH);
  ruIndex = KeywordIndex.build(ruTable);
});

// ─── RECEIVE ─────────────────────────────────────────────

describe('parseReceive', () => {
  it('RECEIVE name << prompt >> END → ReceiveNode with prompt', () => {
    const ast = parseEN('RECEIVE name\n<<\nWhat is your name?\n>>\nEND');
    expect(ast.nodes).toHaveLength(1);
    const node = ast.nodes[0] as ReceiveNode;
    expect(node.kind).toBe('Op.Receive');
    expect(node.name).toBe('name');
    expect(node.prompt).not.toBeNull();
    expect(node.prompt!.parts.length).toBeGreaterThan(0);
    expect(node.prompt!.parts[0].type).toBe('text');
  });

  it('RECEIVE name END (без шаблона) → ReceiveNode { prompt: null }', () => {
    const ast = parseEN('RECEIVE name\nEND');
    const node = ast.nodes[0] as ReceiveNode;
    expect(node.kind).toBe('Op.Receive');
    expect(node.name).toBe('name');
    expect(node.prompt).toBeNull();
  });

  it('RECEIVE без имени → ParseError', () => {
    expect(() => parseEN('RECEIVE\nEND')).toThrow(ParseError);
  });

  it('RECEIVE без END → ParseError', () => {
    expect(() => parseEN('RECEIVE name\nEXIT')).toThrow(ParseError);
  });
});

// ─── SEND ────────────────────────────────────────────────

describe('parseSend', () => {
  it('SEND << Hello >> END → анонимный SendNode', () => {
    const ast = parseEN('SEND\n<< Hello >>\nEND');
    const node = ast.nodes[0] as SendNode;
    expect(node.kind).toBe('Op.Send');
    expect(node.name).toBeNull();
    expect(node.body).not.toBeNull();
    expect(node.to).toBeNull();
    expect(node.for).toEqual([]);
    expect(node.replyTo).toBeNull();
    expect(node.await).toBeNull();
    expect(node.timeout).toBeNull();
  });

  it('SEND answer TO #ch FOR @user AWAIT ALL TIMEOUT 5m << body >> END → все поля', () => {
    const src = `SEND answer
  TO #channel
  FOR @user
  AWAIT ALL
  TIMEOUT 5m
  <<
  Hello!
  >>
END`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as SendNode;
    expect(node.kind).toBe('Op.Send');
    expect(node.name).toBe('answer');
    expect(node.to).not.toBeNull();
    expect(node.to!.segments[0]).toEqual({ kind: 'literal', value: 'channel' });
    expect(node.for).toEqual(['user']);
    expect(node.await).toBe('all');
    expect(node.timeout).not.toBeNull();
    expect(node.timeout!.value).toBe(5);
    expect(node.timeout!.unitId).toBe('Dur.Minutes');
    expect(node.body).not.toBeNull();
  });

  it('SEND с несколькими получателями FOR @a, @b', () => {
    const src = 'SEND msg\nFOR @alice, @bob\n<< hi >>\nEND';
    const ast = parseEN(src);
    const node = ast.nodes[0] as SendNode;
    expect(node.for).toEqual(['alice', 'bob']);
  });

  it('SEND << body >> TO #ch END → ошибка: модификатор после тела', () => {
    expect(() => parseEN('SEND\n<< body >>\nTO #ch\nEND')).toThrow(ParseError);
    try {
      parseEN('SEND\n<< body >>\nTO #ch\nEND');
    } catch (err) {
      expect((err as ParseError).message).toContain('after body');
    }
  });

  it('SEND с REPLY TO', () => {
    const src = 'SEND\nREPLY TO #msg_123\n<< reply >>\nEND';
    const ast = parseEN(src);
    const node = ast.nodes[0] as SendNode;
    expect(node.replyTo).not.toBeNull();
  });

  it('SEND AWAIT NONE', () => {
    const src = 'SEND\nAWAIT NONE\n<< fire and forget >>\nEND';
    const ast = parseEN(src);
    const node = ast.nodes[0] as SendNode;
    expect(node.await).toBe('none');
  });

  it('дублирование TO → ошибка', () => {
    expect(() => parseEN('SEND\nTO #a\nTO #b\n<< x >>\nEND')).toThrow(ParseError);
    expect(() => parseEN('SEND\nTO #a\nTO #b\n<< x >>\nEND')).toThrow('duplicate');
  });

  it('FOR без участника → ошибка', () => {
    expect(() => parseEN('SEND\nFOR\n<< x >>\nEND')).toThrow(ParseError);
  });
});

// ─── EXIT ────────────────────────────────────────────────

describe('parseExit', () => {
  it('EXIT → ExitNode', () => {
    const ast = parseEN('EXIT');
    expect(ast.nodes).toHaveLength(1);
    const node = ast.nodes[0] as ExitNode;
    expect(node.kind).toBe('Op.Exit');
  });

  it('EXIT с аргументом → ошибка', () => {
    // "done" tokenizes as Identifier, which is on the same line
    expect(() => parseEN('EXIT done')).toThrow(ParseError);
  });

  it('EXIT с комментарием → ok (ExitNode + CommentNode)', () => {
    const ast = parseEN("EXIT ' done");
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Op.Exit');
    expect(ast.nodes[1].kind).toBe('Comment');
  });
});

// ─── UnsupportedOperatorNode (R-0011) ────────────────────

describe('UnsupportedOperatorNode', () => {
  it('THINK analysis GOAL << ... >> END → UnsupportedOperatorNode', () => {
    const src = 'THINK analysis\nGOAL <<\nAnalyze.\n>>\nEND';
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(1);
    const node = ast.nodes[0] as UnsupportedOperatorNode;
    expect(node.kind).toBe('Unsupported');
    expect(node.operatorId).toBe('Op.Think');
  });

  it('RECEIVE + THINK + SEND + EXIT → [Receive, Unsupported, Send, Exit]', () => {
    const src = `RECEIVE name
<<
query
>>
END

THINK analysis
  GOAL <<
  Analyze query.
  >>
END

SEND
<<
Hello, $name!
>>
END

EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(4);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Unsupported');
    expect((ast.nodes[1] as UnsupportedOperatorNode).operatorId).toBe('Op.Think');
    expect(ast.nodes[2].kind).toBe('Op.Send');
    expect(ast.nodes[3].kind).toBe('Op.Exit');
  });

  it('вложенные блоки в unsupported — правильно считает depth', () => {
    const src = `REPEAT 3
  WAIT data
    ON ?something
  END
END

EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Unsupported');
    expect((ast.nodes[0] as UnsupportedOperatorNode).operatorId).toBe('Op.Repeat');
    expect(ast.nodes[1].kind).toBe('Op.Exit');
  });
});

// ─── Integration ─────────────────────────────────────────

describe('integration', () => {
  it('полный скрипт из критерия готовности → [ReceiveNode, SendNode, ExitNode]', () => {
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
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(3);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Op.Send');
    expect(ast.nodes[2].kind).toBe('Op.Exit');
    expect(ast.dialect).toBe('en-standard');

    // Check the Send body contains ValueRef
    const send = ast.nodes[1] as SendNode;
    expect(send.body).not.toBeNull();
    const refs = send.body!.parts.filter(p => p.type === 'ref');
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('name');
  });

  it('RU-диалект: ПРИМИ запрос << ... >> ПРОСНИСЬ → тот же AST', () => {
    const src = `ПРИМИ запрос
<<
Как тебя зовут?
>>
ПРОСНИСЬ

ПЕРЕДАЙ
<<
Привет, $запрос!
>>
ПРОСНИСЬ

ОТКЛЮЧИСЬ`;
    const ast = parseRU(src);
    expect(ast.nodes).toHaveLength(3);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Op.Send');
    expect(ast.nodes[2].kind).toBe('Op.Exit');
    expect(ast.dialect).toBe('ru-matrix');

    // Dialect-neutral AST: same structure as EN
    const receive = ast.nodes[0] as ReceiveNode;
    expect(receive.name).toBe('запрос');
  });
});

// ─── CommentNode ──────────────────────────────────────────

describe('CommentNode', () => {
  it('comment between operators → CommentNode in AST', () => {
    const src = `RECEIVE name
END
' section header
SEND
<< hi >>
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(4);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Comment');
    const comment = ast.nodes[1] as CommentNode;
    expect(comment.text).toBe('section header');
    expect(ast.nodes[2].kind).toBe('Op.Send');
    expect(ast.nodes[3].kind).toBe('Op.Exit');
  });

  it('comment after EXIT → no unreachable-after-exit warning', () => {
    const src = `RECEIVE name
END
EXIT
' trailing comment`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(3);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Op.Exit');
    expect(ast.nodes[2].kind).toBe('Comment');

    const result = validate(ast);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('multiple consecutive comments', () => {
    const src = `' line 1
' line 2
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(3);
    expect(ast.nodes[0].kind).toBe('Comment');
    expect(ast.nodes[1].kind).toBe('Comment');
    expect(ast.nodes[2].kind).toBe('Op.Exit');
  });

  it('comment inside block (RECEIVE) is NOT preserved as CommentNode', () => {
    const src = `RECEIVE name
' inside block
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Op.Receive');
    expect(ast.nodes[1].kind).toBe('Op.Exit');
  });

  it('comment inside unsupported block (THINK) is NOT preserved as CommentNode', () => {
    const src = `THINK analysis
' comment inside unparsed block
GOAL <<
Analyze.
>>
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Unsupported');
    expect(ast.nodes[1].kind).toBe('Op.Exit');
  });

  it('comment inside SEND block is NOT preserved as CommentNode', () => {
    const src = `SEND
' inside send
<< hello >>
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Op.Send');
    expect(ast.nodes[1].kind).toBe('Op.Exit');
  });

  it('exit-required still works when last node is Comment', () => {
    const src = `RECEIVE name
END
' only a comment at the end`;
    const ast = parseEN(src);
    const result = validate(ast);
    const exitRequired = result.diagnostics.find(d => d.ruleId === 'exit-required');
    expect(exitRequired).toBeDefined();
  });
});
