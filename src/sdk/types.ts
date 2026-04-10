import type { ResultSchemaField } from '../result/schema.js';
import type {
  ModelProvider, ToolProvider, ParticipantProvider,
  ChannelProvider, StreamProvider, StateProvider, BudgetPolicy,
} from './providers.js';

// ─── Stream handle (D-014-04) ──────────────────────────

/**
 * Passive data identifying a stream. All logic (buffer, signal, read, close)
 * lives in StreamProvider. Handle is JSON-serializable for snapshots.
 */
export interface StreamHandle {
  name: string;
  ownerId: string;
}

// ─── Program counter (R-0041) ──────────────────────────

/**
 * One segment of the program counter path.
 * `node` — index in the current node array.
 * `iteration` — present only for EACH (and future iterable constructs).
 */
export interface PathSegment {
  node: number;
  iteration?: number;
}

/** Program counter: path from script root to the current execution point. */
export type ProgramCounter = PathSegment[];

// ─── Promise registry (R-0043) ─────────────────────────

/**
 * Entry in the promise registry within an ExecutionSnapshot.
 * Tracks whether a promise created by THINK/EXECUTE/SEND is pending or resolved.
 */
export interface PromiseEntry {
  status: 'pending' | 'resolved';
  origin: 'think' | 'execute' | 'send';
  /** Present when status === 'resolved'. */
  result?: unknown;
  /** ChannelProvider correlation ID, present for SEND-originated promises (R-0044). */
  correlationId?: string;
}

// ─── Scope snapshot (D-014-03) ─────────────────────────

/**
 * Serializable representation of a scope chain.
 * Nested tree — `JSON.parse` restores the chain as-is.
 * Depth is 2–3 levels in practice.
 */
export interface ScopeSnapshot {
  variables: Record<string, unknown>;
  parent: ScopeSnapshot | null;
}

// ─── Execution snapshot (R-0040, R-0046) ───────────────

/**
 * Complete executor state at a yield point.
 * JSON-serializable. Does NOT contain provider state (R-0046).
 */
export interface ExecutionSnapshot {
  /** Program counter — typed path segments (R-0041). */
  pc: ProgramCounter;
  /** Nested scope chain (D-014-03). */
  scope: ScopeSnapshot;
  /** Promise registry (R-0043). */
  promises: Record<string, PromiseEntry>;
  /** Mapping from promise name to its associated stream handle, if any (R-0056).
   *  Active streams are derived from values of this map. */
  promiseStreamMap: Record<string, StreamHandle>;
  /** Budget consumed so far — opaque counters, host interprets. */
  budgetConsumed: Record<string, number>;
}

// ─── Message (D-0037, R-0054) ──────────────────────────

/**
 * Two-layer message: envelope (host-defined metadata) + payload (content).
 * Executor produces payload; host wraps in envelope.
 * Returned in ResumeEvent when a reply arrives.
 */
export interface Message {
  /** Host-defined metadata: sender, timestamp, routing info, etc. */
  envelope: Record<string, unknown>;
  /** Content: text or structured object (D-0037). */
  payload: string | Record<string, unknown>;
}

// ─── Resume events (D-014-02) ──────────────────────────

/**
 * Discriminated union of events the host sends to resume a yielded executor.
 * Each yield point expects a specific event type.
 */
export type ResumeEvent =
  | ReceiveValue
  | PromiseResolved
  | MessageReply
  | StreamEvent
  | Timeout;

/** Host provides a value for RECEIVE. */
export interface ReceiveValue {
  type: 'ReceiveValue';
  value: string;
}

/** A promise (?name) has been resolved by a provider. */
export interface PromiseResolved {
  type: 'PromiseResolved';
  promiseName: string;
  result: unknown;
}

/** Replies collected for SEND AWAIT (R-0044). */
export interface MessageReply {
  type: 'MessageReply';
  correlationId: string;
  replies: Message[];
}

/** A stream event arrived (future use — deferred per D-014-06). */
export interface StreamEvent {
  type: 'StreamEvent';
  streamName: string;
  payload: unknown;
}

/** Timeout expired for a blocking operation. */
export interface Timeout {
  type: 'Timeout';
}

// ─── Yield request (R-0051, R-0053) ────────────────────

/** Detail carried by each yield request type. */
export type YieldDetail =
  | { type: 'receive'; variableName: string; prompt: string | null; timeoutMs: number | null }
  | { type: 'wait-promises'; promiseNames: string[]; mode: 'any' | 'all' }
  | { type: 'await-replies'; correlationId: string; awaitPolicy: 'any' | 'all'; promiseName: string };

/**
 * Executor yields: saves snapshot and returns control to the host.
 * Host inspects `detail` to know what external action is needed,
 * then calls `resume(snapshot, event)`.
 */
export interface YieldRequest {
  type: 'yield';
  snapshot: ExecutionSnapshot;
  detail: YieldDetail;
}

// ─── Execution result (R-0053) ─────────────────────────

/** Script reached EXIT — execution completed successfully. */
export interface ExecutionResult {
  type: 'completed';
}

// ─── Budget verdict (R-0049) ───────────────────────────

export type BudgetVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

// ─── Participant info ──────────────────────────────────

/** Resolved participant identity returned by ParticipantProvider. */
export interface ParticipantInfo {
  id: string;
  metadata: Record<string, unknown>;
}

// ─── Model call config (R-0042) ────────────────────────

/** Configuration passed to ModelProvider.call() for a THINK step. */
export interface ModelCallConfig {
  /** Model reference resolved from VIA modifier, or null for default. */
  via: string | null;
  /** Role qualifications from AS modifier. */
  as: string[];
  /** Available tools from USING modifier. */
  using: string[];
  /** Goal text from GOAL modifier. */
  goal: string | null;
  /** Input text from INPUT modifier. */
  input: string | null;
  /** Context text from CONTEXT modifier. */
  context: string | null;
  /** Compiled result schema (R-0042). Null if no RESULT block. */
  resultSchema: ResultSchemaField[] | null;
  /** Anonymous body text (D-0032). */
  body: string | null;
}

/** Result returned by ModelProvider.call(). */
export interface ModelResult {
  /** Structured or text output from the model. */
  output: unknown;
  /** Optional usage metadata for budget tracking. */
  usage?: Record<string, number>;
}

// ─── Tool invocation (R-0055) ──────────────────────────

/** Result returned by ToolProvider.invoke(). */
export interface ToolResult {
  /** Output from the tool — arbitrary structured data. */
  output: unknown;
}

// ─── Runtime providers bag (R-0052) ────────────────────

/**
 * All providers are optional — executor checks on demand (R-0052).
 * Missing provider at the point of use → HostError.
 */
export interface RuntimeProviders {
  model?: ModelProvider;
  tool?: ToolProvider;
  participant?: ParticipantProvider;
  channel?: ChannelProvider;
  stream?: StreamProvider;
  state?: StateProvider;
  budget?: BudgetPolicy;
}
