import type { SourceSpan } from '../common/types.js';

/**
 * Base class for all COIL runtime errors (R-0050).
 *
 * Three categories:
 * - PreparationError — before execution (validation, compilation)
 * - ExecutionError   — during a step (timeout, missing property, budget, signal-after-close)
 * - HostError        — from a provider (model failure, tool rejection, channel unavailable)
 */
export abstract class CoilError extends Error {
  /** Source location of the construct that caused the error, if available. */
  readonly span: SourceSpan | null;

  constructor(message: string, span: SourceSpan | null) {
    super(message);
    this.span = span;
  }
}

/**
 * Error detected before execution begins — validation, schema compilation, etc.
 */
export class PreparationError extends CoilError {
  readonly name = 'PreparationError';

  constructor(message: string, span: SourceSpan) {
    super(message, span);
  }
}

/**
 * Error during execution of a step — timeout, missing property, budget exceeded,
 * signal after close, variable not defined, etc.
 */
export class ExecutionError extends CoilError {
  readonly name = 'ExecutionError';

  constructor(message: string, span: SourceSpan) {
    super(message, span);
  }
}

/**
 * Operator is recognized but not implemented in this runtime version (R-0011).
 */
export class NotImplementedError extends ExecutionError {
  constructor(feature: string, span: SourceSpan) {
    super(`not implemented: ${feature}`, span);
  }
}

/**
 * Error originating from a provider — model failure, tool rejection,
 * channel unavailable, network error, etc.
 *
 * `span` may be null when the error originates outside AST context
 * (e.g., network failure in ModelProvider). Uses ES2022 Error.cause
 * to preserve the original provider error.
 */
export class HostError extends CoilError {
  readonly name = 'HostError';

  constructor(message: string, span: SourceSpan | null, options?: { cause?: unknown }) {
    super(message, span);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
