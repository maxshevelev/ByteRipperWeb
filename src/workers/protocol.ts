/**
 * What the main thread and the workers say to each other.
 *
 * Decision D5: the protocol is written by hand, with `ArrayBuffer` transfers
 * and no RPC library. It is about a hundred lines, and the shape of
 * cancellation and progress is exactly what this application needs — which is
 * the part worth controlling and the part a dependency would hide.
 *
 * Three rules hold for every worker here:
 *
 * - **Every request carries an id**, and every response quotes it. A reply to a
 *   job that has already been superseded is dropped rather than acted on.
 * - **Cancellation is a message, not a flag.** A worker's loop awaits its reads,
 *   so the message queue is serviced between chunks and the flag a `cancel`
 *   sets is seen within one chunk of being sent.
 * - **Results are transferred, not copied.** A block index over a 64 MB pair can
 *   be megabytes of typed array; sending it by structured clone would copy it.
 */

/** A job number. Monotonic per worker client; never reused. */
export type JobId = number;

// MARK: - The diff worker

export interface DiffRequest {
  readonly kind: "diff";
  readonly id: JobId;
  /**
   * The two files, as `Blob`s. Structured clone shares a blob's bytes rather
   * than copying them, so this costs nothing however large the dump is — and
   * the worker builds its own storage and its own chunk cache over it, which is
   * what keeps a cache from ever serving two files.
   */
  readonly left: Blob;
  readonly right: Blob;
  readonly chunkSize?: number;
  /** The grouping distance for the navigation hunks. */
  readonly gap: number;
}

export interface CancelRequest {
  readonly kind: "cancel";
  readonly id: JobId;
}

export type DiffWorkerRequest = DiffRequest | CancelRequest;

export interface DiffProgress {
  readonly kind: "progress";
  readonly id: JobId;
  /** In `[0, 1]`. */
  readonly fraction: number;
}

/**
 * The finished comparison, as the columns {@link DiffBlockIndex} holds — so the
 * main thread rebuilds an index without walking a list of objects.
 */
export interface DiffDone {
  readonly kind: "done";
  readonly id: JobId;
  readonly leftSize: number;
  readonly rightSize: number;
  readonly starts: Float64Array;
  readonly ends: Float64Array;
  readonly kinds: Uint8Array;
  /** The merged navigation hunks, as `[start, end)` pairs, flattened. */
  readonly hunks: Float64Array;
  readonly gap: number;
  readonly differingBytes: number;
  readonly sameBytes: number;
}

export interface DiffCancelledResponse {
  readonly kind: "cancelled";
  readonly id: JobId;
}

export interface DiffFailed {
  readonly kind: "error";
  readonly id: JobId;
  readonly message: string;
  /** The storage error's own case, where it had one, so the UI can act on it. */
  readonly code?: string;
}

export type DiffWorkerResponse = DiffProgress | DiffDone | DiffCancelledResponse | DiffFailed;

/** The buffers a `done` response transfers rather than copies. */
export function transferablesOf(done: DiffDone): Transferable[] {
  return [done.starts.buffer, done.ends.buffer, done.kinds.buffer, done.hunks.buffer].filter(
    (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer
  );
}
