import type { DialectTable } from '../dialect/types.js';
import { lookupDialectWord, extractLanguage } from '../dialect/lookup.js';

type Lang = 'en' | 'ru';

interface MessageParams {
  name?: string;
  dialect: DialectTable;
}

type MessageFn = (p: MessageParams) => string;

const templates: Record<string, Record<Lang, MessageFn>> = {
  'exit-required': {
    en: (_p) => 'script must end with EXIT',
    ru: (p) => `скрипт должен заканчиваться ${lookupDialectWord('Op.Exit', p.dialect)}`,
  },
  'unreachable-after-exit': {
    en: (_p) => 'unreachable code after EXIT',
    ru: (p) => `недостижимый код после ${lookupDialectWord('Op.Exit', p.dialect)}`,
  },
  'unsupported-operator': {
    en: (p) => `operator ${p.name} is not supported in this version`,
    ru: (p) => `оператор ${p.name} не поддерживается в этой версии`,
  },
  'undeclared-participant': {
    en: (p) => `participant @${p.name} is not declared in ${lookupDialectWord('Op.Actors', p.dialect)}`,
    ru: (p) => `участник @${p.name} не объявлен в ${lookupDialectWord('Op.Actors', p.dialect)}`,
  },
  'undeclared-tool': {
    en: (p) => `tool !${p.name} is not declared in ${lookupDialectWord('Op.Tools', p.dialect)}`,
    ru: (p) => `инструмент !${p.name} не объявлен в ${lookupDialectWord('Op.Tools', p.dialect)}`,
  },
  'undefined-variable': {
    en: (p) => `variable $${p.name} is not defined`,
    ru: (p) => `переменная $${p.name} не определена`,
  },
  'duplicate-define': {
    en: (p) => `variable $${p.name} is already defined`,
    ru: (p) => `переменная $${p.name} уже определена`,
  },
  'set-without-define': {
    en: (p) => `cannot SET $${p.name}: variable is not defined`,
    ru: (p) => `нельзя ${lookupDialectWord('Op.Set', p.dialect)} $${p.name}: переменная не определена`,
  },
  'set-without-define:promised': {
    en: (p) => `cannot SET $${p.name}: promise is not yet resolved (use WAIT first)`,
    ru: (p) => `нельзя ${lookupDialectWord('Op.Set', p.dialect)} $${p.name}: обещание ещё не выполнено (используйте ${lookupDialectWord('Op.Wait', p.dialect)})`,
  },
  'undefined-promise': {
    en: (p) => `promise ?${p.name} is not defined by any launching operator`,
    ru: (p) => `обещание ?${p.name} не создано ни одним запускающим оператором`,
  },
  'use-before-wait': {
    en: (p) => `$${p.name} used before WAIT ON ?${p.name} — value may not be available`,
    ru: (p) => `$${p.name} использован до ${lookupDialectWord('Op.Wait', p.dialect)} ${lookupDialectWord('Mod.On', p.dialect)} ?${p.name} — значение может быть недоступно`,
  },
};

/** Format a diagnostic message using dialect-aware templates (D-007-4). */
export function formatMessage(ruleId: string, dialect: DialectTable, name?: string): string {
  const lang = extractLanguage(dialect.name);
  const tpl = templates[ruleId];
  if (!tpl) return `[${ruleId}] ${name ?? ''}`;
  return tpl[lang]({ name, dialect });
}
