import type { KeywordIndex } from '../dialect/index.js';
import type {
  Token, SourceSpan, ChannelSegment,
} from './tokens.js';

export class LexerError extends Error {
  readonly span: SourceSpan;
  readonly errorCode: string;
  constructor(message: string, span: SourceSpan, errorCode: string) {
    super(message);
    this.name = 'LexerError';
    this.span = span;
    this.errorCode = errorCode;
  }
}

/** Unicode letter or underscore — valid identifier start */
const ID_START = /[\p{L}_]/u;
/** Unicode letter, digit, or underscore — valid identifier continuation */
const ID_CONT = /[\p{L}\p{N}_]/u;

/**
 * Tokenize a COIL source string using the given keyword index.
 * R-0003: phrase-based longest match.
 * R-0004: template mode splits << >> into TextFragment + ValueRef.
 */
export function tokenize(source: string, keywords: KeywordIndex): Token[] {
  try {
    return tokenizeImpl(source, keywords);
  } catch (e) {
    if (e instanceof LexerError) throw e;
    throw new LexerError(
      `internal lexer error: ${(e as Error).message}`,
      { line: 1, col: 1, offset: 0, length: 0 },
      'internal-error',
    );
  }
}

function tokenizeImpl(source: string, keywords: KeywordIndex): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function makeSpan(startLine: number, startCol: number, startOffset: number, length: number): SourceSpan {
    return { line: startLine, col: startCol, offset: startOffset, length };
  }

  function peek(): string {
    return source[pos] ?? '';
  }

  function peekAt(offset: number): string {
    return source[pos + offset] ?? '';
  }

  function advance(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (source[pos] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }
  }

  function atEnd(): boolean {
    return pos >= source.length;
  }

  function skipWhitespace(): void {
    while (!atEnd() && (peek() === ' ' || peek() === '\t' || peek() === '\r')) {
      advance();
    }
  }

  /** Read an identifier (letters, digits, underscore) */
  function readIdentifier(): string {
    let name = '';
    while (!atEnd() && ID_CONT.test(peek())) {
      name += peek();
      advance();
    }
    return name;
  }

  /** Read a $-reference: name and optional .field.subfield path */
  function readValueRef(startLine: number, startCol: number, startOffset: number): Token {
    advance(); // skip $
    const name = readIdentifier();
    if (name === '') {
      throw new LexerError('expected identifier after $', makeSpan(startLine, startCol, startOffset, 1), 'expected-identifier-after-sigil');
    }
    const path: string[] = [];
    while (!atEnd() && peek() === '.') {
      advance(); // skip .
      const field = readIdentifier();
      if (field === '') {
        throw new LexerError('expected field name after .', makeSpan(line, col - 1, pos - 1, 1), 'expected-field-after-dot');
      }
      path.push(field);
    }
    return {
      type: 'ValueRef',
      name,
      path,
      span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
    };
  }

  /** Read a channel reference: #name, #name/path, #$dynamic */
  function readChannelRef(startLine: number, startCol: number, startOffset: number): Token {
    advance(); // skip #
    const segments: ChannelSegment[] = [];

    function readSegment(): ChannelSegment | null {
      if (atEnd()) return null;
      if (peek() === '$') {
        advance(); // skip $
        const name = readIdentifier();
        if (name === '') return null;
        const path: string[] = [];
        while (!atEnd() && peek() === '.') {
          advance();
          const field = readIdentifier();
          if (field === '') break;
          path.push(field);
        }
        return { kind: 'dynamic', name, path };
      }
      if (ID_START.test(peek()) || /\d/.test(peek())) {
        let value = '';
        while (!atEnd() && (ID_CONT.test(peek()) || /\d/.test(peek()))) {
          value += peek();
          advance();
        }
        return { kind: 'literal', value };
      }
      return null;
    }

    const first = readSegment();
    if (!first) {
      throw new LexerError('expected channel name after #', makeSpan(startLine, startCol, startOffset, 1), 'expected-channel-name');
    }
    segments.push(first);

    while (!atEnd() && peek() === '/') {
      advance(); // skip /
      const seg = readSegment();
      if (!seg) break;
      segments.push(seg);
    }

    return {
      type: 'ChannelRef',
      segments,
      span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
    };
  }

  /** Read a simple sigil reference: @name, ?name, !name, ~name */
  function readSimpleRef(
    sigil: string,
    tokenType: 'ParticipantRef' | 'PromiseRef' | 'ToolRef' | 'StreamRef',
    startLine: number,
    startCol: number,
    startOffset: number,
  ): Token {
    advance(); // skip sigil
    const name = readIdentifier();
    if (name === '') {
      throw new LexerError(`expected identifier after ${sigil}`, makeSpan(startLine, startCol, startOffset, 1), 'expected-ref-name');
    }
    return {
      type: tokenType,
      name,
      span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
    } as Token;
  }

  /** Read a number (digits only) */
  function readNumber(): number {
    let numStr = '';
    while (!atEnd() && /\d/.test(peek())) {
      numStr += peek();
      advance();
    }
    return parseInt(numStr, 10);
  }

  // ─── Template mode ─────────────────────────────────────

  function tokenizeTemplate(): void {
    // We're right after << was consumed
    // Collect until we see >> on its own line (or inline >>)
    let textStart = pos;
    let textStartLine = line;
    let textStartCol = col;
    let textBuf = '';

    function flushText(): void {
      if (textBuf.length > 0) {
        tokens.push({
          type: 'TextFragment',
          value: textBuf,
          span: makeSpan(textStartLine, textStartCol, textStart, textBuf.length),
        });
        textBuf = '';
      }
      textStart = pos;
      textStartLine = line;
      textStartCol = col;
    }

    while (!atEnd()) {
      // Check for closing >>
      if (peek() === '>' && peekAt(1) === '>') {
        flushText();
        const closeLine = line;
        const closeCol = col;
        const closeOffset = pos;
        advance(2); // consume >>
        tokens.push({
          type: 'TemplateClose',
          span: makeSpan(closeLine, closeCol, closeOffset, 2),
        });
        return;
      }

      // $-reference inside template
      if (peek() === '$' && peekAt(1) !== '' && ID_START.test(peekAt(1))) {
        flushText();
        const refLine = line;
        const refCol = col;
        const refOffset = pos;
        tokens.push(readValueRef(refLine, refCol, refOffset));
        textStart = pos;
        textStartLine = line;
        textStartCol = col;
        continue;
      }

      // Regular text character
      textBuf += peek();
      advance();
    }

    // Unterminated template
    throw new LexerError('unterminated template: expected >>', makeSpan(textStartLine, textStartCol, textStart, 0), 'unterminated-template');
  }

  // ─── Main loop ─────────────────────────────────────────

  while (!atEnd()) {
    skipWhitespace();
    if (atEnd()) break;

    const ch = peek();
    const startLine = line;
    const startCol = col;
    const startOffset = pos;

    // Newline
    if (ch === '\n') {
      tokens.push({ type: 'Newline', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    // Comment: ' to end of line
    if (ch === "'") {
      advance(); // skip '
      let text = '';
      while (!atEnd() && peek() !== '\n') {
        text += peek();
        advance();
      }
      tokens.push({
        type: 'Comment',
        text: text.trimStart(),
        span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
      });
      continue;
    }

    // Template open: <<
    if (ch === '<' && peekAt(1) === '<') {
      tokens.push({ type: 'TemplateOpen', span: makeSpan(startLine, startCol, startOffset, 2) });
      advance(2);
      // Skip optional whitespace/newline after <<
      // Actually, enter template mode — template content starts immediately
      tokenizeTemplate();
      continue;
    }

    // Comma
    if (ch === ',') {
      tokens.push({ type: 'Comma', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    // Sigil references
    if (ch === '$' && !atEnd() && ID_START.test(peekAt(1))) {
      tokens.push(readValueRef(startLine, startCol, startOffset));
      continue;
    }

    if (ch === '@') {
      tokens.push(readSimpleRef('@', 'ParticipantRef', startLine, startCol, startOffset));
      continue;
    }

    if (ch === '#') {
      tokens.push(readChannelRef(startLine, startCol, startOffset));
      continue;
    }

    if (ch === '?') {
      tokens.push(readSimpleRef('?', 'PromiseRef', startLine, startCol, startOffset));
      continue;
    }

    if (ch === '!') {
      // != is a comparison operator, not a ToolRef (R-0034)
      if (pos + 1 < source.length && source[pos + 1] === '=') {
        advance(); // skip !
        advance(); // skip =
        tokens.push({
          type: 'Comparison',
          operator: '!=',
          span: makeSpan(startLine, startCol, startOffset, 2),
        });
        continue;
      }
      tokens.push(readSimpleRef('!', 'ToolRef', startLine, startCol, startOffset));
      continue;
    }

    if (ch === '~') {
      tokens.push(readSimpleRef('~', 'StreamRef', startLine, startCol, startOffset));
      continue;
    }

    // Number — could be duration literal or just a number
    if (/\d/.test(ch)) {
      const numValue = readNumber();
      // Check for duration suffix
      if (!atEnd()) {
        const suffixId = keywords.durationSuffixes.get(peek());
        if (suffixId) {
          advance(); // consume suffix
          tokens.push({
            type: 'DurationLiteral',
            value: numValue,
            unitId: suffixId,
            span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
          });
          continue;
        }
      }
      // Plain number — NumberLiteral (D-006-7)
      tokens.push({
        type: 'NumberLiteral',
        value: numValue,
        span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
      });
      continue;
    }

    // Keyword or identifier — starts with a letter or underscore
    if (ID_START.test(ch)) {
      // Try longest keyword match first
      const kwMatch = keywords.longestMatch(source, pos);
      if (kwMatch) {
        tokens.push({
          type: 'Keyword',
          ids: kwMatch.match.ids,
          span: makeSpan(startLine, startCol, startOffset, kwMatch.length),
        });
        advance(kwMatch.length);
        continue;
      }

      // Fallback: identifier
      const name = readIdentifier();
      tokens.push({
        type: 'Identifier',
        name,
        span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
      });
      continue;
    }

    // RESULT microsyntax markers
    if (ch === '*') {
      tokens.push({ type: 'Star', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    if (ch === '-') {
      tokens.push({ type: 'Dash', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    if (ch === ':') {
      tokens.push({ type: 'Colon', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    // Parentheses (RESULT microsyntax: CHOICE(a, b, c))
    if (ch === '(') {
      tokens.push({ type: 'ParenOpen', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'ParenClose', span: makeSpan(startLine, startCol, startOffset, 1) });
      advance();
      continue;
    }

    // String literal: "..." (used in some test files)
    if (ch === '"') {
      advance(); // skip opening "
      let value = '';
      while (!atEnd() && peek() !== '"' && peek() !== '\n') {
        value += peek();
        advance();
      }
      if (!atEnd() && peek() === '"') {
        advance(); // skip closing "
      }
      tokens.push({
        type: 'StringLiteral',
        value,
        span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
      });
      continue;
    }

    // Comparison operators: =, ==, <, <=, >, >= (R-0034)
    if (ch === '>' || ch === '<' || ch === '=') {
      let op = ch;
      advance();
      if (!atEnd() && peek() === '=') {
        op += '=';
        advance();
      }
      tokens.push({
        type: 'Comparison',
        operator: op,
        span: makeSpan(startLine, startCol, startOffset, pos - startOffset),
      });
      continue;
    }

    // Arithmetic operators → specific error for better diagnostics (R-0035)
    if (ch === '+' || ch === '/') {
      throw new LexerError(
        `arithmetic operator '${ch}' is not supported in v0.4`,
        makeSpan(startLine, startCol, startOffset, 1),
        'arithmetic-deferred',
      );
    }

    // Unknown character
    throw new LexerError(
      `unexpected character: '${ch}' (U+${ch.codePointAt(0)!.toString(16).padStart(4, '0')})`,
      makeSpan(startLine, startCol, startOffset, 1),
      'unexpected-character',
    );
  }

  // EOF
  tokens.push({ type: 'EOF', span: makeSpan(line, col, pos, 0) });
  return tokens;
}
