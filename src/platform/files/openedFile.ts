import type { ByteSource } from "@/core/storage/byteStorage";
import { pathOfFile } from "@/platform/desktop/desktopFiles";

/**
 * A file the user has given us.
 *
 * The bytes are reached through {@link ByteSource}, which is what `src/core`
 * understands and what a `File` already satisfies — so nothing below this layer
 * learns whether the file arrived through a picker, a drop, or a test.
 */
export interface OpenedFile {
  readonly name: string;
  readonly size: number;
  /** For the "this file changed on disk" check; milliseconds since the epoch. */
  readonly lastModified: number;
  readonly source: ByteSource;
  /**
   * The handle, where the browser gave one. M4's save path needs it to write in
   * place; nothing at M2 reads it, and it is absent outside Chromium.
   */
  readonly handle?: FileSystemFileHandle;
  /**
   * The file's full path, where the desktop shell says it: every file the person opens there — by
   * the picker, the file input or a drop — has one, and a file read by path keeps the one it was
   * read by. A browser tells a page no path, and there it is absent.
   */
  readonly path?: string;
}

/**
 * Wraps a browser `File` — which is already a `ByteSource` — as an opened file. Every way a file
 * the person chose arrives comes through here, so this is where it is given its path.
 */
export function openedFileFrom(file: File, handle?: FileSystemFileHandle): OpenedFile {
  const path = pathOfFile(file);
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    source: file,
    ...(handle === undefined ? {} : { handle }),
    ...(path === undefined ? {} : { path }),
  };
}
