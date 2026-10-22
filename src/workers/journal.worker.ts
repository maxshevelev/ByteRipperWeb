/// <reference lib="webworker" />

import type { JournalWorkerRequest, JournalWorkerResponse } from "@/workers/protocol";

/**
 * The undo journals' files, written where a page may append to a file: a dedicated worker's
 * synchronous access handle writes in place, where a page's writable stream copies the whole file
 * to a swap file on every write — which is what a journal exists to avoid.
 *
 * One handle per journal, opened at its first write, closed and the file removed when the page
 * lets the journal go.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal
 * @upstream-differs a worker holds the file, since only a worker may append to one in place
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

const handles = new Map<string, Promise<FileSystemSyncAccessHandle>>();

function handleFor(name: string): Promise<FileSystemSyncAccessHandle> {
  let handle = handles.get(name);
  if (handle === undefined) {
    handle = navigator.storage
      .getDirectory()
      .then((root) => root.getFileHandle(name, { create: true }))
      .then((file) => file.createSyncAccessHandle());
    handles.set(name, handle);
  }
  return handle;
}

async function close(name: string): Promise<void> {
  const handle = handles.get(name);
  handles.delete(name);
  if (handle !== undefined) (await handle.catch(() => undefined))?.close();
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name).catch(() => undefined);
}

scope.addEventListener("message", (event: MessageEvent<JournalWorkerRequest>) => {
  void answer(event.data);
});

async function answer(request: JournalWorkerRequest): Promise<void> {
  try {
    switch (request.kind) {
      case "write": {
        const handle = await handleFor(request.name);
        let done = 0;
        while (done < request.bytes.length) {
          const written = handle.write(request.bytes.subarray(done), { at: request.at + done });
          if (written <= 0) throw new Error("The journal could not be written.");
          done += written;
        }
        handle.flush();
        post({ kind: "done", id: request.id });
        return;
      }
      case "read": {
        const handle = await handleFor(request.name);
        const bytes = new Uint8Array(request.count);
        const read = handle.read(bytes, { at: request.at });
        if (read !== request.count) throw new Error("The journal could not be read.");
        post({ kind: "read", id: request.id, bytes }, [bytes.buffer]);
        return;
      }
      case "close":
        await close(request.name);
        return;
    }
  } catch (error) {
    if (request.kind === "close") return;
    post({
      kind: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function post(response: JournalWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}
