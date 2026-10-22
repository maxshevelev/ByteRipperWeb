import type { ByteSource, EditableByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";

/**
 * What a window opens a session from, as it crosses to the host (`Design/FILE_SESSIONS.md`, S7): a
 * file's bytes — a `File`, a `Blob` — or nothing, for a new document. The host makes the storage;
 * the window never holds one.
 *
 * `scratch` gives the document somewhere private to fold an overgrown piece table into, where
 * there is such a place.
 *
 * @web-only upstream's pane opens its document itself
 */
export type DocumentSource =
  | { readonly kind: "file"; readonly source: ByteSource; readonly scratch: boolean }
  | { readonly kind: "empty" };

/** How many bytes a session opened from `source` starts with. */
export function sizeOf(source: DocumentSource): number {
  return source.kind === "file" ? source.source.size : 0;
}

/** The storage the host makes of a window's source: an overlay of edits over the bytes. */
export function storageOf(source: unknown): EditableByteStorage {
  const spec = source as DocumentSource;
  if (spec.kind === "empty") return new EditOverlayStorage(new MemoryBackedStorage());
  const scratch =
    spec.scratch && OpfsScratchStore.isAvailable() ? { scratch: new OpfsScratchStore() } : {};
  return new EditOverlayStorage(new FileBackedStorage(spec.source, new ChunkCache()), scratch);
}
