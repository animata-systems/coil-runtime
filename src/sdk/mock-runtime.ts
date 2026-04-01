import type {
  ModelProvider, ToolProvider, ParticipantProvider,
  ChannelProvider, StreamProvider, BudgetPolicy,
} from './providers.js';
import type {
  RuntimeProviders, ModelCallConfig, ModelResult,
  ToolResult, ParticipantInfo, StreamHandle, BudgetVerdict,
} from './types.js';
import { InMemoryStateProvider } from './in-memory-state.js';

// ─── Mock providers ────────────────────────────────────

/** Mock ModelProvider that returns a canned response. */
export class MockModelProvider implements ModelProvider {
  private responses: ModelResult[];
  private callIndex = 0;

  constructor(responses: ModelResult[] = [{ output: 'mock-model-output' }]) {
    this.responses = responses;
  }

  async call(_config: ModelCallConfig): Promise<ModelResult> {
    const result = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    return result;
  }
}

/** Mock ToolProvider that returns a canned response. */
export class MockToolProvider implements ToolProvider {
  private responses: Record<string, ToolResult>;

  constructor(responses: Record<string, ToolResult> = {}) {
    this.responses = responses;
  }

  async invoke(tool: string, _args: Record<string, unknown>): Promise<ToolResult> {
    return this.responses[tool] ?? { output: `mock-${tool}-output` };
  }
}

/** Mock ParticipantProvider that resolves all names to mock info. */
export class MockParticipantProvider implements ParticipantProvider {
  async resolve(name: string): Promise<ParticipantInfo | null> {
    return { id: `mock-${name}`, metadata: {} };
  }
}

/** Mock ChannelProvider that records deliveries. */
export class MockChannelProvider implements ChannelProvider {
  readonly deliveries: Array<{
    channel: string | null;
    participantIds: string[];
    payload: string | Record<string, unknown>;
  }> = [];

  private correlationCounter = 0;

  async deliver(
    channel: string | null,
    participantIds: string[],
    payload: string | Record<string, unknown>,
  ): Promise<{ correlationId: string }> {
    this.deliveries.push({ channel, participantIds, payload });
    return { correlationId: `corr-${++this.correlationCounter}` };
  }
}

/** Mock StreamProvider with in-memory buffers. */
export class MockStreamProvider implements StreamProvider {
  private streams = new Map<string, { open: boolean; buffer: unknown[] }>();

  createStream(name: string, _ownerId: string): StreamHandle | null {
    this.streams.set(name, { open: true, buffer: [] });
    return { name, ownerId: _ownerId };
  }

  signal(handle: StreamHandle, payload: unknown): void {
    const stream = this.streams.get(handle.name);
    if (!stream || !stream.open) throw new Error(`stream ${handle.name} is closed`);
    stream.buffer.push(payload);
  }

  async *read(handle: StreamHandle): AsyncIterable<unknown> {
    const stream = this.streams.get(handle.name);
    if (!stream) return;
    for (const item of stream.buffer) {
      yield item;
    }
  }

  close(handle: StreamHandle): void {
    const stream = this.streams.get(handle.name);
    if (stream) stream.open = false;
  }

  isOpen(handle: StreamHandle): boolean {
    const stream = this.streams.get(handle.name);
    return stream?.open ?? false;
  }
}

/** Mock BudgetPolicy that always allows. */
export class MockBudgetPolicy implements BudgetPolicy {
  check(_kind: 'think' | 'execute' | 'send'): BudgetVerdict {
    return { allowed: true };
  }
}

// ─── MockRuntime factory ───────────────────────────────

export interface MockRuntimeOptions {
  model?: ModelProvider;
  tool?: ToolProvider;
  participant?: ParticipantProvider;
  channel?: MockChannelProvider;
  stream?: StreamProvider;
  budget?: BudgetPolicy;
}

/**
 * Create a full set of mock providers for testing.
 * All providers default to permissive mocks.
 */
export function createMockProviders(options: MockRuntimeOptions = {}): RuntimeProviders & { channel: MockChannelProvider } {
  const channel = options.channel ?? new MockChannelProvider();
  return {
    model: options.model ?? new MockModelProvider(),
    tool: options.tool ?? new MockToolProvider(),
    participant: options.participant ?? new MockParticipantProvider(),
    channel,
    stream: options.stream ?? new MockStreamProvider(),
    state: new InMemoryStateProvider(),
    budget: options.budget ?? new MockBudgetPolicy(),
  };
}
