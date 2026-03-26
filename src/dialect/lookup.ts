import type { AbstractId, DialectTable } from './types.js';

/** Look up a dialect-specific keyword by abstract ID (R-0024). */
export function lookupDialectWord(id: AbstractId, dialect: DialectTable): string {
  const sections = [
    dialect.operators, dialect.terminators, dialect.modifiers,
    dialect.policies, dialect.resultTypes, dialect.durationSuffixes,
  ];
  for (const section of sections) {
    if (id in section) {
      return (section as Record<string, string>)[id];
    }
  }
  return id;
}

/**
 * Extract human language from dialect name.
 * Format: `{lang}-{name}` — e.g. "ru-matrix" → "ru", "en-standard" → "en".
 * Unsupported languages fall back to "en".
 */
export function extractLanguage(dialectName: string): 'en' | 'ru' {
  const lang = dialectName.split('-')[0];
  return lang === 'ru' ? 'ru' : 'en';
}
