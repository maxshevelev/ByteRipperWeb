/**
 * A small key-value store over IndexedDB.
 *
 * What the browser has instead of a preferences file. Bookmarks need it first
 * (a reload keeps them, ANALYSIS.md § Bookmarks), and the settings and the
 * pattern library need the same thing later, so it is a store of its own rather
 * than something the bookmarks own.
 *
 * IndexedDB rather than `localStorage` for the two reasons that matter here: it
 * is asynchronous, so writing a workspace's marks never blocks a repaint, and
 * it holds structured values, so nothing has to be stringified on the way in
 * and re-validated on the way out.
 *
 * **It never throws.** A browser in private mode, with storage disabled, or
 * with a database it refuses to upgrade, is a browser where persistence is
 * absent — not one where the app should stop working. Every failure falls back
 * to memory, which keeps the value for the life of the page and loses it after,
 * and {@link KeyValueStore.isPersistent} says which of the two happened so an
 * interface that promised otherwise can stop promising it.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  entries<T>(): Promise<{ key: string; value: T }[]>;
  /** False when this store is memory standing in for a database that is absent. */
  isPersistent(): Promise<boolean>;
}

const STORE_NAME = "values";

export function openKeyValueStore(databaseName: string): KeyValueStore {
  // One open per store, shared by every call, and retried never: a database
  // that would not open will not open on the second ask either, and asking
  // again on every keystroke is how a blocked upgrade becomes a hang.
  let opening: Promise<IDBDatabase | undefined> | undefined;
  const fallback = new Map<string, unknown>();

  const database = (): Promise<IDBDatabase | undefined> => {
    opening ??= openDatabase(databaseName);
    return opening;
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const db = await database();
      if (db === undefined) return fallback.get(key) as T | undefined;
      return await request<T | undefined>(db, "readonly", (store) => store.get(key)).catch(
        () => fallback.get(key) as T | undefined
      );
    },

    async put(key: string, value: unknown): Promise<void> {
      const db = await database();
      if (db === undefined) {
        fallback.set(key, value);
        return;
      }
      await request(db, "readwrite", (store) => store.put(value, key)).catch(() => {
        // A quota refusal, or a value that would not structured-clone. Keeping
        // it in memory is the same answer as having no database at all.
        fallback.set(key, value);
      });
    },

    async remove(key: string): Promise<void> {
      fallback.delete(key);
      const db = await database();
      if (db === undefined) return;
      await request(db, "readwrite", (store) => store.delete(key)).catch(() => undefined);
    },

    async entries<T>(): Promise<{ key: string; value: T }[]> {
      const db = await database();
      if (db === undefined) {
        return [...fallback].map(([key, value]) => ({ key, value: value as T }));
      }
      try {
        const keys = await request<IDBValidKey[]>(db, "readonly", (store) => store.getAllKeys());
        const values = await request<T[]>(db, "readonly", (store) => store.getAll());
        return keys.map((key, index) => ({ key: String(key), value: values[index] as T }));
      } catch {
        return [...fallback].map(([key, value]) => ({ key, value: value as T }));
      }
    },

    async isPersistent(): Promise<boolean> {
      return (await database()) !== undefined;
    },
  };
}

/** An in-memory store, for tests and for wherever a real one is the wrong ask. */
export function memoryKeyValueStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
    entries: async <T>() => [...values].map(([key, value]) => ({ key, value: value as T })),
    isPersistent: async () => false,
  };
}

function openDatabase(name: string): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(name, 1);
    } catch {
      resolve(undefined);
      return;
    }
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME))
        open.result.createObjectStore(STORE_NAME);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(undefined);
    // A second tab holding an older version open blocks the upgrade. There is
    // no one to ask to close it, so this page goes without rather than waiting.
    open.onblocked = () => resolve(undefined);
  });
}

function request<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = run(transaction.objectStore(STORE_NAME));
    result.onsuccess = () => resolve(result.result as T);
    result.onerror = () => reject(result.error ?? new Error("The store refused the request."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The write was aborted."));
  });
}
