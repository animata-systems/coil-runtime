import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { loadDialect, DialectLoadError } from './loader.js';
import { KeywordIndex } from './keyword-index.js';
import { ALL_OP_IDS, ALL_KW_IDS, ALL_MOD_IDS, ALL_POL_IDS, ALL_TYP_IDS, ALL_DUR_IDS } from './types.js';
import { writeFile, unlink } from 'node:fs/promises';

// Dialect tables come from the `coil` dependency (R-0013)
const require = createRequire(import.meta.url);
const DIALECTS_DIR = dirname(require.resolve('coil/dialects/README.md'));
const EN_PATH = join(DIALECTS_DIR, 'en-standard', 'en-standard.json');
const RU_PATH = join(DIALECTS_DIR, 'ru-standard', 'ru-standard.json');

// ─── Loader ──────────────────────────────────────────────

describe('loadDialect', () => {
  it('загрузка en-standard.json — все ID покрыты', async () => {
    const table = await loadDialect(EN_PATH);
    expect(table.name).toBe('en-standard');
    expect(table.label).toBe('Standard English');
    // Verify all categories are present and complete
    for (const id of ALL_OP_IDS) expect(table.operators[id]).toBeTruthy();
    for (const id of ALL_KW_IDS) expect(table.terminators[id]).toBeTruthy();
    for (const id of ALL_MOD_IDS) expect(table.modifiers[id]).toBeTruthy();
    for (const id of ALL_POL_IDS) expect(table.policies[id]).toBeTruthy();
    for (const id of ALL_TYP_IDS) expect(table.resultTypes[id]).toBeTruthy();
    for (const id of ALL_DUR_IDS) expect(table.durationSuffixes[id]).toBeTruthy();
  });

  it('загрузка ru-standard.json — все ID покрыты', async () => {
    const table = await loadDialect(RU_PATH);
    expect(table.name).toBe('ru-standard');
    expect(table.label).toBe('Стандартный русский');
    for (const id of ALL_OP_IDS) expect(table.operators[id]).toBeTruthy();
    for (const id of ALL_KW_IDS) expect(table.terminators[id]).toBeTruthy();
    for (const id of ALL_MOD_IDS) expect(table.modifiers[id]).toBeTruthy();
    for (const id of ALL_POL_IDS) expect(table.policies[id]).toBeTruthy();
    for (const id of ALL_TYP_IDS) expect(table.resultTypes[id]).toBeTruthy();
    for (const id of ALL_DUR_IDS) expect(table.durationSuffixes[id]).toBeTruthy();
  });

  it('несуществующий файл → DialectLoadError', async () => {
    await expect(loadDialect('/tmp/nonexistent.json'))
      .rejects.toThrow(DialectLoadError);
    await expect(loadDialect('/tmp/nonexistent.json'))
      .rejects.toThrow('not found');
  });

  it('невалидный JSON → DialectLoadError', async () => {
    const tmpPath = '/tmp/bad-dialect.json';
    await writeFile(tmpPath, '{ broken json');
    try {
      await expect(loadDialect(tmpPath)).rejects.toThrow('invalid JSON');
    } finally {
      await unlink(tmpPath);
    }
  });

  it('неполная таблица → понятная ошибка с перечислением недостающих ID', async () => {
    const tmpPath = '/tmp/incomplete-dialect.json';
    const incomplete = {
      name: 'test',
      label: 'Test',
      operators: { 'Op.Actors': 'ACTORS' },
      terminators: {},
      modifiers: {},
      policies: {},
      resultTypes: {},
      durationSuffixes: {},
    };
    await writeFile(tmpPath, JSON.stringify(incomplete));
    try {
      await expect(loadDialect(tmpPath)).rejects.toThrow('incomplete');
      try {
        await loadDialect(tmpPath);
      } catch (err) {
        const msg = (err as Error).message;
        // Should list specific missing IDs
        expect(msg).toContain('Op.Tools');
        expect(msg).toContain('Kw.End');
        expect(msg).toContain('Mod.To');
        expect(msg).toContain('Pol.None');
        expect(msg).toContain('Typ.Text');
        expect(msg).toContain('Dur.Seconds');
      }
    } finally {
      await unlink(tmpPath);
    }
  });
});

// ─── KeywordIndex ────────────────────────────────────────

