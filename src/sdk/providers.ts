import type {
  StreamHandle, ExecutionSnapshot,
  ModelCallConfig, ModelResult, ToolResult,
  ParticipantInfo, BudgetVerdict, Message,
} from './types.js';

// ─── ModelProvider (R-0042) ────────────────────────────

/**
 * Provides LLM capabilities for THINK steps.
 *
 * Receives compiled `ResultSchemaField[]` (not raw parser fields).
 * JSON Schema generation or LLM-specific formatting is the provider's responsibility.
 */
export interface ModelProvider {
  /**
   * Call a model with the given configuration.
   * The executor awaits this inline — it is NOT a yield point (R-0051).
   */
  call(config: ModelCallConfig): Promise<ModelResult>;
}

// ─── ToolProvider ──────────────────────────────────────

/**
 * Provides tool invocation for EXECUTE steps.
 *
 * The executor resolves all ArgEntry values before calling invoke (R-0055).
 */
export interface ToolProvider {
  /**
   * Invoke a tool by name with resolved arguments.
   * @param tool — tool name (from !name in the script)
   * @param args — resolved key-value arguments
   */
  invoke(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// ─── ParticipantProvider (D-014-05) ────────────────────

/**
 * Resolves participant references (@name) to identity and metadata.
 * Does NOT deliver messages — delivery is ChannelProvider's responsibility.
 */
export interface ParticipantProvider {
  /**
   * Resolve @name to participant info.
   * @returns null if participant not found.
   */
  resolve(name: string): Promise<ParticipantInfo | null>;
}

// ─── ChannelProvider (D-014-05, R-0044) ────────────────

/**
 * Delivers messages to channels and manages reply correlation.
 *
 * The executor produces payload; the provider wraps it in an envelope (R-0054).
 * For SEND AWAIT, the provider returns a correlationId. The host aggregates
 * replies externally and delivers one ResumeEvent to the executor (R-0044).
 */
export interface ChannelProvider {
  /**
   * Deliver a message to a channel.
   *
   * @param channel — resolved channel address as segments joined by '/', or null for DM (D-014-05)
   * @param participantIds — target audience filter (from SEND FOR)
   * @param payload — message content (string or structured object)
   * @returns correlationId for reply tracking (used by SEND AWAIT)
   */
  deliver(
    channel: string | null,
    participantIds: string[],
    payload: string | Record<string, unknown>,
  ): Promise<{ correlationId: string }>;
}

// ─── StreamProvider (D-014-04, R-0047, R-0048) ────────

/**
 * Manages stream lifecycle: creation, signaling, reading, and closing.
 *
 * Streams are passive handles (D-014-04). All logic lives here.
 * Buffer limit is provider-level config (R-0047), not per-stream.
 * The executor checks isOpen() before each SIGNAL (R-0048).
 */
export interface StreamProvider {
  /**
   * Create a stream for an operator. Returns null if the host decides
   * not to create a stream for this operator (D-0042: host-decided).
   */
  createStream(name: string, ownerId: string): StreamHandle | null;

  /**
   * Send a signal (payload) into the stream buffer.
   * Throws if the buffer is full (overflow → execution error).
   */
  signal(handle: StreamHandle, payload: unknown): void;

  /**
   * Read from the stream. Deferred in v0.4 executor (D-014-06),
   * but the interface is defined for MockRuntime and future use.
   */
  read(handle: StreamHandle): AsyncIterable<unknown>;

  /** Close the stream. Called by executor when the owning promise resolves (R-0056). */
  close(handle: StreamHandle): void;

  /** Check if the stream is still open (R-0048). */
  isOpen(handle: StreamHandle): boolean;
}

// ─── StateProvider ─────────────────────────────────────

/**
 * Persists and restores execution snapshots for pause/resume.
 *
 * The host decides where to store (memory, DB, file).
 * Without a StateProvider, pause/resume is disabled — execute runs to completion.
 */
export interface StateProvider {
  /** Save an execution snapshot. */
  save(id: string, snapshot: ExecutionSnapshot): Promise<void>;

  /** Load a previously saved snapshot. Returns null if not found. */
  load(id: string): Promise<ExecutionSnapshot | null>;
}

// ─── BudgetPolicy (R-0049) ─────────────────────────────

/**
 * Pull-model budget control. Executor asks before each cognitive step.
 * Budget accounting (token counting, cost tracking) is the host's responsibility.
 */
export interface BudgetPolicy {
  /**
   * Check whether a cognitive step of the given kind is allowed.
   * Called before THINK, EXECUTE, and SEND-with-AWAIT.
   */
  check(kind: 'think' | 'execute' | 'send'): BudgetVerdict;
}
