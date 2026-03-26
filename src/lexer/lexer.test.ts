import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tokenize, LexerError } from './tokenizer.js';
import { loadDialect } from '../dialect/loader.js';
import { KeywordIndex } from '../dialect/index.js';
import type { Token } from './tokens.js';

const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/SPEC.md'));
const TESTS_DIR = join(dirname(require.resolve('coil/package.json')), 'tests');
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-matrix', 'ru-matrix.json');

let enIndex: KeywordIndex;
let ruIndex: KeywordIndex;

/** Helper: strip Newline, Comment, EOF for cleaner assertions */
function significant(tokens: Token[]): Token[] {
  return tokens.filter(t => t.type !== 'Newline' && t.type !== 'Comment' && t.type !== 'EOF');
}

beforeAll(async () => {
  const enTable = await loadDialect(EN_PATH);
  enIndex = KeywordIndex.build(enTable);
  const ruTable = await loadDialect(RU_PATH);
  ruIndex = KeywordIndex.build(ruTable);
});

// ─── Basic keyword recognition ──────────────────────────

describe('keywords', () => {
  it('EN: RECEIVE name → [Keyword(Op.Receive), Identifier(name)]', () => {
    const tokens = significant(tokenize('RECEIVE name', enIndex));
    expect(tokens).toHaveLength(2);
    expect(tokens[0].type).toBe('Keyword');
    expect((tokens[0] as any).ids).toContain('Op.Receive');
    expect(tokens[1].type).toBe('Identifier');
    expect((tokens[1] as any).name).toBe('name');
  });

  it('RU: ПРИМИ запрос → [Keyword(Op.Receive), Identifier(запрос)]', () => {
    const tokens = significant(tokenize('ПРИМИ запрос', ruIndex));
    expect(tokens).toHaveLength(2);
    expect(tokens[0].type).toBe('Keyword');
    expect((tokens[0] as any).ids).toContain('Op.Receive');
    expect(tokens[1].type).toBe('Identifier');
    expect((tokens[1] as any).name).toBe('запрос');
  });

  it('EN: EXIT → [Keyword(Op.Exit)]', () => {
    const tokens = significant(tokenize('EXIT', enIndex));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('Keyword');
    expect((tokens[0] as any).ids).toContain('Op.Exit');
  });

  it('EN: END → [Keyword(Kw.End)]', () => {
    const tokens = significant(tokenize('END', enIndex));
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as any).ids).toContain('Kw.End');
  });
});

// ─── Multi-word phrases ─────────────────────────────────

describe('multi-word phrases', () => {
  it('EN: REPLY TO #support/1234 → [Keyword(Mod.ReplyTo), ChannelRef]', () => {
    const tokens = significant(tokenize('REPLY TO #support/1234', enIndex));
    expect(tokens).toHaveLength(2);
    expect((tokens[0] as any).ids).toContain('Mod.ReplyTo');
    expect(tokens[1].type).toBe('ChannelRef');
    const ch = tokens[1] as any;
    expect(ch.segments).toHaveLength(2);
    expect(ch.segments[0]).toEqual({ kind: 'literal', value: 'support' });
    expect(ch.segments[1]).toEqual({ kind: 'literal', value: '1234' });
  });

  it('RU: НЕ БОЛЕЕ 10м → [Keyword(Mod.Limit), DurationLiteral(10, Dur.Minutes)]', () => {
    const tokens = significant(tokenize('НЕ БОЛЕЕ 10м', ruIndex));
    expect(tokens).toHaveLength(2);
    expect((tokens[0] as any).ids).toContain('Mod.Limit');
    expect(tokens[1].type).toBe('DurationLiteral');
    expect((tokens[1] as any).value).toBe(10);
    expect((tokens[1] as any).unitId).toBe('Dur.Minutes');
  });

  it('EN: NO MORE THAN 5 → [Keyword(Mod.Limit), Identifier(5)]', () => {
    const tokens = significant(tokenize('NO MORE THAN 5', enIndex));
    expect(tokens).toHaveLength(2);
    expect((tokens[0] as any).ids).toContain('Mod.Limit');
  });

  it('RU: БЕЛЫЙ КРОЛИК << ... >> → [Keyword(Mod.Goal), TemplateOpen, ...]', () => {
    const tokens = significant(tokenize('БЕЛЫЙ КРОЛИК <<\nцель\n>>', ruIndex));
    expect(tokens[0].type).toBe('Keyword');
    expect((tokens[0] as any).ids).toContain('Mod.Goal');
    expect(tokens[1].type).toBe('TemplateOpen');
  });
});

