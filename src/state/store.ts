/**
 * The store, in about forty lines.
 *
 * Decision D8: state lives outside the React tree anyway — workers and an
 * imperative renderer own most of it — so React subscribes to it through
 * `useSyncExternalStore` rather than holding it. A state library would be a
 * dependency for less than this file.
 *
 * Snapshots are replaced, never mutated: `useSyncExternalStore` compares by
 * identity, and a mutated object is a render that never happens.
 */

export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  /** Replaces the snapshot. A producer that returns the same value is a no-op. */
  update(produce: (current: T) => T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(produce) {
      const next = produce(snapshot);
      if (Object.is(next, snapshot)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}
