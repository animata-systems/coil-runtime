import type {
  Token, KeywordToken, IdentifierToken, ChannelRefToken,
  ParticipantRefToken, DurationLiteralToken, TextFragmentToken, ValueRefToken,
} from '../lexer/tokens.js';
import type { SourceSpan } from '../common/types.js';
import type { DialectTable, AbstractId } from '../dialect/types.js';
import type {
  ScriptNode, OperatorNode, ReceiveNode, SendNode, ExitNode,
  UnsupportedOperatorNode, TemplateNode, TextPart, RefPart, DurationValue,
  ChannelRef,
} from '../ast/nodes.js';

export class ParseError extends Error {
  readonly span: SourceSpan;
  readonly abstractId?: AbstractId;

  constructor(message: string, span: SourceSpan, abstractId?: AbstractId) {
    super(message);
    this.name = 'ParseError';
    this.span = span;
    this.abstractId = abstractId;
  }
}

/** Operators that use block form (require Kw.End) */
const BLOCK_OPERATORS: ReadonlySet<string> = new Set([
  'Op.Actors', 'Op.Tools', 'Op.Define', 'Op.Set',
  'Op.Receive', 'Op.Think', 'Op.Execute', 'Op.Send', 'Op.Wait',
  'Op.If', 'Op.Repeat', 'Op.Each', 'Op.Gather', 'Op.Signal',
]);

/** SEND modifier abstract IDs */
const SEND_MODIFIERS: readonly AbstractId[] = [
  'Mod.To', 'Mod.For', 'Mod.ReplyTo', 'Mod.Await', 'Mod.Timeout',
];

