import type { Part, PartSink, PartStream } from "@/core/segments/segmentWriter";
import type { Bytes } from "@/core/storage/byteStorage";
import { StorageError } from "@/core/storage/storageError";
import { fileSystemAccess } from "@/platform/files/capabilities";
import { downloadBlob } from "@/platform/files/download";
import { ZipArchive } from "@/platform/files/zipArchive";

/**
 * Where the pieces actually go.
 *
 * `src/core/segments/segmentWriter.ts` says which range becomes which file and
 * insists that nothing is published until every part is complete; this is the
 * half that keeps that promise, and it keeps it differently in each browser
 * (D7).
 *
 * - **A folder the user picked** (Chromium): each part is staged under a hidden
 *   temporary name in that folder and only renamed into place once every one of
 *   them is written — upstream's temp-and-rename, with `createWritable()`'s own
 *   swap file standing in for the fsync. Where the browser has no rename, the
 *   commit copies instead; it is slower and the window in which a failure can
 *   publish a prefix is small rather than absent, and that is the best a
 *   browser offers.
 * - **A ZIP** (everywhere else): the whole set is one file, so all-or-nothing
 *   is free — an incomplete archive is never handed to the download at all.
 */

/** A part staged under a temporary name, waiting to be renamed into place. */
interface StagedPart {
  readonly name: string;
  readonly temporary: string;
  readonly handle: FileSystemFileHandle;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  const picker = fileSystemAccess().showDirectoryPicker;
  if (picker === undefined) return undefined;
  try {
    return await picker();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}

/** What the folder already holds, so the confirmation can name what it replaces. */
export async function namesIn(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  // `keys()` is an async iterator on the handle; a browser without it simply
  // has nothing to report, and the confirmation then promises no replacements.
  const iterable = directory as FileSystemDirectoryHandle & {
    keys?: () => AsyncIterableIterator<string>;
  };
  if (iterable.keys === undefined) return names;
  for await (const name of iterable.keys()) names.push(name);
  return names;
}

export function directorySink(directory: FileSystemDirectoryHandle): PartSink {
  const staged: StagedPart[] = [];
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    async open(part: Part): Promise<PartStream> {
      // A leading dot keeps the half-written parts out of the way in a file
      // browser for the seconds they exist.
      const temporary = `.${part.name}.byteripper-${suffix}-${staged.length}.tmp`;
      let handle: FileSystemFileHandle;
      try {
        handle = await directory.getFileHandle(temporary, { create: true });
      } catch (cause) {
        throw new StorageError(
          "writeFailed",
          "A file could not be created in that folder. Check that it is writable, and " +
            "that there is room on the disk.",
          { cause }
        );
      }
      staged.push({ name: part.name, temporary, handle });
      const stream = await handle.createWritable();
      return {
        write: (bytes: Bytes) => stream.write(bytes),
        // Closing commits the swap file, so the temporary is a whole file from
        // here on — which is what makes the rename below safe to do in a batch.
        finish: () => stream.close(),
      };
    },

    async commit(): Promise<void> {
      for (const part of staged) {
        const movable = part.handle as FileSystemFileHandle & {
          move?: (name: string) => Promise<void>;
        };
        if (typeof movable.move === "function") {
          try {
            await movable.move(part.name);
            continue;
          } catch {
            // Not every browser that exposes `move` allows it outside its own
            // private filesystem. Fall through to the copy.
          }
        }
        await copyInto(directory, part);
      }
      await removeAll(directory, staged);
    },

    async discard(): Promise<void> {
      await removeAll(directory, staged);
    },
  };
}

/** Copies a staged temporary into its final name, then leaves the temp to the sweep. */
async function copyInto(directory: FileSystemDirectoryHandle, part: StagedPart): Promise<void> {
  const source = await part.handle.getFile();
  const target = await directory.getFileHandle(part.name, { create: true });
  const stream = await target.createWritable();
  try {
    await source.stream().pipeTo(stream);
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}

async function removeAll(
  directory: FileSystemDirectoryHandle,
  staged: readonly StagedPart[]
): Promise<void> {
  for (const part of staged) {
    // A temporary that was renamed into place is already gone, and a remove
    // that fails leaves a hidden file behind rather than losing anything.
    await directory.removeEntry(part.temporary).catch(() => undefined);
  }
}

/**
 * The route without a directory picker: one ZIP, downloaded.
 *
 * All-or-nothing comes free here — the archive is only handed to the download
 * once every part is in it, and an archive that was never handed over published
 * nothing.
 */
export function zipSink(archiveName: string): PartSink {
  const archive = new ZipArchive();
  let published = false;

  return {
    async open(part: Part): Promise<PartStream> {
      const chunks: Bytes[] = [];
      return {
        write: async (bytes: Bytes) => void chunks.push(bytes),
        finish: () => archive.add(part.name, toAsyncIterable(chunks)),
      };
    },
    async commit(): Promise<void> {
      downloadBlob(archive.build(), archiveName);
      published = true;
    },
    async discard(): Promise<void> {
      // Nothing to undo: an archive that was never downloaded left no trace.
      if (published) throw new Error("The archive was already handed to the download.");
    },
  };
}

async function* toAsyncIterable(chunks: readonly Bytes[]): AsyncIterable<Bytes> {
  for (const chunk of chunks) yield chunk;
}
