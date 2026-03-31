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
  type: 'template';
  parts: (TextPart | RefPart)[];
  span: SourceSpan;
}

// ─── Duration ────────────────────────────────────────────

export interface DurationValue {
  value: number;
  unitId: AbstractId;
  span: SourceSpan;
}

// ─── Value types (AST-level) ────────────────────────────

export interface ValueRef {
  type: 'ref';
  name: string;
  path: string[];
  span: SourceSpan;
}

export interface ToolRef {
  name: string;
  span: SourceSpan;
}

export interface PromiseRef {
  name: string;
  span: SourceSpan;
}

export interface StreamRef {
  name: string;
  span: SourceSpan;
}

export interface StringLiteral {
  type: 'string';
  value: string;
  span: SourceSpan;
}

export interface NumberLiteral {
  type: 'number';
  value: number;
  span: SourceSpan;
}

export interface BooleanLiteral {
  type: 'boolean';
  value: boolean;
  span: SourceSpan;
}

/** Body of DEFINE/SET: template, reference, or literal */
export type BodyValue = TemplateNode | ValueRef | NumberLiteral | StringLiteral | BooleanLiteral;

/** Argument entry for EXECUTE: - key: value */
export interface ArgEntry {
  key: string;
  value: ValueRef | StringLiteral | NumberLiteral;
  span: SourceSpan;
}

/** Field in RESULT microsyntax (spec/05-structured-output.md) */
export interface ResultField {
  name: string;
  typeId: AbstractId;
  typeArgs: string[];     // CHOICE options
  description: string;
  depth: number;          // 0 = top-level, 1+ = nested under LIST
  span: SourceSpan;
}

// ─── Operator nodes (R-0005) ─────────────────────────────

export type OperatorNode =
  | ReceiveNode
  | SendNode
  | ExitNode
  | ActorsNode
  | ToolsNode
  | DefineNode
  | SetNode
  | ThinkNode
  | ExecuteNode
  | WaitNode
  | SignalNode
  | IfNode
  | RepeatNode
  | EachNode
  | UnsupportedOperatorNode;

export interface ReceiveNode {
  kind: 'Op.Receive';
  name: string;
  prompt: TemplateNode | null;
  timeout: DurationValue | null;
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

// ─── Instantaneous operators ────────────────────────────

export interface ActorsNode {
  kind: 'Op.Actors';
  names: string[];
  span: SourceSpan;
}

export interface ToolsNode {
  kind: 'Op.Tools';
  names: string[];
  span: SourceSpan;
}

export interface DefineNode {
  kind: 'Op.Define';
  name: string;
  body: BodyValue;
  span: SourceSpan;
}

export interface SetNode {
  kind: 'Op.Set';
  target: ValueRef;
  body: BodyValue;
  span: SourceSpan;
}

// ─── Launching operators ────────────────────────────────

export interface ThinkNode {
  kind: 'Op.Think';
  name: string;
  via: ValueRef | null;
  as: ValueRef[];
  using: ToolRef[];
  goal: TemplateNode | null;
  input: TemplateNode | null;
  context: TemplateNode | null;
  result: ResultField[];
  body: TemplateNode | null;    // anonymous body (D-0032)
  span: SourceSpan;
}

export interface ExecuteNode {
  kind: 'Op.Execute';
  name: string;
  tool: ToolRef;
  args: ArgEntry[];
  span: SourceSpan;
}

export interface SignalNode {
  kind: 'Op.Signal';
  target: StreamRef;
  body: TemplateNode;
  span: SourceSpan;
}

// ─── Blocking operators ─────────────────────────────────

export interface WaitNode {
  kind: 'Op.Wait';
  name: string | null;
  on: PromiseRef[];
  mode: 'any' | 'all' | null;
  timeout: DurationValue | null;
  span: SourceSpan;
}

// ─── Expression nodes (R-0035) ──────────────────────────

export type ComparisonOp = '=' | '<' | '>' | '<=' | '>=';
export type LogicOp = 'And' | 'Or';

export type ExpressionNode =
  | BinaryExpr
  | UnaryExpr
  | GroupExpr
  | LiteralExpr
  | VarRefExpr;

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: ComparisonOp | LogicOp;
  left: ExpressionNode;
  right: ExpressionNode;
  span: SourceSpan;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: 'Not';
  operand: ExpressionNode;
  span: SourceSpan;
}

export interface GroupExpr {
  kind: 'GroupExpr';
  inner: ExpressionNode;
  span: SourceSpan;
}

export interface LiteralExpr {
  kind: 'LiteralExpr';
  value: string | number | boolean;
  literalType: 'string' | 'number' | 'boolean';
  span: SourceSpan;
}

export interface VarRefExpr {
  kind: 'VarRefExpr';
  name: string;
  path: string[];
  span: SourceSpan;
}

// ─── Control-flow operators (Extended) ──────────────────

export interface IfNode {
  kind: 'Op.If';
  condition: ExpressionNode;
  body: (OperatorNode | CommentNode)[];
  span: SourceSpan;
}

export interface RepeatNode {
  kind: 'Op.Repeat';
  until: ExpressionNode | null;  // null for count-only form
  limit: number;
  body: (OperatorNode | CommentNode)[];
  span: SourceSpan;
}

export interface EachNode {
  kind: 'Op.Each';
  element: ValueRef;
  from: ValueRef;
  body: (OperatorNode | CommentNode)[];
  span: SourceSpan;
}

// ─── Unsupported ────────────────────────────────────────

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
