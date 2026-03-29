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
 * Format: `{lang}-{variant}` — last segment is variant, everything before is language.
 * Examples: "en-standard" → "en", "ru-standard" → "ru", "pt-br-standard" → "pt-br".
 * Unsupported languages fall back to "en".
 */
export function extractLanguage(dialectName: string): 'en' | 'ru' {
  const parts = dialectName.split('-');
  const lang = parts.slice(0, -1).join('-');
  return lang === 'ru' ? 'ru' : 'en';
}
