import { useSyncExternalStore } from "react";
import type { Store } from "@/state/store";

/** Subscribes a component to a store (D8). */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Subscribes to one slice of a store, re-rendering only when that slice changes. */
export function useStoreSelector<T, S>(store: Store<T>, select: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(store.getSnapshot())
  );
}
