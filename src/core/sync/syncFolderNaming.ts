/**
 * What the library files in a shared folder are called
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * **One file per machine**, named by a stamp of the machine's id and nothing
 * else: each machine writes its own file and reads everyone else's, so no file
 * ever has two writers. The names are shared with the Mac app character for
 * character — a browser and a Mac in one folder find each other by them.
 *
 * The stamp itself is a hash, which the domain half does not compute (D1): the
 * caller hands in the digest and this says what the name made from it is.
 */

/**
 * What every library file is called before the bracketed stamp. Closer to a
 * format than to a label: a build that changed it would stop seeing every file
 * already in the folder, its own included.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.fileStem
 */
export const LIBRARY_FILE_STEM = "ByteRipper Patterns";

/** @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolderAccess.fileExtension */
export const LIBRARY_FILE_EXTENSION = "json";

/**
 * How long a machine's stamp is, in characters: six bytes of a digest in hex.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.stampLength
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolderAccess.stampLength
 */
export const STAMP_LENGTH = 12;

/**
 * The stamp a digest makes: its first six bytes as upper-case hex. Long enough
 * that two machines colliding is not a thing that happens, short enough to read
 * out over a phone.
 */
export function stampOf(digest: Uint8Array): string {
  return Array.from(digest.subarray(0, STAMP_LENGTH / 2), (byte) =>
    byte.toString(16).toUpperCase().padStart(2, "0")
  ).join("");
}

/**
 * The file a machine with this stamp writes.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.fileName
 */
export function libraryFileName(stamp: string): string {
  return `${LIBRARY_FILE_STEM} (${stamp}).${LIBRARY_FILE_EXTENSION}`;
}

/**
 * Whether a name is one of the library files: a machine's own, and nothing
 * else. One bracketed label, and it has to be a stamp — which keeps out the
 * copies a sync client leaves ("… (A93F1C0D22B7) 2.json", "… (conflicted copy
 * 2026-09-05).json") and any file the user named themselves.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.isLibraryFile
 */
export function isLibraryFile(name: string): boolean {
  const opening = `${LIBRARY_FILE_STEM} (`;
  const closing = `).${LIBRARY_FILE_EXTENSION}`;
  if (!name.startsWith(opening) || !name.endsWith(closing)) return false;
  const label = name.slice(opening.length, name.length - closing.length);
  return label.length === STAMP_LENGTH && /^[0-9A-F]+$/.test(label);
}
