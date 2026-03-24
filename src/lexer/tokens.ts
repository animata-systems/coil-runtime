import type { AbstractId } from '../dialect/types.js';

/** Source location for diagnostics */
export interface SourceSpan {
  line: number;   // 1-based
  col: number;    // 1-based
  offset: number; // 0-based char offset in source
  length: number;
}

// ─── Token types ─────────────────────────────────────────

export type Token =
  | KeywordToken
  | IdentifierToken
  | ValueRefToken
  | ParticipantRefToken
  | ChannelRefToken
  | PromiseRefToken
  | ToolRefToken
  | StreamRefToken
  | TemplateOpenToken
  | TemplateCloseToken
  | TextFragmentToken
  | DurationLiteralToken
  | StarToken
  | DashToken
  | ColonToken
  | CommaToken
  | NewlineToken
  | CommentToken
  | EOFToken;

export interface KeywordToken {
  type: 'Keyword';
  ids: AbstractId[];
  span: SourceSpan;
}

export interface IdentifierToken {
  type: 'Identifier';
  name: string;
  span: SourceSpan;
}

/** $name or $name.field.subfield */
export interface ValueRefToken {
  type: 'ValueRef';
  name: string;
  path: string[]; // empty if no dot access
  span: SourceSpan;
}

/** @name */
export interface ParticipantRefToken {
  type: 'ParticipantRef';
  name: string;
  span: SourceSpan;
}

/**
 * #name, #name/path, #$dynamic, #name/$dynamic
 * Segments can be literal strings or $-references.
 */
export interface ChannelRefToken {
  type: 'ChannelRef';
  segments: ChannelSegment[];
  span: SourceSpan;
}

export type ChannelSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'dynamic'; name: string; path: string[] };

/** ?name */
export interface PromiseRefToken {
  type: 'PromiseRef';
  name: string;
  span: SourceSpan;
}

/** !name */
export interface ToolRefToken {
  type: 'ToolRef';
  name: string;
  span: SourceSpan;
}

/** ~name */
export interface StreamRefToken {
  type: 'StreamRef';
  name: string;
  span: SourceSpan;
}

export interface TemplateOpenToken {
  type: 'TemplateOpen';
  span: SourceSpan;
}

export interface TemplateCloseToken {
  type: 'TemplateClose';
  span: SourceSpan;
}

export interface TextFragmentToken {
  type: 'TextFragment';
  value: string;
  span: SourceSpan;
}

export interface DurationLiteralToken {
  type: 'DurationLiteral';
  value: number;
  unitId: AbstractId;
  span: SourceSpan;
}

export interface StarToken {
  type: 'Star';
  span: SourceSpan;
}

export interface DashToken {
  type: 'Dash';
  span: SourceSpan;
}

export interface ColonToken {
  type: 'Colon';
  span: SourceSpan;
}

export interface CommaToken {
  type: 'Comma';
  span: SourceSpan;
}

export interface NewlineToken {
  type: 'Newline';
  span: SourceSpan;
}

export interface CommentToken {
  type: 'Comment';
  text: string;
  span: SourceSpan;
}

export interface EOFToken {
  type: 'EOF';
  span: SourceSpan;
}
