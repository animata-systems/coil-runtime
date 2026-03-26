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
  ActorsNode, ToolsNode, DefineNode, SetNode, ThinkNode,
  ExecuteNode, WaitNode, SignalNode,
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

// ─── THINK ──────────────────────────────────────────────

describe('parseThink', () => {
  it('minimal THINK: GOAL + RESULT', () => {
    const src = `THINK verdict
  GOAL <<
  Classify the request.
  >>
  RESULT
  * category: CHOICE(bug, feature, question) - request type
END`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as ThinkNode;
    expect(node.kind).toBe('Op.Think');
    expect(node.name).toBe('verdict');
    expect(node.goal).not.toBeNull();
    expect(node.result).toHaveLength(1);
    expect(node.result[0].name).toBe('category');
    expect(node.result[0].typeId).toBe('Typ.Choice');
    expect(node.result[0].typeArgs).toEqual(['bug', 'feature', 'question']);
    expect(node.result[0].description).toBe('request type');
    // Unused fields are null/empty
    expect(node.via).toBeNull();
    expect(node.as).toEqual([]);
    expect(node.using).toEqual([]);
    expect(node.input).toBeNull();
    expect(node.context).toBeNull();
    expect(node.body).toBeNull();
  });

  it('full THINK: VIA, AS, USING, GOAL, INPUT, CONTEXT, RESULT', () => {
    const src = `DEFINE model
"gpt-4"
END

DEFINE analyst_skill
<<
You are a senior data analyst.
>>
END

TOOLS search

THINK plan
  VIA $model
  AS $analyst_skill
  USING !search
  GOAL <<
  Identify artifacts that need changes.
  >>
  INPUT <<
  User request: $query
  >>
  CONTEXT <<
  Previous history: $history
  >>
  RESULT
  * summary: TEXT - brief overview
  * artifacts: LIST - artifacts requiring changes
    * path: TEXT - artifact path
    * action: CHOICE(create, modify, delete) - change type
    * reason: TEXT - why the change is needed
END

EXIT`;
    const ast = parseEN(src);
    // Find ThinkNode
    const think = ast.nodes.find(n => n.kind === 'Op.Think') as ThinkNode;
    expect(think.name).toBe('plan');
    expect(think.via).not.toBeNull();
    expect(think.via!.name).toBe('model');
    expect(think.as).toHaveLength(1);
    expect(think.as[0].name).toBe('analyst_skill');
    expect(think.using).toHaveLength(1);
    expect(think.using[0].name).toBe('search');
    expect(think.goal).not.toBeNull();
    expect(think.input).not.toBeNull();
    expect(think.context).not.toBeNull();
    // RESULT: 2 top-level + 3 nested
    expect(think.result).toHaveLength(5);
    expect(think.result[0]).toMatchObject({ name: 'summary', typeId: 'Typ.Text', depth: 0 });
    expect(think.result[1]).toMatchObject({ name: 'artifacts', typeId: 'Typ.List', depth: 0 });
    expect(think.result[2]).toMatchObject({ name: 'path', typeId: 'Typ.Text', depth: 1 });
    expect(think.result[3]).toMatchObject({ name: 'action', typeId: 'Typ.Choice', depth: 1 });
    expect(think.result[4]).toMatchObject({ name: 'reason', typeId: 'Typ.Text', depth: 1 });
    expect(think.body).toBeNull();
  });

  it('THINK with anonymous body (no named formulation modifiers)', () => {
    const src = `THINK answer
  <<
  Summarize the document: $doc
  >>
END`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as ThinkNode;
    expect(node.body).not.toBeNull();
    expect(node.body!.type).toBe('template');
    expect(node.goal).toBeNull();
    expect(node.result).toEqual([]);
  });

  it('THINK USING !tools — multiple tools', () => {
    const src = `TOOLS search, calculator

THINK analysis
  USING !search, !calculator
  GOAL <<
  Research and calculate.
  >>
  RESULT
  * findings: TEXT - research findings
  * metric: NUMBER - calculated metric
END

EXIT`;
    const ast = parseEN(src);
    const think = ast.nodes.find(n => n.kind === 'Op.Think') as ThinkNode;
    expect(think.using).toHaveLength(2);
    expect(think.using[0].name).toBe('search');
    expect(think.using[1].name).toBe('calculator');
  });

  it('RESULT with TEXT type', () => {
    const src = `THINK s\n  GOAL << x >>\n  RESULT\n  * summary: TEXT - doc summary\nEND`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as ThinkNode;
    expect(node.result[0].typeId).toBe('Typ.Text');
  });

  it('RESULT with NUMBER type', () => {
    const src = `THINK s\n  GOAL << x >>\n  RESULT\n  * score: NUMBER - quality\nEND`;
    const ast = parseEN(src);
    expect((ast.nodes[0] as ThinkNode).result[0].typeId).toBe('Typ.Number');
  });

  it('RESULT with FLAG type', () => {
    const src = `THINK s\n  GOAL << x >>\n  RESULT\n  * ok: FLAG - is valid\nEND`;
    const ast = parseEN(src);
    expect((ast.nodes[0] as ThinkNode).result[0].typeId).toBe('Typ.Flag');
  });

  it('RESULT with CHOICE — options parsed', () => {
    const src = `THINK t\n  GOAL << x >>\n  RESULT\n  * sev: CHOICE(critical, high, low) - level\nEND`;
    const ast = parseEN(src);
    const f = (ast.nodes[0] as ThinkNode).result[0];
    expect(f.typeId).toBe('Typ.Choice');
    expect(f.typeArgs).toEqual(['critical', 'high', 'low']);
  });

  it('RESULT with LIST — nested fields have depth > 0', () => {
    const src = `THINK plan
  GOAL << plan >>
  RESULT
  * summary: TEXT - overview
  * steps: LIST - steps
    * desc: TEXT - step description
    * effort: CHOICE(small, medium, large) - effort
END`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as ThinkNode;
    expect(node.result).toHaveLength(4);
    expect(node.result[0]).toMatchObject({ name: 'summary', depth: 0 });
    expect(node.result[1]).toMatchObject({ name: 'steps', typeId: 'Typ.List', depth: 0 });
    expect(node.result[2]).toMatchObject({ name: 'desc', depth: 1 });
    expect(node.result[3]).toMatchObject({ name: 'effort', depth: 1 });
  });

  it('THINK with RESULT + anonymous body (D-0032)', () => {
    const src = `THINK verdict
  RESULT
  * category: CHOICE(bug, feature, question) - type
  <<
  Classify this request: $request
  >>
END`;
    const ast = parseEN(src);
    const node = ast.nodes[0] as ThinkNode;
    expect(node.result).toHaveLength(1);
    expect(node.result[0].typeId).toBe('Typ.Choice');
    expect(node.body).not.toBeNull();
    expect(node.body!.type).toBe('template');
  });

  it('error: GOAL (formulation) before AS (rigging)', () => {
    const src = `DEFINE role\n<< analyst >>\nEND\nTHINK plan\n  GOAL <<\n  Find problem.\n  >>\n  AS $role\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/rigging.*after formulation/);
  });

  it('error: modifier after RESULT', () => {
    const src = `THINK analysis\n  RESULT\n  * summary: TEXT\n  CONTEXT <<\n  Additional data.\n  >>\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/after RESULT/);
  });

  it('error: duplicate modifier', () => {
    const src = `THINK x\n  GOAL << a >>\n  GOAL << b >>\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/duplicate/);
  });

  it('error: duplicate anonymous body', () => {
    const src = `THINK x\n  << first >>\n  << second >>\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/duplicate.*body/);
  });
});