// ─── Templates ──────────────────────────────────────────

describe('templates', () => {
  it('<< Hello, $name! >> → [TemplateOpen, TextFragment, ValueRef, TextFragment, TemplateClose]', () => {
    const tokens = significant(tokenize('<< Hello, $name! >>', enIndex));
    expect(tokens.map(t => t.type)).toEqual([
      'TemplateOpen', 'TextFragment', 'ValueRef', 'TextFragment', 'TemplateClose',
    ]);
    expect((tokens[1] as any).value).toBe(' Hello, ');
    expect((tokens[2] as any).name).toBe('name');
    expect((tokens[3] as any).value).toBe('! ');
  });

  it('<< Simple text >> → [TemplateOpen, TextFragment, TemplateClose]', () => {
    const tokens = significant(tokenize('<< Simple text >>', enIndex));
    expect(tokens.map(t => t.type)).toEqual([
      'TemplateOpen', 'TextFragment', 'TemplateClose',
    ]);
    expect((tokens[1] as any).value).toBe(' Simple text ');
  });

  it('multiline template with $-ref', () => {
    const src = '<<\nHello, $name!\nGoodbye.\n>>';
    const tokens = significant(tokenize(src, enIndex));
    expect(tokens[0].type).toBe('TemplateOpen');
    // Should have TextFragment, ValueRef, TextFragment pattern
    const types = tokens.map(t => t.type);
    expect(types).toContain('ValueRef');
    expect(types[types.length - 1]).toBe('TemplateClose');
  });

  it('$name.field inside template', () => {
    const tokens = significant(tokenize('<< $analysis.summary >>', enIndex));
    const ref = tokens.find(t => t.type === 'ValueRef') as any;
    expect(ref).toBeTruthy();
    expect(ref.name).toBe('analysis');
    expect(ref.path).toEqual(['summary']);
  });

  it('unterminated template → LexerError', () => {
    expect(() => tokenize('<< no close', enIndex)).toThrow(LexerError);
  });
});

// ─── Sigil references ───────────────────────────────────