export function parse(tokens: Token[], dialect: DialectTable): ScriptNode {
  const operators: OperatorNode[] = [];
  let pos = 0;

  function peek(): Token {
    return tokens[pos] ?? tokens[tokens.length - 1];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function skipNewlines(): void {
    while (peek().type === 'Newline' || peek().type === 'Comment') {
      advance();
    }
  }

  function expect(type: Token['type']): Token {
    skipNewlines();
    const t = peek();
    if (t.type !== type) {
      throw new ParseError(`expected ${type}, got ${t.type}`, t.span);
    }
    return advance();
  }

  function expectChannelRef(): ChannelRefToken {
    return expect('ChannelRef') as ChannelRefToken;
  }

  function expectKeyword(id: AbstractId): KeywordToken {
    skipNewlines();
    const t = peek();
    if (t.type !== 'Keyword' || !(t as KeywordToken).ids.includes(id)) {
      const dialectWord = lookupDialectWord(id, dialect);
      throw new ParseError(`expected ${dialectWord} (${id})`, t.span, id);
    }
    return advance() as KeywordToken;
  }

  function isKeyword(id: AbstractId): boolean {
    const t = peek();
    return t.type === 'Keyword' && (t as KeywordToken).ids.includes(id);
  }

  function isAnyKeywordOf(ids: readonly AbstractId[]): AbstractId | null {
    const t = peek();
    if (t.type !== 'Keyword') return null;
    const kw = t as KeywordToken;
    for (const id of ids) {
      if (kw.ids.includes(id)) return id;
    }
    return null;
  }

  function isOperator(): AbstractId | null {
    const t = peek();
    if (t.type !== 'Keyword') return null;
    const kw = t as KeywordToken;
    for (const id of kw.ids) {
      if (id.startsWith('Op.')) return id;
    }
    return null;
  }

  function makeSpanFrom(start: SourceSpan): SourceSpan {
    const last = tokens[pos - 1];
    const endOffset = last.span.offset + last.span.length;
    return {
      line: start.line,
      col: start.col,
      offset: start.offset,
      length: endOffset - start.offset,
    };
  }

  function toChannelRef(token: ChannelRefToken): ChannelRef {
    return { segments: token.segments, span: token.span };
  }

  // ─── Template parsing ──────────────────────────────────

  function parseTemplate(): TemplateNode {
    const openToken = expect('TemplateOpen');
    const parts: (TextPart | RefPart)[] = [];

    while (peek().type !== 'TemplateClose' && peek().type !== 'EOF') {
      const t = peek();
      if (t.type === 'TextFragment') {
        advance();
        parts.push({ type: 'text', value: (t as TextFragmentToken).value, span: t.span });
      } else if (t.type === 'ValueRef') {
        advance();
        const vr = t as ValueRefToken;
        parts.push({ type: 'ref', name: vr.name, path: vr.path, span: t.span });
      } else {
        advance();
      }
    }

    expect('TemplateClose');
    return { parts, span: makeSpanFrom(openToken.span) };
  }

  // ─── RECEIVE ───────────────────────────────────────────

  function parseReceive(kwToken: KeywordToken): ReceiveNode {
    skipNewlines();
    const nameToken = expect('Identifier') as IdentifierToken;

    skipNewlines();
    let prompt: TemplateNode | null = null;
    if (peek().type === 'TemplateOpen') {
      prompt = parseTemplate();
    }

    skipNewlines();
    expectKeyword('Kw.End');

    return {
      kind: 'Op.Receive',
      name: nameToken.name,
      prompt,
      span: makeSpanFrom(kwToken.span),
    };
  }

  // ─── SEND ──────────────────────────────────────────────

  function parseSend(kwToken: KeywordToken): SendNode {
    skipNewlines();

    let name: string | null = null;
    let to: ChannelRef | null = null;
    let forList: string[] = [];
    let replyTo: ChannelRef | null = null;
    let awaitPolicy: 'none' | 'any' | 'all' | null = null;
    let timeout: DurationValue | null = null;
    let body: TemplateNode | null = null;
    let bodyParsed = false;

    // Optional name — identifier that isn't a modifier keyword
    if (peek().type === 'Identifier') {
      name = (peek() as IdentifierToken).name;
      advance();
    }

    while (!isKeyword('Kw.End') && peek().type !== 'EOF') {
      skipNewlines();
      if (isKeyword('Kw.End') || peek().type === 'EOF') break;

      // Template body
      if (peek().type === 'TemplateOpen') {
        if (bodyParsed) {
          throw new ParseError('duplicate body in SEND block', peek().span, 'Op.Send');
        }
        body = parseTemplate();
        bodyParsed = true;
        continue;
      }

      // Modifier
      const modId = isAnyKeywordOf(SEND_MODIFIERS);
      if (modId) {
        if (bodyParsed) {
          const dialectWord = lookupDialectWord(modId, dialect);
          throw new ParseError(
            `modifier ${dialectWord} after body is not allowed (body must be last in block)`,
            peek().span,
            modId,
          );
        }

        advance(); // consume modifier keyword
        skipNewlines();

        switch (modId) {
          case 'Mod.To': {
            if (to !== null) {
              throw new ParseError('duplicate TO modifier', peek().span, 'Mod.To');
            }
            to = toChannelRef(expectChannelRef());
            break;
          }
          case 'Mod.For': {
            if (peek().type !== 'ParticipantRef') {
              throw new ParseError('expected participant after FOR', peek().span, 'Mod.For');
            }
            forList.push((peek() as ParticipantRefToken).name);
            advance();
            while (peek().type === 'Comma') {
              advance();
              skipNewlines();
              if (peek().type === 'ParticipantRef') {
                forList.push((peek() as ParticipantRefToken).name);
                advance();
              }
            }
            break;
          }
          case 'Mod.ReplyTo': {
            if (replyTo !== null) {
              throw new ParseError('duplicate REPLY TO modifier', peek().span, 'Mod.ReplyTo');
            }
            replyTo = toChannelRef(expectChannelRef());
            break;
          }
          case 'Mod.Await': {
            if (awaitPolicy !== null) {
              throw new ParseError('duplicate AWAIT modifier', peek().span, 'Mod.Await');
            }
            skipNewlines();
            const polId = isAnyKeywordOf(['Pol.None', 'Pol.Any', 'Pol.All']);
            if (polId === 'Pol.None') { awaitPolicy = 'none'; advance(); }
            else if (polId === 'Pol.Any') { awaitPolicy = 'any'; advance(); }
            else if (polId === 'Pol.All') { awaitPolicy = 'all'; advance(); }
            else {
              throw new ParseError('expected NONE, ANY, or ALL after AWAIT', peek().span, 'Mod.Await');
            }
            break;
          }
          case 'Mod.Timeout': {
            if (timeout !== null) {
              throw new ParseError('duplicate TIMEOUT modifier', peek().span, 'Mod.Timeout');
            }
            skipNewlines();
            if (peek().type === 'DurationLiteral') {
              const dur = peek() as DurationLiteralToken;
              timeout = { value: dur.value, unitId: dur.unitId, span: dur.span };
              advance();
            } else {
              throw new ParseError('expected duration after TIMEOUT', peek().span, 'Mod.Timeout');
            }
            break;
          }
        }
        continue;
      }

      // Unexpected token inside SEND — skip with no silent swallow
      advance();
    }

    expectKeyword('Kw.End');

    return {
      kind: 'Op.Send',
      name,
      to,
      for: forList,
      replyTo,
      await: awaitPolicy,
      timeout,
      body,
      span: makeSpanFrom(kwToken.span),
    };
  }

  // ─── EXIT ──────────────────────────────────────────────

  function parseExit(kwToken: KeywordToken): ExitNode {
    if (peek().type !== 'Newline' && peek().type !== 'EOF' && peek().type !== 'Comment') {
      throw new ParseError('EXIT takes no arguments', peek().span, 'Op.Exit');
    }
    return { kind: 'Op.Exit', span: kwToken.span };
  }

  // ─── skipBlock (R-0011) ────────────────────────────────

  function skipBlock(kwToken: KeywordToken, opId: AbstractId): UnsupportedOperatorNode {
    let depth = 1;
    while (depth > 0 && peek().type !== 'EOF') {
      const t = peek();
      if (t.type === 'Keyword') {
        const kw = t as KeywordToken;
        for (const id of kw.ids) {
          if (BLOCK_OPERATORS.has(id)) { depth++; break; }
        }
        if (kw.ids.includes('Kw.End')) {
          depth--;
          if (depth === 0) { advance(); break; }
        }
      }
      advance();
    }

    return {
      kind: 'Unsupported',
      operatorId: opId,
      span: makeSpanFrom(kwToken.span),
    };
  }

  // ─── Main loop ─────────────────────────────────────────

  while (peek().type !== 'EOF') {
    skipNewlines();
    if (peek().type === 'EOF') break;

    const opId = isOperator();
    if (opId) {
      const kwToken = advance() as KeywordToken;

      if (opId === 'Op.Receive') {
        operators.push(parseReceive(kwToken));
      } else if (opId === 'Op.Send') {
        operators.push(parseSend(kwToken));
      } else if (opId === 'Op.Exit') {
        operators.push(parseExit(kwToken));
      } else if (BLOCK_OPERATORS.has(opId)) {
        operators.push(skipBlock(kwToken, opId));
      } else {
        operators.push({ kind: 'Unsupported', operatorId: opId, span: kwToken.span });
      }
      continue;
    }

    const t = peek();
    throw new ParseError(`unexpected token at top level: ${t.type}`, t.span);
  }

  return { operators, dialect: dialect.name };
}

// ─── Dialect-aware diagnostics ─────────────────────────

function lookupDialectWord(id: AbstractId, dialect: DialectTable): string {
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

/** Format a ParseError with dialect-specific keywords */
export function formatError(error: ParseError, dialect: DialectTable): string {
  let msg = error.message;
  if (error.abstractId) {
    const word = lookupDialectWord(error.abstractId, dialect);
    msg = msg.replace(error.abstractId, word);
  }
  return `${msg} (line ${error.span.line}, col ${error.span.col})`;
}
