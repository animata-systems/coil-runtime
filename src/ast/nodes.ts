import type { SourceSpan, ChannelSegment } from '../common/types.js';
import type { AbstractId } from '../dialect/types.js';

// ─── Channel reference (AST-level) ──────────────────────

export interface ChannelRef {
  segments: ChannelSegment[];
  span: SourceSpan;
}

// ─── Template ────────────────────────────────────────────

export interface TemplatePart {
  type: 'text' | 'ref';
}

export interface TextPart extends TemplatePart {
  type: 'text';
  value: string;
  span: SourceSpan;
}

export interface RefPart extends TemplatePart {
  type: 'ref';
  name: string;
  path: string[];
  span: SourceSpan;
}

export interface TemplateNode {
  parts: (TextPart | RefPart)[];
  span: SourceSpan;
}

// ─── Duration ────────────────────────────────────────────

export interface DurationValue {
  value: number;
  unitId: AbstractId;
  span: SourceSpan;
}

// ─── Operator nodes (R-0005) ─────────────────────────────

export type OperatorNode =
  | ReceiveNode
  | SendNode
  | ExitNode
  | UnsupportedOperatorNode;

export interface ReceiveNode {
  kind: 'Op.Receive';
  name: string;
  prompt: TemplateNode | null;
  span: SourceSpan;
}

export interface SendNode {
  kind: 'Op.Send';
  name: string | null;
  to: ChannelRef | null;
  for: string[];           // participant names
  replyTo: ChannelRef | null;
  await: 'none' | 'any' | 'all' | null;
  timeout: DurationValue | null;
  body: TemplateNode | null;
  span: SourceSpan;
}

export interface ExitNode {
  kind: 'Op.Exit';
  span: SourceSpan;
}

/** R-0011: parser skips unimplemented operators, validator reports error */
export interface UnsupportedOperatorNode {
  kind: 'Unsupported';
  operatorId: AbstractId;
  span: SourceSpan;
}

// ─── Comment ────────────────────────────────────────────

/** Top-level comment preserved for COIL-H section dividers (spec/11-coil-h.md § 11.6) */
export interface CommentNode {
  kind: 'Comment';
  text: string;
  span: SourceSpan;
}

// ─── Script ──────────────────────────────────────────────

export interface ScriptNode {
  nodes: (OperatorNode | CommentNode)[];
  dialect: string; // dialect name
}