describe('sigil references', () => {
  it('$name → ValueRef', () => {
    const tokens = significant(tokenize('$request', enIndex));
    expect(tokens[0].type).toBe('ValueRef');
    expect((tokens[0] as any).name).toBe('request');
    expect((tokens[0] as any).path).toEqual([]);
  });

  it('$name.field.subfield → ValueRef with path', () => {
    const tokens = significant(tokenize('$plan.summary.text', enIndex));
    expect(tokens[0].type).toBe('ValueRef');
    expect((tokens[0] as any).name).toBe('plan');
    expect((tokens[0] as any).path).toEqual(['summary', 'text']);
  });

  it('@name → ParticipantRef', () => {
    const tokens = significant(tokenize('@expert', enIndex));
    expect(tokens[0].type).toBe('ParticipantRef');
    expect((tokens[0] as any).name).toBe('expert');
  });

  it('#name → ChannelRef', () => {
    const tokens = significant(tokenize('#support', enIndex));
    expect(tokens[0].type).toBe('ChannelRef');
    expect((tokens[0] as any).segments).toEqual([{ kind: 'literal', value: 'support' }]);
  });

  it('#name/path → ChannelRef with segments', () => {
    const tokens = significant(tokenize('#results/1234', enIndex));
    const ch = tokens[0] as any;
    expect(ch.segments).toHaveLength(2);
    expect(ch.segments[0]).toEqual({ kind: 'literal', value: 'results' });
    expect(ch.segments[1]).toEqual({ kind: 'literal', value: '1234' });
  });

  it('#$dynamic → ChannelRef (dynamic)', () => {
    const tokens = significant(tokenize('#$route', enIndex));
    const ch = tokens[0] as any;
    expect(ch.segments).toHaveLength(1);
    expect(ch.segments[0]).toEqual({ kind: 'dynamic', name: 'route', path: [] });
  });

  it('#results/$case_id → ChannelRef (mixed)', () => {
    const tokens = significant(tokenize('#results/$case_id', enIndex));
    const ch = tokens[0] as any;
    expect(ch.segments).toHaveLength(2);
    expect(ch.segments[0]).toEqual({ kind: 'literal', value: 'results' });
    expect(ch.segments[1]).toEqual({ kind: 'dynamic', name: 'case_id', path: [] });
  });

  it('#$obj.field → ChannelRef (dynamic with path)', () => {
    const tokens = significant(tokenize('#$маршрут.канал', enIndex));
    const ch = tokens[0] as any;
    expect(ch.segments[0]).toEqual({ kind: 'dynamic', name: 'маршрут', path: ['канал'] });
  });

  it('?name → PromiseRef', () => {
    const tokens = significant(tokenize('?plan', enIndex));
    expect(tokens[0].type).toBe('PromiseRef');
    expect((tokens[0] as any).name).toBe('plan');
  });

  it('!name → ToolRef', () => {
    const tokens = significant(tokenize('!search', enIndex));
    expect(tokens[0].type).toBe('ToolRef');
    expect((tokens[0] as any).name).toBe('search');
  });

  it('~name → StreamRef', () => {
    const tokens = significant(tokenize('~analysis', enIndex));
    expect(tokens[0].type).toBe('StreamRef');
    expect((tokens[0] as any).name).toBe('analysis');
  });
});

// ─── Duration literals ──────────────────────────────────

describe('duration literals', () => {
  it('EN: 30s → DurationLiteral(30, Dur.Seconds)', () => {
    const tokens = significant(tokenize('30s', enIndex));
    expect(tokens[0].type).toBe('DurationLiteral');
    expect((tokens[0] as any).value).toBe(30);
    expect((tokens[0] as any).unitId).toBe('Dur.Seconds');
  });

  it('EN: 5m → DurationLiteral(5, Dur.Minutes)', () => {
    const tokens = significant(tokenize('5m', enIndex));
    expect((tokens[0] as any).value).toBe(5);
    expect((tokens[0] as any).unitId).toBe('Dur.Minutes');
  });

  it('RU: 2ч → DurationLiteral(2, Dur.Hours)', () => {
    const tokens = significant(tokenize('2ч', ruIndex));
    expect((tokens[0] as any).value).toBe(2);
    expect((tokens[0] as any).unitId).toBe('Dur.Hours');
  });

  it('plain number without suffix → NumberLiteral (D-006-7)', () => {
    const tokens = significant(tokenize('5', enIndex));
    expect(tokens[0].type).toBe('NumberLiteral');
    expect((tokens[0] as any).value).toBe(5);
  });
});

// ─── Comments ───────────────────────────────────────────

describe('comments', () => {
  it("' comment → Comment token", () => {
    const all = tokenize("' this is a comment", enIndex);
    const comments = all.filter(t => t.type === 'Comment');
    expect(comments).toHaveLength(1);
    expect((comments[0] as any).text).toBe('this is a comment');
  });

  it('comment after code', () => {
    const all = tokenize("EXIT ' done", enIndex);
    expect(all.some(t => t.type === 'Keyword')).toBe(true);
    expect(all.some(t => t.type === 'Comment')).toBe(true);
  });
});

