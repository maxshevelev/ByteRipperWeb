import { type JournalStore, setJournalStoreProvider } from "@/core/edit/undoJournal";
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
      (bytes) => bytes ?? new Uint8Array(0)
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
  { resolve: (bytes: Uint8Array | undefined) => void; reject: (error: Error) => void }
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
      else one?.resolve(response.kind === "read" ? response.bytes : undefined);
    });
  }
  return held;
}

function ask(
  request: Extract<JournalWorkerRequest, { id: number }>
): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    waiting.set(request.id, { resolve, reject });
    // A write's bytes are copied rather than transferred: the journal keeps them until the write
    // has landed, and answers reads from them meanwhile.
    worker()?.postMessage(request);
  });
}

/**
 * Has every undo history keep its bytes in the origin-private file system, where the page has
 * one and may run a worker; elsewhere the journals stay in memory, as they are in a test.
 */
export function installOpfsJournals(): void {
  if (!OpfsScratchStore.isAvailable() || typeof Worker === "undefined") return;
  setJournalStoreProvider(() => new OpfsJournalStore());
}
