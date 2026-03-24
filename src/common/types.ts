/** Source location for diagnostics */
export interface SourceSpan {
  line: number;   // 1-based
  col: number;    // 1-based
  offset: number; // 0-based char offset in source
  length: number;
}

/**
 * Channel address segment — shared between lexer and AST.
 * Can be literal (#support) or dynamic (#$route).
 */
export type ChannelSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'dynamic'; name: string; path: string[] };
