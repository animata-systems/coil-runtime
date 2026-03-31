/** Minimal execution environment contract */
export interface Environment {
  /** Prompt user for input, return their response. Timeout in ms (optional). */
  receive(prompt: string, options?: { timeout?: number }): Promise<string>;
  /** Send output to the user */
  send(body: string): void;
}
