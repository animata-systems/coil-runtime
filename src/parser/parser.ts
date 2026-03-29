import type {
  Token, KeywordToken, IdentifierToken, ChannelRefToken,
  ParticipantRefToken, DurationLiteralToken, TextFragmentToken, ValueRefToken,
  ToolRefToken, PromiseRefToken, StreamRefToken, NumberLiteralToken,
  StringLiteralToken, CommentToken,
} from '../lexer/tokens.js';
import type { SourceSpan } from '../common/types.js';
import type { DialectTable, AbstractId } from '../dialect/types.js';
import { lookupDialectWord } from '../dialect/lookup.js';
import type {
  ScriptNode, OperatorNode, CommentNode, ReceiveNode, SendNode, ExitNode,
  UnsupportedOperatorNode, TemplateNode, TextPart, RefPart, DurationValue,
  ChannelRef, ValueRef, ToolRef, PromiseRef,
  ActorsNode, ToolsNode, DefineNode, SetNode,
  ThinkNode, ExecuteNode, WaitNode, SignalNode,
  IfNode, RepeatNode, EachNode,
  BodyValue, ArgEntry, ResultField, StreamRef,
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
  'Op.Define', 'Op.Set',
  'Op.Receive', 'Op.Think', 'Op.Execute', 'Op.Send', 'Op.Wait',
  'Op.If', 'Op.Repeat', 'Op.Each', 'Op.Gather', 'Op.Signal',
]);

/** Operators that support inline form (no Kw.End): ACTORS a, b, c */
const INLINE_OPERATORS: ReadonlySet<string> = new Set([
  'Op.Actors', 'Op.Tools',
]);

/** SEND modifier abstract IDs */
const SEND_MODIFIERS: readonly AbstractId[] = [
  'Mod.To', 'Mod.For', 'Mod.ReplyTo', 'Mod.Await', 'Mod.Timeout',
];

/** THINK modifier abstract IDs */
const THINK_RIGGING: readonly AbstractId[] = [
  'Mod.Via', 'Mod.As', 'Mod.Using',
];

const THINK_FORMULATION: readonly AbstractId[] = [
  'Mod.Goal', 'Mod.Input', 'Mod.Context', 'Mod.Result',
];

const THINK_MODIFIERS: readonly AbstractId[] = [
  ...THINK_RIGGING, ...THINK_FORMULATION,
];

/** WAIT modifier abstract IDs */
const WAIT_MODIFIERS: readonly AbstractId[] = [
  'Mod.On', 'Mod.Mode', 'Mod.Timeout',
];

