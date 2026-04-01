import type { StateProvider } from './providers.js';
import type { ExecutionSnapshot } from './types.js';

/**
 * In-memory StateProvider for stateful hosting (CLI, long-running server).
 * Snapshots are stored in a Map — lost on process restart.
 */
export class InMemoryStateProvider implements StateProvider {
  private readonly store = new Map<string, ExecutionSnapshot>();

  async save(id: string, snapshot: ExecutionSnapshot): Promise<void> {
    // Deep clone to avoid mutation after save
    this.store.set(id, JSON.parse(JSON.stringify(snapshot)));
  }

  async load(id: string): Promise<ExecutionSnapshot | null> {
    const snapshot = this.store.get(id);
    return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
  }
}