describe('KeywordIndex', () => {
  let enIndex: KeywordIndex;
  let ruIndex: KeywordIndex;

  beforeAll(async () => {
    const enTable = await loadDialect(EN_PATH);
    enIndex = KeywordIndex.build(enTable);
    const ruTable = await loadDialect(RU_PATH);
    ruIndex = KeywordIndex.build(ruTable);
  });

  it('EN: REPLY TO → Mod.ReplyTo, REPLY не матчится отдельно', () => {
    // "REPLY TO" should match as whole phrase
    const match = enIndex.longestMatch('REPLY TO #support', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.ReplyTo');
    expect(match!.length).toBe('REPLY TO'.length);

    // "REPLY" alone should NOT match (it's not a keyword)
    const noMatch = enIndex.longestMatch('REPLY something', 0);
    expect(noMatch).toBeNull();
  });

  it('EN: NO MORE THAN → Mod.Limit', () => {
    const match = enIndex.longestMatch('NO MORE THAN 5', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.Limit');
    expect(match!.length).toBe('NO MORE THAN'.length);
  });

  it('EN: TIMEOUT → Mod.Timeout', () => {
    const match = enIndex.longestMatch('TIMEOUT 10m', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.Timeout');
  });

  it('EN: RECEIVE → Op.Receive', () => {
    const match = enIndex.longestMatch('RECEIVE name', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Op.Receive');
    expect(match!.match.category).toBe('operator');
  });

  it('EN: EXIT → Op.Exit', () => {
    const match = enIndex.longestMatch('EXIT', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Op.Exit');
  });

  it('EN: END → Kw.End', () => {
    const match = enIndex.longestMatch('END', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Kw.End');
    expect(match!.match.category).toBe('terminator');
  });

  it('EN: идентификатор не матчится как keyword', () => {
    const match = enIndex.longestMatch('myVariable', 0);
    expect(match).toBeNull();
  });

  it('EN: duration suffixes', () => {
    expect(enIndex.durationSuffixes.get('s')).toBe('Dur.Seconds');
    expect(enIndex.durationSuffixes.get('m')).toBe('Dur.Minutes');
    expect(enIndex.durationSuffixes.get('h')).toBe('Dur.Hours');
  });

  it('RU: НЕ БОЛЕЕ → [Mod.Timeout, Mod.Limit] (context-dependent, R-0010)', () => {
    // НЕ БОЛЕЕ maps to both Mod.Timeout and Mod.Limit in ru-standard
    const match = ruIndex.longestMatch('НЕ БОЛЕЕ 5', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids.length).toBeGreaterThanOrEqual(1);
    expect(match!.length).toBe('НЕ БОЛЕЕ'.length);
  });

  it('RU: НЕ does not match as standalone phrase', () => {
    // Expression keywords are NOT in the keyword index (recognized by expression parser only)
    const match = ruIndex.longestMatch('НЕ что-то', 0);
    expect(match).toBeNull();
  });

  it('RU: ЦЕЛЬ → Mod.Goal', () => {
    const match = ruIndex.longestMatch('ЦЕЛЬ <<', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.Goal');
  });

  it('RU: НА → Mod.On', () => {
    const match = ruIndex.longestMatch('НА ?plan', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.On');
  });

  it('RU: КОНЕЦ → Kw.End', () => {
    const match = ruIndex.longestMatch('КОНЕЦ', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Kw.End');
  });

  it('RU: ОТВЕТ НА → Mod.ReplyTo (multi-word phrase)', () => {
    const match = ruIndex.longestMatch('ОТВЕТ НА #msg', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.ReplyTo');
    expect(match!.length).toBe('ОТВЕТ НА'.length);
  });

  it('RU: duration suffixes (cyrillic)', () => {
    expect(ruIndex.durationSuffixes.get('с')).toBe('Dur.Seconds');
    expect(ruIndex.durationSuffixes.get('м')).toBe('Dur.Minutes');
    expect(ruIndex.durationSuffixes.get('ч')).toBe('Dur.Hours');
  });

  it('EN: offset matching — keyword in middle of line', () => {
    const line = '  AWAIT ALL';
    const match = enIndex.longestMatch(line, 2);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.Await');
  });

  it('EN: word boundary — SENDING does not match as SEND', () => {
    const match = enIndex.longestMatch('SENDING data', 0);
    expect(match).toBeNull();
  });

  it('RU: ДО → Mod.Until', () => {
    const match = ruIndex.longestMatch('ДО $ready', 0);
    expect(match).not.toBeNull();
    expect(match!.match.ids).toContain('Mod.Until');
  });

  it('RU: word boundary — ДУМАЙТЕ does not match as ДУМАЙ', () => {
    const match = ruIndex.longestMatch('ДУМАЙТЕ', 0);
    expect(match).toBeNull();
  });
});
