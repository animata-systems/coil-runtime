import { createInterface } from 'node:readline';
import type { Environment } from './environment.js';

/** CLI environment: receive via readline, send via stdout (R-0006) */
export class CliEnvironment implements Environment {
  async receive(prompt: string): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  send(body: string): void {
    console.log(body);
  }
}
