import { type JournalStore, setJournalStoreProvider } from "@/core/edit/undoJournal";
import type { KeptFile, KeptFolder } from "@/core/workspace/keptFolder";
import { holdForThisPage, OpfsScratchStore } from "@/platform/files/opfsScratchStore";
import type { JournalWorkerRequest, JournalWorkerResponse } from "@/workers/protocol";

/**
 * An undo journal's file in the origin-private file system, written by `journal.worker.ts`.
 *
 * Named as this page's scratch is — one prefix the page holds while it lives — so the sweep at
 * startup removes what a page that ended badly left behind, and leaves another live page's files
 * be.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.init
 * @upstream-differs a file the page names and removes when it lets the journal go, where upstream
 * unlinks the file the moment it opens it
 */
export class OpfsJournalStore implements JournalStore {
  private readonly name: string;

  constructor() {
    this.name = `${pagePrefix()}-${counter++}.bin`;
  }

  write(at: number, bytes: Uint8Array): Promise<void> {
    return ask({ kind: "write", id: nextId++, name: this.name, at, bytes }).then(() => undefined);
  }

  read(at: number, count: number): Promise<Uint8Array> {
    return ask({ kind: "read", id: nextId++, name: this.name, at, count }).then(
      (bytes) => (bytes as Uint8Array | undefined) ?? new Uint8Array(0)
    );
  }

  close(): void {
    worker()?.postMessage({ kind: "close", name: this.name } satisfies JournalWorkerRequest);
  }
}

let prefix: string | undefined;
let counter = 0;
let nextId = 1;

/** The prefix this page's journals are named under, held while the page lives. */
function pagePrefix(): string {
  if (prefix === undefined) {
    prefix = `scratch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    holdForThisPage(prefix);
  }
  return prefix;
}

let held: Worker | undefined;
const waiting = new Map<
  number,
  { resolve: (answer: unknown) => void; reject: (error: Error) => void }
>();

function worker(): Worker | undefined {
  if (held === undefined) {
    held = new Worker(new URL("../../workers/journal.worker.ts", import.meta.url), {
      type: "module",
    });
    held.addEventListener("message", (event: MessageEvent<JournalWorkerResponse>) => {
      const response = event.data;
      const one = waiting.get(response.id);
      waiting.delete(response.id);
      if (response.kind === "failed") one?.reject(new Error(response.message));
      else
        one?.resolve(
          response.kind === "read"
            ? response.bytes
            : response.kind === "size"
              ? response.size
              : undefined
        );
    });
  }
  return held;
}

function ask(request: Extract<JournalWorkerRequest, { id: number }>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    waiting.set(request.id, { resolve, reject });
    // A write's bytes are copied rather than transferred: the journal keeps them until the write
    // has landed, and answers reads from them meanwhile.
    worker()?.postMessage(request);
  });
}

/**
 * A workspace's `Kept/` in the origin-private file system: the folder `kept-<id>`, written by the
 * journal worker. A kept file outlives its journal: letting a journal go lets go of the file's
 * handle, and the file goes only when no written workspace names it.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.keptFolder
 * @upstream-differs a folder of the origin-private file system, the session having no other disk
 */
export class OpfsKeptFolder implements KeptFolder {
  readonly id: string;
  private readonly folder: string;

  constructor(workspace: string) {
    this.folder = `kept-${workspace}`;
    this.id = `opfs:${this.folder}`;
  }

  file(name: string): KeptFile {
    const path = `${this.folder}/${name}`;
    return {
      write: (at, bytes) =>
        ask({ kind: "write", id: nextId++, name: path, at, bytes }).then(() => undefined),
      read: (at, count) =>
        ask({ kind: "read", id: nextId++, name: path, at, count }).then(
          (bytes) => (bytes as Uint8Array | undefined) ?? new Uint8Array(0)
        ),
      truncate: (length) =>
        ask({ kind: "truncate", id: nextId++, name: path, at: length }).then(() => undefined),
      // The worker flushes every write before it answers.
      synchronize: async () => undefined,
      size: () => ask({ kind: "size", id: nextId++, name: path }) as Promise<number | undefined>,
      close: () => void ask({ kind: "release", id: nextId++, name: path }).catch(() => undefined),
    };
  }

  async removeExcept(names: ReadonlySet<string>): Promise<void> {
    await ask({ kind: "sweep", id: nextId++, folder: this.folder, keep: [...names] });
  }

  /** The whole folder: the session it kept was discarded. */
  async remove(): Promise<void> {
    await ask({ kind: "sweep", id: nextId++, folder: this.folder });
  }

  /**
   * Every workspace's kept folder: the switch turned off, so none comes back months later — but
   * `except`'s, a newer build's.
   */
  static async removeAll(except?: string): Promise<void> {
    if (!OpfsKeptFolder.isAvailable()) return;
    const root = (await navigator.storage.getDirectory().catch(() => undefined)) as
      | (FileSystemDirectoryHandle & { keys?: () => AsyncIterableIterator<string> })
      | undefined;
    if (root?.keys === undefined) return;
    const folders: string[] = [];
    const kept = except === undefined ? undefined : `kept-${except}`;
    for await (const name of root.keys()) {
      if (name.startsWith("kept-") && name !== kept) folders.push(name);
    }
    for (const folder of folders) {
      await ask({ kind: "sweep", id: nextId++, folder }).catch(() => undefined);
    }
  }

  /** Whether kept folders can be had here at all. */
  static isAvailable(): boolean {
    return OpfsScratchStore.isAvailable() && typeof Worker !== "undefined";
  }
}

/**
 * Has every undo history keep its bytes in the origin-private file system, where the page has
 * one and may run a worker; elsewhere the journals stay in memory, as they are in a test.
 */
export function installOpfsJournals(): void {
  if (!OpfsScratchStore.isAvailable() || typeof Worker === "undefined") return;
  setJournalStoreProvider(() => new OpfsJournalStore());
}
