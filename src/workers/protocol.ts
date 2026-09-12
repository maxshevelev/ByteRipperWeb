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

import type { CaseFolding, SearchEncoding } from "@/core/search/searchPattern";

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

// MARK: - The search worker

/**
 * A search of one file.
 *
 * The worker answers twice: a `first` as soon as it has found one match, and
 * `indexed` as the full set streams in behind it. That split is the whole
 * design — a scan from the caret finds a match in about a millisecond, while
 * indexing every occurrence of a common byte takes a hundred times that, and
 * nobody should wait for the second to see the first.
 */
export interface SearchRequest {
  readonly kind: "search";
  readonly id: JobId;
  readonly file: Blob;
  /** The bytes to find, already folded the way the data will be. */
  readonly pattern: Uint8Array;
  /** The pattern as typed, for the reply to echo back. */
  readonly patternBytes: Uint8Array;
  readonly encoding: SearchEncoding;
  readonly folding: CaseFolding;
  /** Where the caret is, which is where the first scan starts. */
  readonly from: number;
  readonly direction: "forward" | "backward";
  /** False to answer with the first match alone and build no index. */
  readonly index: boolean;
}

export type SearchWorkerRequest = SearchRequest | CancelRequest;

export interface SearchFirst {
  readonly kind: "first";
  readonly id: JobId;
  /** Absent when the pattern is nowhere in the file. */
  readonly match?: { readonly start: number; readonly end: number };
  readonly wrapped: boolean;
}

/**
 * The index, as it stands. Sent more than once: a partial set lets the dump
 * grey what is known while the rest is still being found.
 */
export interface SearchIndexed {
  readonly kind: "indexed";
  readonly id: JobId;
  readonly extent: number;
  readonly total: number;
  readonly indexedUpTo: number;
  /** The starts, when the set is sparse enough to name them. */
  readonly starts?: Float64Array;
  /** The bitmap's words, when it is not. */
  readonly bitmapWords?: Uint32Array;
  /** True when the set kept only its count. */
  readonly countedOnly: boolean;
}

export interface SearchProgress {
  readonly kind: "searchProgress";
  readonly id: JobId;
  readonly fraction: number;
}

export type SearchWorkerResponse =
  | SearchFirst
  | SearchIndexed
  | SearchProgress
  | DiffCancelledResponse
  | DiffFailed;

/**
 * The minimap's overview build.
 *
 * Only the density picture crosses: it is the part that reads the whole file,
 * and the part worth caching per file version. The modified and difference
 * masks are arithmetic over ranges the main thread already holds — the piece
 * table's and the comparison index's — so shipping those in would cost more
 * than computing them where they are.
 */
export interface OverviewRequest {
  readonly kind: "overview";
  readonly id: JobId;
  readonly file: Blob;
  /** The longest open file: both maps bin over it so heights line up. */
  readonly extent: number;
  readonly rowCount: number;
}

export type MinimapWorkerRequest = OverviewRequest | CancelRequest;

export interface OverviewProgress {
  readonly kind: "overviewProgress";
  readonly id: JobId;
  readonly fraction: number;
}

export interface OverviewDone {
  readonly kind: "overviewDone";
  readonly id: JobId;
  readonly extent: number;
  readonly rowCount: number;
  /** `rowCount × 16`, row-major: how much of each cell is real content. */
  readonly density: Uint8Array;
}

export type MinimapWorkerResponse =
  | OverviewProgress
  | OverviewDone
  | DiffCancelledResponse
  | DiffFailed;

// MARK: - The firmware worker

/**
 * Opening an image. The `Blob` carries the pane's current content — the file
 * itself while it is clean, a snapshot of the document once it is not.
 *
 * Structured clone shares a blob's bytes rather than copying them, so this
 * costs nothing however large the dump is.
 */
export interface FirmwareOpenRequest {
  readonly kind: "openFirmware";
  readonly id: JobId;
  readonly content: Blob;
}

/** One collapsed node's children, computed when something asks to see them. */
export interface FirmwareChildrenRequest {
  readonly kind: "firmwareChildren";
  readonly id: JobId;
  readonly node: readonly number[];
}

/**
 * Where the image lands in memory, which needs the Volume Top File and so runs
 * only when something asks for an address.
 */
export interface FirmwareAddressesRequest {
  readonly kind: "firmwareAddresses";
  readonly id: JobId;
}

/**
 * What has to be written to put one node's checksums back in order.
 *
 * The worker computes them because it has the image; nothing here writes
 * anything. The main thread turns them into one undoable edit, which is what
 * makes the repair a single step.
 */
export interface FirmwareRepairRequest {
  readonly kind: "firmwareRepair";
  readonly id: JobId;
  readonly node: readonly number[];
  /** The revision of the volume the node sits in, which the fixed sum follows. */
  readonly volumeRevision: number;
}

export type FirmwareWorkerRequest =
  | FirmwareOpenRequest
  | FirmwareChildrenRequest
  | FirmwareAddressesRequest
  | FirmwareRepairRequest
  | CancelRequest;

/**
 * A node as it crosses the wire.
 *
 * The tree is thousands of these, so they are the node's own fields with the
 * children nested — structured clone handles that, and a flat table keyed by
 * path would be the same bytes with an index to rebuild.
 */
export interface WireNode {
  readonly id: readonly number[];
  readonly kind: string;
  readonly subtype?: number | undefined;
  readonly name: string;
  readonly guid?: string | undefined;
  readonly header: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
  readonly isFixed: boolean;
  readonly isCompressed: boolean;
  readonly isErased: boolean;
  readonly isExpandable: boolean;
  readonly childDepth: number;
  readonly children: readonly WireNode[];
}

export interface WireDiagnostic {
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly offset: number;
}

export interface FirmwareRootsResponse {
  readonly kind: "firmwareRoots";
  readonly id: JobId;
  readonly size: number;
  readonly roots: readonly WireNode[];
  readonly diagnostics: readonly WireDiagnostic[];
}

export interface FirmwareChildrenResponse {
  readonly kind: "firmwareChildren";
  readonly id: JobId;
  readonly node: readonly number[];
  readonly children: readonly WireNode[];
  readonly diagnostics: readonly WireDiagnostic[];
}

export interface FirmwareAddressesResponse {
  readonly kind: "firmwareAddresses";
  readonly id: JobId;
  readonly addressDiff: number | undefined;
}

export interface FirmwareProgress {
  readonly kind: "firmwareProgress";
  readonly id: JobId;
  /** In `[0, 1]`. */
  readonly fraction: number;
}

export interface FirmwareFailed {
  readonly kind: "firmwareFailed";
  readonly id: JobId;
  readonly problem: string;
}

export interface FirmwareRepairResponse {
  readonly kind: "firmwareRepair";
  readonly id: JobId;
  readonly node: readonly number[];
  readonly writes: readonly { readonly offset: number; readonly bytes: Uint8Array }[];
}

export type FirmwareWorkerResponse =
  | FirmwareRootsResponse
  | FirmwareChildrenResponse
  | FirmwareAddressesResponse
  | FirmwareRepairResponse
  | FirmwareProgress
  | FirmwareFailed;