// ─── Inline lists ───────────────────────────────────────

describe('inline lists', () => {
  it('ACTORS a, b, c → [Keyword, Identifier, Comma, Identifier, Comma, Identifier]', () => {
    const tokens = significant(tokenize('ACTORS a, b, c', enIndex));
    expect(tokens.map(t => t.type)).toEqual([
      'Keyword', 'Identifier', 'Comma', 'Identifier', 'Comma', 'Identifier',
    ]);
    expect((tokens[0] as any).ids).toContain('Op.Actors');
  });
});

// ─── SourceSpan ─────────────────────────────────────────

describe('SourceSpan', () => {
  it('tokens have correct offset and length', () => {
    const tokens = tokenize('RECEIVE name', enIndex);
    const kw = tokens[0];
    expect(kw.span.offset).toBe(0);
    expect(kw.span.length).toBe(7); // "RECEIVE"
    const id = tokens.find(t => t.type === 'Identifier')!;
    expect(id.span.offset).toBe(8);
    expect(id.span.length).toBe(4); // "name"
  });

  it('line/col tracking across lines', () => {
    const tokens = tokenize('RECEIVE name\nEXIT', enIndex);
    const exit = tokens.find(t => t.type === 'Keyword' && (t as any).ids.includes('Op.Exit'))!;
    expect(exit.span.line).toBe(2);
    expect(exit.span.col).toBe(1);
  });
});

// ─── Error handling ─────────────────────────────────────

describe('errors', () => {
  it('unexpected character → LexerError with SourceSpan', () => {
    try {
      tokenize('RECEIVE name\n`bad', enIndex);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LexerError);
      expect((err as LexerError).span).toBeTruthy();
    }
  });

  it('$ alone → LexerError', () => {
    expect(() => tokenize('$ alone', enIndex)).toThrow(LexerError);
  });
});

// ─── Integration: full acceptance script ────────────────

describe('integration', () => {
  it('полный скрипт из критерия готовности — токенизация без ошибок (EN)', () => {
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
    const tokens = tokenize(src, enIndex);
    expect(tokens.some(t => t.type === 'EOF')).toBe(true);

    const sig = significant(tokens);
    const types = sig.map(t => t.type);
    // RECEIVE name << ... >> END SEND << ... >> END EXIT
    expect(types).toContain('Keyword');
    expect(types).toContain('TemplateOpen');
    expect(types).toContain('TextFragment');
    expect(types).toContain('ValueRef');
    expect(types).toContain('TemplateClose');
  });

  it('RU: полный скрипт — токенизация без ошибок', () => {
    const src = `ПРИМИ имя
<<
Как тебя зовут?
>>
ПРОСНИСЬ

ПЕРЕДАЙ
<<
Привет, $имя!
>>
ПРОСНИСЬ

ОТКЛЮЧИСЬ`;
    const tokens = tokenize(src, ruIndex);
    expect(tokens.some(t => t.type === 'EOF')).toBe(true);
    const keywords = tokens.filter(t => t.type === 'Keyword');
    expect(keywords.map((k: any) => k.ids[0])).toEqual([
      'Op.Receive', 'Kw.End', 'Op.Send', 'Kw.End', 'Op.Exit',
    ]);
  });

  it('tests/valid/core/receive-with-prompt.coil — токенизация', async () => {
    const src = await readFile(join(TESTS_DIR, 'valid', 'core', 'receive-with-prompt.coil'), 'utf-8');
    const tokens = tokenize(src, enIndex);
    expect(tokens.some(t => t.type === 'EOF')).toBe(true);
  });

  it('tests/valid/core/send-fire-and-forget.coil — все модификаторы распознаны', async () => {
    const src = await readFile(join(TESTS_DIR, 'valid', 'core', 'send-fire-and-forget.coil'), 'utf-8');
    const tokens = tokenize(src, enIndex);
    expect(tokens.some(t => t.type === 'EOF')).toBe(true);
  });
});
