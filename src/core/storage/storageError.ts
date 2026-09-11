/**
 * What can go wrong in the storage layer, as things a person could be told.
 *
 * Ported from `StorageError.swift`, adapted to what a browser can actually
 * distinguish. The desktop classifies `open(2)`'s errno and can tell a
 * directory from a character device; a browser hands over a `File` that was
 * already chosen through a picker, so those cases cannot arise. What can arise
 * there and not here is the reverse: a `File` goes stale when the file changes
 * underneath it, and the next read fails with `NotReadableError` — see
 * `ANALYSIS.md` § File access. That is {@link StorageErrorCode.fileChanged},
 * and it is the one the interface has to name rather than showing an empty row.
 */
export type StorageErrorCode =
  /** The handle no longer resolves to a file. */
  | "fileNotFound"
  /**
   * The file changed on disk while it was open, so the `File` this storage
   * reads through is stale. Recoverable only by re-picking the file.
   */
  | "fileChanged"
  /** The browser refused the read or the write — usually a declined prompt. */
  | "permissionDenied"
  /** The read failed for a reason the layer above cannot act on. */
  | "readFailed"
  /** The write failed. */
  | "writeFailed"
  /** An offset that could not be one — see `src/core/limits.ts` (D3). */
  | "invalidOffset";

/** An error from the storage layer, carrying the case the UI switches on. */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  override readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }

  /**
   * Classifies what a browser threw out of a `Blob` read.
   *
   * `NotReadableError` is the one that matters: it is how a changed file
   * announces itself, and mistaking it for a generic failure is how a user ends
   * up staring at empty rows.
   */
  static fromReadFailure(cause: unknown): StorageError {
    const name = typeof cause === "object" && cause !== null ? (cause as Error).name : "";
    if (name === "NotReadableError" || name === "NotFoundError") {
      return new StorageError(
        "fileChanged",
        "This file changed on disk since it was opened, so it can no longer be read. " +
          "Open it again to pick up the new contents.",
        { cause }
      );
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return new StorageError("permissionDenied", "The browser refused access to this file.", {
        cause,
      });
    }
    return new StorageError("readFailed", "This file could not be read.", { cause });
  }
}
