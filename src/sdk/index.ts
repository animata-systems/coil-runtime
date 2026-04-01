// Error taxonomy (R-0050)
export {
  CoilError, PreparationError, ExecutionError,
  NotImplementedError, HostError,
} from './errors.js';

// Provider interfaces
export type {
  ModelProvider, ToolProvider, ParticipantProvider,
  ChannelProvider, StreamProvider, StateProvider, BudgetPolicy,
} from './providers.js';

// SDK data types
export type {
  StreamHandle, PathSegment, ProgramCounter,
  PromiseEntry, ScopeSnapshot, ExecutionSnapshot,
  Message,
  ResumeEvent, ReceiveValue, PromiseResolved, MessageReply, StreamEvent, Timeout,
  YieldDetail, YieldRequest, ExecutionResult,
  BudgetVerdict, ParticipantInfo,
  ModelCallConfig, ModelResult, ToolResult,
  RuntimeProviders,
} from './types.js';

// Helpers
export { resolveAwaitPolicy } from './helpers.js';

// Implementations
export { InMemoryStateProvider } from './in-memory-state.js';
export {
  MockModelProvider, MockToolProvider, MockParticipantProvider,
  MockChannelProvider, MockStreamProvider, MockBudgetPolicy,
  createMockProviders,
} from './mock-runtime.js';
export type { MockRuntimeOptions } from './mock-runtime.js';
