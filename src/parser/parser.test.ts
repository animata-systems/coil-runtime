import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tokenize } from '../lexer/index.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import { parse, ParseError } from './parser.js';
import type { DialectTable } from '../dialect/types.js';
import type {
  ReceiveNode, SendNode, ExitNode, UnsupportedOperatorNode, CommentNode,
  ActorsNode, ToolsNode, DefineNode, SetNode,
} from '../ast/nodes.js';
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
  return parse(tokenize(src, enIndex), enTable, src);
}

function parseRU(src: string) {
  return parse(tokenize(src, ruIndex), ruTable, src);
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

// ─── ACTORS / TOOLS ─────────────────────────────────────

describe('parseActors', () => {
  it('ACTORS inline: ACTORS a, b → ActorsNode { names: [a, b] }', () => {
    const ast = parseEN('ACTORS analyst, reviewer\nEXIT');
    expect(ast.nodes[0].kind).toBe('Op.Actors');
    const node = ast.nodes[0] as ActorsNode;
    expect(node.names).toEqual(['analyst', 'reviewer']);
  });

  it('ACTORS block form', () => {
    const src = `ACTORS
  analyst
  reviewer
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes[0].kind).toBe('Op.Actors');
    const node = ast.nodes[0] as ActorsNode;
    expect(node.names).toEqual(['analyst', 'reviewer']);
  });

  it('RU: ЭКИПАЖ inline', () => {
    const ast = parseRU('ЭКИПАЖ аналитик, рецензент\nОТКЛЮЧИСЬ');
    expect(ast.nodes[0].kind).toBe('Op.Actors');
    const node = ast.nodes[0] as ActorsNode;
    expect(node.names).toEqual(['аналитик', 'рецензент']);
  });
});

describe('parseTools', () => {
  it('TOOLS inline: TOOLS search, calc → ToolsNode', () => {
    const ast = parseEN('TOOLS search, calc\nEXIT');
    expect(ast.nodes[0].kind).toBe('Op.Tools');
    const node = ast.nodes[0] as ToolsNode;
    expect(node.names).toEqual(['search', 'calc']);
  });

  it('TOOLS block form', () => {
    const src = `TOOLS
  search
  calc
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes[0].kind).toBe('Op.Tools');
    const node = ast.nodes[0] as ToolsNode;
    expect(node.names).toEqual(['search', 'calc']);
  });

  it('RU: АРСЕНАЛ block', () => {
    const src = `АРСЕНАЛ
  загрузить_статью
  открыть_чат
ПРОСНИСЬ
ОТКЛЮЧИСЬ`;
    const ast = parseRU(src);
    expect(ast.nodes[0].kind).toBe('Op.Tools');
    const node = ast.nodes[0] as ToolsNode;
    expect(node.names).toEqual(['загрузить_статью', 'открыть_чат']);
  });
});

// ─── DEFINE / SET ───────────────────────────────────────

describe('parseDefine', () => {
  it('DEFINE with number literal', () => {
    const ast = parseEN('DEFINE max_retries\n3\nEND\nEXIT');
    expect(ast.nodes[0].kind).toBe('Op.Define');
    const node = ast.nodes[0] as DefineNode;
    expect(node.name).toBe('max_retries');
    expect(node.body.type).toBe('number');
    expect((node.body as any).value).toBe(3);
  });

  it('DEFINE with string literal', () => {
    const ast = parseEN('DEFINE model\n"gpt-4"\nEND\nEXIT');
    expect(ast.nodes[0].kind).toBe('Op.Define');
    const node = ast.nodes[0] as DefineNode;
    expect(node.name).toBe('model');
    expect(node.body.type).toBe('string');
    expect((node.body as any).value).toBe('gpt-4');
  });

  it('DEFINE with template', () => {
    const src = `DEFINE role
<<
You are an analyst.
>>
END
EXIT`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as DefineNode;
    expect(node.body.type).toBe('template');
  });

  it('DEFINE with $ref (aliasing)', () => {
    const src = 'DEFINE current_role\n$general_role\nEND\nEXIT';
    const ast = parseEN(src);
    const node = ast.nodes[0] as DefineNode;
    expect(node.body.type).toBe('ref');
    expect((node.body as any).name).toBe('general_role');
  });

  it('RU: ЗАГРУЗИ с числом', () => {
    const ast = parseRU('ЗАГРУЗИ попытки\n3\nПРОСНИСЬ\nОТКЛЮЧИСЬ');
    expect(ast.nodes[0].kind).toBe('Op.Define');
    const node = ast.nodes[0] as DefineNode;
    expect(node.name).toBe('попытки');
    expect(node.body.type).toBe('number');
  });
});

describe('parseSet', () => {
  it('SET with number literal', () => {
    const ast = parseEN('SET $counter\n1\nEND\nEXIT');
    expect(ast.nodes[0].kind).toBe('Op.Set');
    const node = ast.nodes[0] as SetNode;
    expect(node.target.name).toBe('counter');
    expect(node.body.type).toBe('number');
    expect((node.body as any).value).toBe(1);
  });

  it('SET with $ref.field', () => {
    const ast = parseEN('SET $current\n$improved.text\nEND\nEXIT');
    const node = ast.nodes[0] as SetNode;
    expect(node.target.name).toBe('current');
    expect(node.body.type).toBe('ref');
    expect((node.body as any).name).toBe('improved');
    expect((node.body as any).path).toEqual(['text']);
  });

  it('RU: ПЕРЕПИШИ', () => {
    const ast = parseRU('ПЕРЕПИШИ $счётчик\n0\nПРОСНИСЬ\nОТКЛЮЧИСЬ');
    expect(ast.nodes[0].kind).toBe('Op.Set');
    const node = ast.nodes[0] as SetNode;
    expect(node.target.name).toBe('счётчик');
  });
});

// ─── UnsupportedOperatorNode (R-0011) ────────────────────

describe('UnsupportedOperatorNode', () => {
  it('THINK analysis GOAL << ... >> END → ThinkNode (no longer unsupported)', () => {
    const src = 'THINK analysis\nGOAL <<\nAnalyze.\n>>\nEND';
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(1);
    expect(ast.nodes[0].kind).toBe('Op.Think');
  });

  it('RECEIVE + THINK + SEND + EXIT → [Receive, Think, Send, Exit]', () => {
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
    expect(ast.nodes[1].kind).toBe('Op.Think');
    expect(ast.nodes[2].kind).toBe('Op.Send');
    expect(ast.nodes[3].kind).toBe('Op.Exit');
  });

  it('REPEAT содержит вложенный WAIT → RepeatNode с body', () => {
    const src = `REPEAT 3
  WAIT
    ON ?something
  END
END

EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Op.Repeat');
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

  it('comment inside THINK block is NOT preserved as CommentNode (skipTrivia)', () => {
    const src = `THINK analysis
' comment inside think block
GOAL <<
Analyze.
>>
END
EXIT`;
    const ast = parseEN(src);
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].kind).toBe('Op.Think');
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