// ─── EXECUTE ─────────────────────────────────────────────

describe('parseExecute', () => {
  it('EXECUTE with USING and arguments', () => {
    const src = `TOOLS load_article

EXECUTE article
  USING !load_article
  - url: $url
  - format: "markdown"
END

EXIT`;
    const ast = parseEN(src);
    const exec = ast.nodes.find(n => n.kind === 'Op.Execute') as ExecuteNode;
    expect(exec.name).toBe('article');
    expect(exec.tool.name).toBe('load_article');
    expect(exec.args).toHaveLength(2);
    expect(exec.args[0].key).toBe('url');
    expect(exec.args[0].value.type).toBe('ref');
    expect(exec.args[1].key).toBe('format');
    expect(exec.args[1].value.type).toBe('string');
    expect((exec.args[1].value as any).value).toBe('markdown');
  });

  it('EXECUTE with template body → ParseError', () => {
    const src = `TOOLS search\nEXECUTE results\n  USING !search\n  <<\n  Search.\n  >>\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/template.*not allowed.*EXECUTE/);
  });

  it('RU: ВЗЛОМАЙ с аргументами', () => {
    const src = `АРСЕНАЛ поиск

ВЗЛОМАЙ результат
  ВООРУЖИВШИСЬ !поиск
  - запрос: $запрос
ПРОСНИСЬ

ОТКЛЮЧИСЬ`;
    const ast = parseRU(src);
    const exec = ast.nodes.find(n => n.kind === 'Op.Execute') as ExecuteNode;
    expect(exec.name).toBe('результат');
    expect(exec.tool.name).toBe('поиск');
    expect(exec.args).toHaveLength(1);
    expect(exec.args[0].key).toBe('запрос');
  });
});

// ─── WAIT ────────────────────────────────────────────────

describe('parseWait', () => {
  it('WAIT single promise', () => {
    const src = `THINK plan\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND\nWAIT\n  ON ?plan\nEND\nEXIT`;
    const ast = parseEN(src);
    const wait = ast.nodes.find(n => n.kind === 'Op.Wait') as WaitNode;
    expect(wait.on).toHaveLength(1);
    expect(wait.on[0].name).toBe('plan');
    expect(wait.mode).toBeNull();
    expect(wait.timeout).toBeNull();
  });

  it('WAIT multiple promises with MODE ALL', () => {
    const src = `THINK a\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND
THINK b\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND
WAIT\n  ON ?a, ?b\n  MODE ALL\nEND\nEXIT`;
    const ast = parseEN(src);
    const wait = ast.nodes.find(n => n.kind === 'Op.Wait') as WaitNode;
    expect(wait.on).toHaveLength(2);
    expect(wait.on[0].name).toBe('a');
    expect(wait.on[1].name).toBe('b');
    expect(wait.mode).toBe('all');
  });

  it('WAIT with MODE ANY', () => {
    const src = `THINK a\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND
THINK b\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND
WAIT\n  ON ?a, ?b\n  MODE ANY\nEND\nEXIT`;
    const ast = parseEN(src);
    const wait = ast.nodes.find(n => n.kind === 'Op.Wait') as WaitNode;
    expect(wait.mode).toBe('any');
  });

  it('WAIT with TIMEOUT', () => {
    const src = `THINK x\n  GOAL << x >>\n  RESULT\n  * s: TEXT\nEND\nWAIT\n  ON ?x\n  TIMEOUT 5m\nEND\nEXIT`;
    const ast = parseEN(src);
    const wait = ast.nodes.find(n => n.kind === 'Op.Wait') as WaitNode;
    expect(wait.timeout).not.toBeNull();
    expect(wait.timeout!.value).toBe(5);
    expect(wait.timeout!.unitId).toBe('Dur.Minutes');
  });

  it('WAIT ON $value → ParseError (R-0020)', () => {
    const src = `DEFINE data\n"hello"\nEND\nWAIT\n  ON $data\nEND`;
    expect(() => parseEN(src)).toThrow(ParseError);
    expect(() => parseEN(src)).toThrow(/PromiseRef/);
  });

  it('RU: ЗАМРИ с ПОКА НЕ СБУДЕТСЯ', () => {
    const src = `ПРОЗРЕЙ план\n  БЕЛЫЙ КРОЛИК << x >>\n  ПРОРОЧЕСТВО\n  * s: КОД\nПРОСНИСЬ\nЗАМРИ\n  ПОКА НЕ СБУДЕТСЯ ?план\nПРОСНИСЬ\nОТКЛЮЧИСЬ`;
    const ast = parseRU(src);
    const wait = ast.nodes.find(n => n.kind === 'Op.Wait') as WaitNode;
    expect(wait.on).toHaveLength(1);
    expect(wait.on[0].name).toBe('план');
  });
});

// ─── SIGNAL ──────────────────────────────────────────────

describe('parseSignal', () => {
  it('SIGNAL with target and template body', () => {
    const src = `SIGNAL ~analysis\n  <<\n  Additional data: $results\n  >>\nEND\nEXIT`;
    const ast = parseEN(src);
    const sig = ast.nodes[0] as SignalNode;
    expect(sig.kind).toBe('Op.Signal');
    expect(sig.target.name).toBe('analysis');
    expect(sig.body.type).toBe('template');
    expect(sig.body.parts.some(p => p.type === 'ref')).toBe(true);
  });

  it('RU: ГЛИТЧ', () => {
    const src = `ГЛИТЧ ~решение\n  <<\n  Новые данные: $данные\n  >>\nПРОСНИСЬ\nОТКЛЮЧИСЬ`;
    const ast = parseRU(src);
    const sig = ast.nodes[0] as SignalNode;
    expect(sig.kind).toBe('Op.Signal');
    expect(sig.target.name).toBe('решение');
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
