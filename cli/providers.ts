import { createInterface } from 'node:readline';
import type { RuntimeProviders, ToolResult } from '../src/sdk/types.js';
import type { ChannelProvider, ToolProvider } from '../src/sdk/providers.js';
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
 * CLI ToolProvider: built-in tools for smoke-testing.
 *
 *   !время  — returns current date and time (no args)
 *   !эхо    — returns its `текст` argument back (one arg)
 */
class CliToolProvider implements ToolProvider {
  async invoke(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (tool) {
      case 'time':
      case 'время': {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        return { output: stamp };
      }
      case 'echo':
      case 'эхо': {
        return { output: args['text'] ?? args['текст'] ?? null };
      }
      default:
        throw new Error(`Unknown tool: !${tool}`);
    }
  }
}

/**
 * Factory that replaces CliEnvironment (D-014-01).
 * Returns a RuntimeProviders bag for CLI usage with in-memory state.
 */
export function createCLIProviders(): RuntimeProviders {
  return {
    channel: new CliChannelProvider(),
    tool: new CliToolProvider(),
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
    rl.question(prompt + ' ', (answer) => {
      if (timer) clearTimeout(timer);
      rl.close();
      resolve(answer);
    });
  });
}
