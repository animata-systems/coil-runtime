/** Minimal execution environment contract */
export interface Environment {
  /** Prompt user for input, return their response */
  receive(prompt: string): Promise<string>;
  /** Send output to the user */
  send(body: string): void;
}
