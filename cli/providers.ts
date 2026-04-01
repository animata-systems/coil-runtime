import { createInterface } from 'node:readline';
import type { RuntimeProviders } from '../src/sdk/types.js';
import type { ChannelProvider } from '../src/sdk/providers.js';
import { InMemoryStateProvider } from '../src/sdk/in-memory-state.js';

/**
 * CLI ChannelProvider: SEND without address → stdout (R-0006).
 */
class CliChannelProvider implements ChannelProvider {
  async deliver(
    _channel: string | null,
    _participantIds: string[],
    payload: string | Record<string, unknown>,
  ): Promise<{ correlationId: string }> {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    console.log(text);
    return { correlationId: 'cli' };
  }
}

/**
 * Factory that replaces CliEnvironment (D-014-01).
 * Returns a RuntimeProviders bag for CLI usage with in-memory state.
 */
export function createCLIProviders(): RuntimeProviders {
  return {
    channel: new CliChannelProvider(),
    state: new InMemoryStateProvider(),
  };
}

/**
 * Prompt the user via readline for RECEIVE yield handling.
 * Used by the CLI run loop to resolve ReceiveValue events.
 */
export async function cliReceive(prompt: string, timeout?: number): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeout) {
      timer = setTimeout(() => {
        rl.close();
        reject(new Error(`RECEIVE timed out after ${timeout}ms`));
      }, timeout);
    }
    rl.question(prompt, (answer) => {
      if (timer) clearTimeout(timer);
      rl.close();
      resolve(answer);
    });
  });
}
