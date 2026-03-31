import { createInterface } from 'node:readline';
import type { Environment } from './environment.js';

/** CLI environment: receive via readline, send via stdout (R-0006) */
export class CliEnvironment implements Environment {
  async receive(prompt: string, options?: { timeout?: number }): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options?.timeout) {
        timer = setTimeout(() => {
          rl.close();
          reject(new Error(`RECEIVE timed out after ${options.timeout}ms`));
        }, options.timeout);
      }
      rl.question(prompt, (answer) => {
        if (timer) clearTimeout(timer);
        rl.close();
        resolve(answer);
      });
    });
  }

  send(body: string): void {
    console.log(body);
  }
}
