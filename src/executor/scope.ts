/**
 * Executor scope with parent chain for nested blocks (R-0036).
 *
 * IF / REPEAT execute in the current scope.
 * EACH creates a child scope per iteration (D-0045).
 */
export class Scope {
  private readonly parent: Scope | null;
  private readonly bindings: Map<string, unknown>;

  constructor(parent: Scope | null = null) {
    this.parent = parent;
    this.bindings = new Map();
  }

  /** Look up a variable by name, walking up the chain. */
  get(name: string): unknown {
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  /** Set a variable in the current scope level. */
  set(name: string, value: unknown): void {
    this.bindings.set(name, value);
  }

  /** Check if a variable exists anywhere in the chain. */
  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  /** Create a child scope with this scope as parent. */
  child(): Scope {
    return new Scope(this);
  }
}
