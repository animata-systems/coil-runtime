import type { DialectTable, AbstractId, Category } from './types.js';

export interface KeywordMatch {
  ids: AbstractId[];
  category: Category;
}

/**
 * Reverse index: keyword phrase → abstract ID(s).
 * Phrases sorted by descending length for longest-match (R-0003).
 * One phrase may map to multiple IDs for context-dependent resolution (R-0010).
 */
export class KeywordIndex {
  /** Phrase → match, sorted entries for longest match */
  private readonly entries: Array<{ phrase: string; match: KeywordMatch }>;
  /** Duration suffix → abstract ID (e.g. "s" → "Dur.Seconds") */
  readonly durationSuffixes: Map<string, AbstractId>;

  private constructor(
    entries: Array<{ phrase: string; match: KeywordMatch }>,
    durationSuffixes: Map<string, AbstractId>,
  ) {
    this.entries = entries;
    this.durationSuffixes = durationSuffixes;
  }

  /**
   * Try to match the longest keyword phrase starting at the given position in text.
   * Returns the match and the number of characters consumed, or null.
   */
  longestMatch(text: string, offset: number): { match: KeywordMatch; length: number } | null {
    for (const { phrase, match } of this.entries) {
      if (text.startsWith(phrase, offset)) {
        // Ensure the match ends at a word boundary:
        // next char is end of string, whitespace, or punctuation
        const afterEnd = offset + phrase.length;
        if (afterEnd < text.length) {
          const next = text[afterEnd];
          if (/[\p{L}\p{N}_]/u.test(next)) continue;
        }
        return { match, length: phrase.length };
      }
    }
    return null;
  }

  static build(table: DialectTable): KeywordIndex {
    const map = new Map<string, KeywordMatch>();

    function addEntries(
      section: Record<string, string>,
      category: Category,
    ): void {
      for (const [id, phrase] of Object.entries(section)) {
        const existing = map.get(phrase);
        if (existing) {
          // Same phrase maps to multiple abstract IDs (R-0010, SPEC.md § 5)
          existing.ids.push(id as AbstractId);
        } else {
          map.set(phrase, { ids: [id as AbstractId], category });
        }
      }
    }

    addEntries(table.operators, 'operator');
    addEntries(table.terminators, 'terminator');
    addEntries(table.modifiers, 'modifier');
    addEntries(table.policies, 'policy');
    addEntries(table.resultTypes, 'resultType');

    // Sort by phrase length descending for longest match
    const entries = Array.from(map.entries())
      .map(([phrase, match]) => ({ phrase, match }))
      .sort((a, b) => b.phrase.length - a.phrase.length);

    // Duration suffixes stored separately (used by lexer in number context)
    const durationSuffixes = new Map<string, AbstractId>();
    for (const [id, suffix] of Object.entries(table.durationSuffixes)) {
      durationSuffixes.set(suffix, id as AbstractId);
    }

    return new KeywordIndex(entries, durationSuffixes);
  }
}