/** R-0019: parse() accepts source for raw-text condition reconstruction */
export function parse(tokens: Token[], dialect: DialectTable, source: string): ScriptNode {
  const nodes: (OperatorNode | CommentNode)[] = [];
  let pos = 0;

  // ─── Token navigation ──────────────────────────────────

  function peek(): Token {
    return tokens[pos] ?? tokens[tokens.length - 1];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  /** Skip newlines only (for main loop — comments handled explicitly) */
  function skipNewlines(): void {
    while (peek().type === 'Newline') {
      advance();
    }
  }

  /** Skip newlines and comments (for inside blocks where comments are discarded) */
  function skipTrivia(): void {
    while (peek().type === 'Newline' || peek().type === 'Comment') {
      advance();
    }
  }

  function expect(type: Token['type']): Token {
    skipTrivia();
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
    skipTrivia();
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

  // ─── Shared helpers (C1–C8) ─────────────────────────────

  /** C1: Parse comma-separated reference list of a given token type (R-0018) */
  function parseRefList<T extends Token['type']>(expectedType: T): Extract<Token, { type: T }>[] {
    skipTrivia();
    const t = peek();
    if (t.type !== expectedType) {
      throw new ParseError(`expected ${expectedType}, got ${t.type}`, t.span);
    }
    const refs: Extract<Token, { type: T }>[] = [];
    refs.push(advance() as Extract<Token, { type: T }>);
    while (peek().type === 'Comma') {
      advance(); // consume comma
      skipTrivia();
      const next = peek();
      if (next.type !== expectedType) {
        throw new ParseError(`expected ${expectedType}, got ${next.type}`, next.span);
      }
      refs.push(advance() as Extract<Token, { type: T }>);
    }
    return refs;
  }

  /** C2: Parse policy keyword (NONE/ANY/ALL) */
  function parsePolicy(): 'none' | 'any' | 'all' {
    skipTrivia();
    const polId = isAnyKeywordOf(['Pol.None', 'Pol.Any', 'Pol.All']);
    if (polId === 'Pol.None') { advance(); return 'none'; }
    if (polId === 'Pol.Any') { advance(); return 'any'; }
    if (polId === 'Pol.All') { advance(); return 'all'; }
    throw new ParseError('expected NONE, ANY, or ALL', peek().span);
  }

  /** C3: Parse duration literal */
  function parseDuration(): DurationValue {
    skipTrivia();
    if (peek().type === 'DurationLiteral') {
      const dur = peek() as DurationLiteralToken;
      advance();
      return { value: dur.value, unitId: dur.unitId, span: dur.span };
    }
    throw new ParseError('expected duration literal', peek().span);
  }

  /** C4: Parse binding name (bare identifier in operator signature) */
  function parseBindingName(): string {
    skipTrivia();
    const t = peek();
    if (t.type !== 'Identifier') {
      throw new ParseError(`expected identifier, got ${t.type}`, t.span);
    }
    return (advance() as IdentifierToken).name;
  }

  /** C5: Parse $value reference */
  function parseValueRef(): ValueRef {
    skipTrivia();
    const t = peek();
    if (t.type !== 'ValueRef') {
      throw new ParseError(`expected $reference, got ${t.type}`, t.span);
    }
    const vr = advance() as ValueRefToken;
    return { type: 'ref', name: vr.name, path: vr.path, span: vr.span };
  }

  /** C6: Collect tokens on current line until Newline/EOF.
   *  Used by IF (raw text condition), REPEAT (find Mod.Limit), EACH.
   *  Filters out Comment tokens to avoid including inline comments in conditions. */
  function parseSignatureLine(): Token[] {
    const lineTokens: Token[] = [];
    while (peek().type !== 'Newline' && peek().type !== 'EOF') {
      if (peek().type === 'Comment') { advance(); continue; }
      lineTokens.push(advance());
    }
    return lineTokens;
  }

  /** C7: Parse argument list (- key: value) for EXECUTE */
  function parseArgList(): ArgEntry[] {
    const args: ArgEntry[] = [];
    while (true) {
      skipTrivia();
      if (isKeyword('Kw.End') || peek().type === 'EOF') break;
      if (peek().type === 'TemplateOpen') {
        throw new ParseError('template body << >> is not allowed in EXECUTE', peek().span, 'Op.Execute');
      }
      if (peek().type !== 'Dash') break;

      const dashToken = advance(); // consume -
      skipTrivia();
      const keyToken = expect('Identifier') as IdentifierToken;
      expect('Colon');
      skipTrivia();

      let value: ArgEntry['value'];
      const vt = peek();
      if (vt.type === 'ValueRef') {
        const vr = advance() as ValueRefToken;
        value = { type: 'ref', name: vr.name, path: vr.path, span: vr.span };
      } else if (vt.type === 'StringLiteral') {
        const sl = advance() as StringLiteralToken;
        value = { type: 'string', value: sl.value, span: sl.span };
      } else if (vt.type === 'NumberLiteral') {
        const nl = advance() as NumberLiteralToken;
        value = { type: 'number', value: nl.value, span: nl.span };
      } else {
        throw new ParseError(`expected value ($ref, "string", or number), got ${vt.type}`, vt.span);
      }

      args.push({
        key: keyToken.name,
        value,
        span: makeSpanFrom(dashToken.span),
      });
    }
    return args;
  }

  /** C8: Parse RESULT microsyntax (spec/05-structured-output.md) */
  function parseResultBlock(): ResultField[] {
    const fields: ResultField[] = [];
    let baseCol: number | null = null;
    let indentStep: number | null = null;

    while (true) {
      skipTrivia();
      if (isKeyword('Kw.End') || peek().type === 'EOF' || peek().type === 'TemplateOpen') break;
      if (peek().type !== 'Star') break;

      const starToken = advance(); // consume *

      // Determine depth from column position
      const starCol = starToken.span.col;
      let depth: number;
      if (baseCol === null) {
        baseCol = starCol;
        depth = 0;
      } else if (starCol === baseCol) {
        depth = 0;
      } else {
        if (indentStep === null) {
          indentStep = starCol - baseCol;
        }
        depth = Math.round((starCol - baseCol) / indentStep);
      }

      skipTrivia();
      const nameToken = expect('Identifier') as IdentifierToken;
      expect('Colon');
      skipTrivia();

      // Type keyword
      const typeToken = peek();
      if (typeToken.type !== 'Keyword') {
        throw new ParseError('expected result type keyword', typeToken.span);
      }
      const typeId = isAnyKeywordOf(['Typ.Text', 'Typ.Number', 'Typ.Flag', 'Typ.Choice', 'Typ.List']);
      if (!typeId) {
        throw new ParseError('expected result type (TEXT, NUMBER, FLAG, CHOICE, LIST)', typeToken.span);
      }
      advance(); // consume type keyword

      // CHOICE options: (opt1, opt2, ...)
      let typeArgs: string[] = [];
      if (typeId === 'Typ.Choice' && peek().type === 'ParenOpen') {
        advance(); // consume (
        while (peek().type !== 'ParenClose' && peek().type !== 'EOF') {
          skipTrivia();
          if (peek().type === 'ParenClose') break;
          if (peek().type === 'Identifier') {
            typeArgs.push((advance() as IdentifierToken).name);
          } else if (peek().type === 'Comma') {
            advance();
          } else {
            throw new ParseError(
              `unexpected token in CHOICE options: ${peek().type}`,
              peek().span,
            );
          }
        }
        if (peek().type === 'ParenClose') advance();
      }

      // Optional description: - text until end of line
      let description = '';
      if (peek().type === 'Dash') {
        advance(); // consume -
        // Collect rest of line as description using source
        const descStart = peek().span.offset;
        while (peek().type !== 'Newline' && peek().type !== 'EOF') {
          advance();
        }
        const descEnd = tokens[pos - 1].span.offset + tokens[pos - 1].span.length;
        description = source.slice(descStart, descEnd).trim();
      }

      fields.push({
        name: nameToken.name,
        typeId,
        typeArgs,
        description,
        depth,
        span: makeSpanFrom(starToken.span),
      });
    }

    return fields;
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
    return { type: 'template', parts, span: makeSpanFrom(openToken.span) };
  }

  // ─── Body value parsing (DEFINE/SET) ───────────────────

  function parseBodyValue(): BodyValue {
    skipTrivia();
    const t = peek();
    if (t.type === 'TemplateOpen') {
      return parseTemplate();
    }
    if (t.type === 'ValueRef') {
      return parseValueRef();
    }
    if (t.type === 'NumberLiteral') {
      const nl = advance() as NumberLiteralToken;
      return { type: 'number', value: nl.value, span: nl.span };
    }
    if (t.type === 'StringLiteral') {
      const sl = advance() as StringLiteralToken;
      return { type: 'string', value: sl.value, span: sl.span };
    }
    throw new ParseError(`expected body value (template, $reference, number, or "string"), got ${t.type}`, t.span);
  }

  // ─── RECEIVE ───────────────────────────────────────────

  function parseReceive(kwToken: KeywordToken): ReceiveNode {
    skipTrivia();
    const nameToken = expect('Identifier') as IdentifierToken;

    skipTrivia();
    let prompt: TemplateNode | null = null;
    if (peek().type === 'TemplateOpen') {
      prompt = parseTemplate();
    }

    skipTrivia();
    expectKeyword('Kw.End');

    return {
      kind: 'Op.Receive',
      name: nameToken.name,
      prompt,
      span: makeSpanFrom(kwToken.span),
    };
  }

  // ─── SEND (E1: refactored to use shared helpers) ───────

  function parseSend(kwToken: KeywordToken): SendNode {
    skipTrivia();

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
      skipTrivia();
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
        skipTrivia();

        switch (modId) {
          case 'Mod.To': {
            if (to !== null) {
              throw new ParseError('duplicate TO modifier', peek().span, 'Mod.To');
            }
            to = toChannelRef(expectChannelRef());
            break;
          }
          case 'Mod.For': {
            const refs = parseRefList('ParticipantRef');
            forList = refs.map(r => r.name);
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
            awaitPolicy = parsePolicy();
            break;
          }
          case 'Mod.Timeout': {
            if (timeout !== null) {
              throw new ParseError('duplicate TIMEOUT modifier', peek().span, 'Mod.Timeout');
            }
            timeout = parseDuration();
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

  // ─── ACTORS / TOOLS ───────────────────────────────────

  function parseNameList(kwToken: KeywordToken, kind: 'Op.Actors'): ActorsNode;
  function parseNameList(kwToken: KeywordToken, kind: 'Op.Tools'): ToolsNode;
  function parseNameList(kwToken: KeywordToken, kind: 'Op.Actors' | 'Op.Tools'): ActorsNode | ToolsNode {
    const names: string[] = [];

    // Determine form: if next non-trivia token on same line is Identifier → inline
    // If next token is Newline → block form
    if (peek().type === 'Newline' || peek().type === 'EOF') {
      // Block form: names on separate lines until END
      while (true) {
        skipTrivia();
        if (isKeyword('Kw.End') || peek().type === 'EOF') break;
        if (peek().type === 'Identifier') {
          names.push((advance() as IdentifierToken).name);
        } else {
          break;
        }
      }
      expectKeyword('Kw.End');
    } else {
      // Inline form: comma-separated on same line
      skipTrivia();
      if (peek().type === 'Identifier') {
        names.push((advance() as IdentifierToken).name);
        while (peek().type === 'Comma') {
          advance();
          skipTrivia();
          if (peek().type === 'Identifier') {
            names.push((advance() as IdentifierToken).name);
          }
        }
      }
    }

    return { kind, names, span: makeSpanFrom(kwToken.span) } as ActorsNode | ToolsNode;
  }

  // ─── DEFINE ────────────────────────────────────────────

  function parseDefine(kwToken: KeywordToken): DefineNode {
    const name = parseBindingName();
    const body = parseBodyValue();
    skipTrivia();
    expectKeyword('Kw.End');
    return { kind: 'Op.Define', name, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── SET ───────────────────────────────────────────────

  function parseSet(kwToken: KeywordToken): SetNode {
    const target = parseValueRef();
    const body = parseBodyValue();
    skipTrivia();
    expectKeyword('Kw.End');
    return { kind: 'Op.Set', target, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── THINK ─────────────────────────────────────────────

  function parseThink(kwToken: KeywordToken): ThinkNode {
    const name = parseBindingName();

    let via: ValueRef | null = null;
    let asRefs: ValueRef[] = [];
    let usingRefs: ToolRef[] = [];
    let goal: TemplateNode | null = null;
    let input: TemplateNode | null = null;
    let context: TemplateNode | null = null;
    let result: ResultField[] = [];
    let body: TemplateNode | null = null;

    let phase: 'rigging' | 'formulation' = 'rigging';
    let resultSeen = false;
    const seen = new Set<AbstractId>();

    while (!isKeyword('Kw.End') && peek().type !== 'EOF') {
      skipTrivia();
      if (isKeyword('Kw.End') || peek().type === 'EOF') break;

      // Anonymous body: TemplateOpen not preceded by a modifier keyword (D-0032)
      if (peek().type === 'TemplateOpen') {
        if (body !== null) {
          throw new ParseError('duplicate anonymous body in THINK block', peek().span, 'Op.Think');
        }
        body = parseTemplate();
        continue;
      }

      const modId = isAnyKeywordOf(THINK_MODIFIERS);
      if (!modId) {
        // Unknown token inside THINK — skip
        advance();
        continue;
      }

      // Body was already parsed — no modifiers after body
      if (body !== null) {
        const dialectWord = lookupDialectWord(modId, dialect);
        throw new ParseError(
          `modifier ${dialectWord} after anonymous body is not allowed (body must be last in block)`,
          peek().span, modId,
        );
      }

      // Check: modifiers after RESULT
      if (resultSeen) {
        const dialectWord = lookupDialectWord(modId, dialect);
        throw new ParseError(
          `modifier ${dialectWord} after RESULT is not allowed (RESULT must be the last modifier)`,
          peek().span, modId,
        );
      }

      // Check duplicate
      if (seen.has(modId)) {
        const dialectWord = lookupDialectWord(modId, dialect);
        throw new ParseError(`duplicate modifier ${dialectWord}`, peek().span, modId);
      }
      seen.add(modId);

      // Check ordering: formulation before rigging
      if (THINK_RIGGING.includes(modId) && phase === 'formulation') {
        const dialectWord = lookupDialectWord(modId, dialect);
        throw new ParseError(
          `rigging modifier ${dialectWord} after formulation modifier is not allowed`,
          peek().span, modId,
        );
      }
      if (THINK_FORMULATION.includes(modId)) {
        phase = 'formulation';
      }

      advance(); // consume modifier keyword
      skipTrivia();

      switch (modId) {
        case 'Mod.Via':
          via = parseValueRef();
          break;
        case 'Mod.As': {
          const refs = parseRefList('ValueRef');
          asRefs = refs.map(r => ({ type: 'ref' as const, name: r.name, path: r.path, span: r.span }));
          break;
        }
        case 'Mod.Using': {
          const refs = parseRefList('ToolRef');
          usingRefs = refs.map(r => ({ name: r.name, span: r.span }));
          break;
        }
        case 'Mod.Goal':
          goal = parseTemplate();
          break;
        case 'Mod.Input':
          input = parseTemplate();
          break;
        case 'Mod.Context':
          context = parseTemplate();
          break;
        case 'Mod.Result':
          result = parseResultBlock();
          resultSeen = true;
          break;
      }
    }

    expectKeyword('Kw.End');

    return {
      kind: 'Op.Think', name, via, as: asRefs, using: usingRefs,
      goal, input, context, result, body,
      span: makeSpanFrom(kwToken.span),
    };
  }

  // ─── EXECUTE ───────────────────────────────────────────

  function parseExecute(kwToken: KeywordToken): ExecuteNode {
    const name = parseBindingName();

    skipTrivia();
    expectKeyword('Mod.Using');
    skipTrivia();

    const toolToken = expect('ToolRef') as ToolRefToken;
    const tool: ToolRef = { name: toolToken.name, span: toolToken.span };

    const args = parseArgList();

    expectKeyword('Kw.End');

    return { kind: 'Op.Execute', name, tool, args, span: makeSpanFrom(kwToken.span) };
  }

  // ─── WAIT ──────────────────────────────────────────────

  function parseWait(kwToken: KeywordToken): WaitNode {
    let name: string | null = null;
    let on: PromiseRef[] = [];
    let mode: 'any' | 'all' | null = null;
    let timeout: DurationValue | null = null;
    const seen = new Set<AbstractId>();

    skipTrivia();
    if (peek().type === 'Identifier') {
      name = (advance() as IdentifierToken).name;
    }

    while (!isKeyword('Kw.End') && peek().type !== 'EOF') {
      skipTrivia();
      if (isKeyword('Kw.End') || peek().type === 'EOF') break;

      const modId = isAnyKeywordOf(WAIT_MODIFIERS);
      if (!modId) {
        advance();
        continue;
      }

      if (seen.has(modId)) {
        const dialectWord = lookupDialectWord(modId, dialect);
        throw new ParseError(`duplicate modifier ${dialectWord}`, peek().span, modId);
      }
      seen.add(modId);

      advance(); // consume modifier keyword
      skipTrivia();

      switch (modId) {
        case 'Mod.On': {
          const refs = parseRefList('PromiseRef');
          on = refs.map(r => ({ name: r.name, span: r.span }));
          break;
        }
        case 'Mod.Mode': {
          const pol = parsePolicy();
          if (pol === 'none') {
            throw new ParseError('WAIT MODE does not accept NONE', peek().span, 'Mod.Mode');
          }
          mode = pol;
          break;
        }
        case 'Mod.Timeout':
          timeout = parseDuration();
          break;
      }
    }

    expectKeyword('Kw.End');

    return { kind: 'Op.Wait', name, on, mode, timeout, span: makeSpanFrom(kwToken.span) };
  }

  // ─── SIGNAL ────────────────────────────────────────────

  function parseSignal(kwToken: KeywordToken): SignalNode {
    skipTrivia();
    const streamToken = expect('StreamRef') as StreamRefToken;
    const target: StreamRef = { name: streamToken.name, span: streamToken.span };

    skipTrivia();
    const body = parseTemplate();

    skipTrivia();
    expectKeyword('Kw.End');

    return { kind: 'Op.Signal', target, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── IF ────────────────────────────────────────────────

  function parseIf(kwToken: KeywordToken): IfNode {
    // Collect raw text of condition from source (R-0019, D-006-1)
    const lineTokens = parseSignatureLine();
    let condition = '';
    if (lineTokens.length > 0) {
      const first = lineTokens[0];
      const last = lineTokens[lineTokens.length - 1];
      const start = first.span.offset;
      const end = last.span.offset + last.span.length;
      condition = source.slice(start, end).trim();
    }

    const body = parseBody();
    expectKeyword('Kw.End');

    return { kind: 'Op.If', condition, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── REPEAT ────────────────────────────────────────────

  function parseRepeat(kwToken: KeywordToken): RepeatNode {
    skipTrivia();

    let until: string | null = null;
    let limit: number;

    if (peek().type === 'NumberLiteral') {
      // Count-only form: REPEAT <count>
      const nl = advance() as NumberLiteralToken;
      limit = nl.value;
    } else if (isKeyword('Mod.Until')) {
      // Until + limit form: REPEAT UNTIL <cond> NO MORE THAN <count>
      advance(); // consume UNTIL

      // Collect condition tokens until we hit Mod.Limit or end of line
      // Filter out Comment tokens to avoid including inline comments in condition
      const condTokens: Token[] = [];
      while (peek().type !== 'Newline' && peek().type !== 'EOF') {
        if (isAnyKeywordOf(['Mod.Limit'])) break;
        if (peek().type === 'Comment') { advance(); continue; }
        condTokens.push(advance());
      }

      if (condTokens.length > 0) {
        const first = condTokens[0];
        const last = condTokens[condTokens.length - 1];
        until = source.slice(first.span.offset, last.span.offset + last.span.length).trim();
      } else {
        until = '';
      }

      // Expect NO MORE THAN — may be on next line
      skipTrivia();
      if (!isAnyKeywordOf(['Mod.Limit'])) {
        throw new ParseError(
          'REPEAT UNTIL requires a limit (NO MORE THAN <count>)',
          peek().span, 'Mod.Limit',
        );
      }
      advance(); // consume NO MORE THAN
      skipTrivia();

      if (peek().type !== 'NumberLiteral') {
        throw new ParseError('expected number after NO MORE THAN', peek().span);
      }
      limit = (advance() as NumberLiteralToken).value;
    } else {
      throw new ParseError('expected number or UNTIL after REPEAT', peek().span, 'Op.Repeat');
    }

    const body = parseBody();
    expectKeyword('Kw.End');

    return { kind: 'Op.Repeat', until, limit, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── EACH ──────────────────────────────────────────────

  function parseEach(kwToken: KeywordToken): EachNode {
    const element = parseValueRef();
    expectKeyword('Mod.From');
    const from = parseValueRef();

    const body = parseBody();
    expectKeyword('Kw.End');

    return { kind: 'Op.Each', element, from, body, span: makeSpanFrom(kwToken.span) };
  }

  // ─── parseBody: recursive operator parsing (D-006-3) ──

  function parseBody(): (OperatorNode | CommentNode)[] {
    const bodyNodes: (OperatorNode | CommentNode)[] = [];

    while (peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'EOF') break;

      // END terminates the body — don't consume it (caller does)
      if (isKeyword('Kw.End')) break;

      // Comments inside body are preserved (D-006-3)
      if (peek().type === 'Comment') {
        const ct = advance() as CommentToken;
        bodyNodes.push({ kind: 'Comment', text: ct.text, span: ct.span });
        continue;
      }

      const opId = isOperator();
      if (opId) {
        const kwToken = advance() as KeywordToken;
        bodyNodes.push(parseOperator(opId, kwToken));
        continue;
      }

      // Skip unexpected tokens inside body
      advance();
    }

    return bodyNodes;
  }

  // ─── Operator dispatch ─────────────────────────────────

  function parseOperator(opId: AbstractId, kwToken: KeywordToken): OperatorNode {
    switch (opId) {
      case 'Op.Receive': return parseReceive(kwToken);
      case 'Op.Send': return parseSend(kwToken);
      case 'Op.Exit': return parseExit(kwToken);
      case 'Op.Actors': return parseNameList(kwToken, 'Op.Actors');
      case 'Op.Tools': return parseNameList(kwToken, 'Op.Tools');
      case 'Op.Define': return parseDefine(kwToken);
      case 'Op.Set': return parseSet(kwToken);
      case 'Op.Think': return parseThink(kwToken);
      case 'Op.Execute': return parseExecute(kwToken);
      case 'Op.Wait': return parseWait(kwToken);
      case 'Op.Signal': return parseSignal(kwToken);
      case 'Op.If': return parseIf(kwToken);
      case 'Op.Repeat': return parseRepeat(kwToken);
      case 'Op.Each': return parseEach(kwToken);
      default:
        // Only Op.Gather remains unsupported
        return skipBlock(kwToken, opId);
    }
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

    // Top-level comment → CommentNode (for COIL-H section dividers)
    if (peek().type === 'Comment') {
      const ct = advance() as CommentToken;
      nodes.push({ kind: 'Comment', text: ct.text, span: ct.span });
      continue;
    }

    const opId = isOperator();
    if (opId) {
      const kwToken = advance() as KeywordToken;
      nodes.push(parseOperator(opId, kwToken));
      continue;
    }

    const t = peek();
    throw new ParseError(`unexpected token at top level: ${t.type}`, t.span);
  }

  return { nodes, dialect: dialect.name };
}

// ─── Dialect-aware diagnostics ─────────────────────────

/** Format a ParseError with dialect-specific keywords */
export function formatError(error: ParseError, dialect: DialectTable): string {
  let msg = error.message;
  if (error.abstractId) {
    const word = lookupDialectWord(error.abstractId, dialect);
    msg = msg.replace(error.abstractId, word);
  }
  return `${msg} (line ${error.span.line}, col ${error.span.col})`;
}
