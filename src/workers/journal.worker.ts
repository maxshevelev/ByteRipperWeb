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

/**
 * The folder a name lies in, and its own name: a journal's is at the top, a kept file's in its
 * workspace's folder — `kept-<id>/<name>`.
 */
async function place(
  name: string,
  create: boolean
): Promise<{ folder: FileSystemDirectoryHandle; file: string }> {
  const parts = name.split("/");
  let folder = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
  return { folder, file: parts[parts.length - 1] as string };
}

function handleFor(name: string): Promise<FileSystemSyncAccessHandle> {
  let handle = handles.get(name);
  if (handle === undefined) {
    handle = place(name, true)
      .then(({ folder, file }) => folder.getFileHandle(file, { create: true }))
      .then((file) => file.createSyncAccessHandle());
    handles.set(name, handle);
  }
  return handle;
}

/** Lets go of the file's handle, so it can be removed or read whole elsewhere. */
async function release(name: string): Promise<void> {
  const handle = handles.get(name);
  handles.delete(name);
  if (handle !== undefined) (await handle.catch(() => undefined))?.close();
}

async function close(name: string): Promise<void> {
  await release(name);
  const { folder, file } = await place(name, false);
  await folder.removeEntry(file).catch(() => undefined);
}

/** Removes every file of `folder` that `keep` does not name, or with no `keep` the folder. */
async function sweep(folder: string, keep: readonly string[] | undefined): Promise<void> {
  const root = await navigator.storage.getDirectory();
  if (keep === undefined) {
    for (const name of [...handles.keys()]) if (name.startsWith(`${folder}/`)) await release(name);
    await root.removeEntry(folder, { recursive: true }).catch(() => undefined);
    return;
  }
  const directory = (await root.getDirectoryHandle(folder).catch(() => undefined)) as
    | (FileSystemDirectoryHandle & { keys?: () => AsyncIterableIterator<string> })
    | undefined;
  if (directory?.keys === undefined) return;
  const named = new Set(keep);
  const doomed: string[] = [];
  for await (const name of directory.keys()) if (!named.has(name)) doomed.push(name);
  for (const name of doomed) {
    await release(`${folder}/${name}`);
    await directory.removeEntry(name).catch(() => undefined);
  }
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
      case "release":
        await release(request.name);
        post({ kind: "done", id: request.id });
        return;
      case "truncate": {
        const handle = await handleFor(request.name);
        handle.truncate(request.at);
        handle.flush();
        post({ kind: "done", id: request.id });
        return;
      }
      case "size": {
        const { folder, file } = await place(request.name, false).catch(() => ({
          folder: undefined,
          file: "",
        }));
        const exists = await folder?.getFileHandle(file).catch(() => undefined);
        const size = exists === undefined ? undefined : (await handleFor(request.name)).getSize();
        post({ kind: "size", id: request.id, size });
        return;
      }
      case "sweep":
        await sweep(request.folder, request.keep);
        post({ kind: "done", id: request.id });
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
