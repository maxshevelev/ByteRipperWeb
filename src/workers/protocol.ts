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

import type { FITReport } from "@/firmware/fit/fitTable";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import type { NodeDetail } from "@/tools/toolDetail";

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
 * An edit, told to the tree the worker already holds rather than to a fresh
 * parse of it.
 *
 * The tree is the expensive part of opening a firmware image and almost none of
 * it is about the byte that changed: a re-parse would throw away every branch
 * the user has opened. So what crosses is the damage — the range the edit
 * covered, and whether the file's length moved — and the worker drops only the
 * containers that damage made stale. The fresh `Blob` comes with it, because
 * the containers dropped are read again later and have to read current bytes.
 */
export interface FirmwareInvalidateRequest {
  readonly kind: "firmwareInvalidate";
  readonly id: JobId;
  readonly content: Blob;
  /** Half-open `[start, end)`, as the file stands after the edit. */
  readonly range: readonly [number, number];
  readonly sizeDelta: number;
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

/**
 * The Boot Guard and vendor protected ranges, read over a copy of the tree
 * opened as far as the lists need — every volume's files, and the compressed
 * sections only when a range cannot be placed without them.
 *
 * Its own request rather than part of the roots, because reading them hashes
 * megabytes and a panel nobody has opened should pay for none of it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.resolveProtectedRanges
 */
export interface FirmwareProtectedRangesRequest {
  readonly kind: "firmwareProtectedRanges";
  readonly id: JobId;
}

/**
 * The bytes of one buffer, or a range of one: what a compressed section
 * decompresses to, and a node inside it.
 *
 * Asked of the worker because the buffer is the worker's — decoding a section
 * is megabytes of work and the decoded copy is kept there — and because a
 * section still closed decodes on the way out, which is the whole point of
 * offering the export before the row is opened.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.decompressedBytes
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.reader
 */
export interface FirmwareSpaceBytesRequest {
  readonly kind: "firmwareSpaceBytes";
  readonly id: JobId;
  /** The chain of compressed sections the bytes are in; empty is the file. */
  readonly space: readonly number[];
  /** The bytes in that space, or nothing for the whole of it. */
  readonly range?: readonly [number, number] | undefined;
}

/** Everything the detail panel shows about one node, read once. */
export interface FirmwareDetailRequest {
  readonly kind: "firmwareDetail";
  readonly id: JobId;
  readonly node: readonly number[];
}

/** The node the caret stands in, opening whatever branches lie on the way. */
export interface FirmwareNodeAtOffsetRequest {
  readonly kind: "firmwareNodeAtOffset";
  readonly id: JobId;
  readonly offset: number;
}

/**
 * The FIT table, read against the image the worker already has open.
 *
 * It is one request rather than a second worker because both halves want the
 * same two things: a synchronous reader over the pane's bytes, and the tree —
 * a FIT row is named by whatever node covers the address it points at, and that
 * is something only the side holding the tree can say.
 */
export interface FitReadRequest {
  readonly kind: "fitRead";
  readonly id: JobId;
}

/**
 * A change to the FIT table, planned in the worker and written on the main
 * thread.
 *
 * Planned there because it needs the whole image — the run's own bytes, what is
 * free behind it, and the checksums of whatever file it sits in — and written
 * here because the document is the only way an edit can be taken back with the
 * same key the user's own typing is.
 */
export interface FitEditRequest {
  readonly kind: "fitEdit";
  readonly id: JobId;
  /**
   * `addOrReplace` decides by the component's CPUID, `replaceAt` by the row the
   * user pointed at, and `remove` takes one out. The first two carry the bytes
   * of the file that was picked.
   */
  readonly edit:
    | { readonly kind: "addOrReplace"; readonly component: Uint8Array }
    | { readonly kind: "replaceAt"; readonly index: number; readonly component: Uint8Array }
    | { readonly kind: "remove"; readonly index: number };
}

/**
 * Analysing the image's ME region.
 *
 * The database's *text* crosses rather than a parsed database: parsing it is
 * the domain half's job and the worker is where the domain half runs, and the
 * main thread has no business holding a few thousand lines it never reads.
 * Absent is allowed — an analysis without one reports every structural fact and
 * identifies nothing, which is exactly what an offline bench gets.
 */
export interface MeAnalyzeRequest {
  readonly kind: "meAnalyze";
  readonly id: JobId;
  readonly databaseText: string | undefined;
  /**
   * `Huffman.dat`, likewise as text, for the checks that decompress a module. The
   * panel fetches it only for an analysis that says it wants one.
   */
  readonly huffmanText: string | undefined;
  /**
   * `FileTable.dat`, likewise as text, for the two splits that wait on it: an
   * FTBL volume's files from the Integrity table they end with, and an EFS
   * volume's out of its data area. The panel fetches it only for a volume that
   * cannot name its own files — the same table names its rows, and the store
   * holds the parsed half for that.
   */
  readonly fileTableText: string | undefined;
}

/** The ME region's digests — three passes over it, so only when somebody asks. */
export interface MeChecksumsRequest {
  readonly kind: "meChecksums";
  readonly id: JobId;
}

export type FirmwareWorkerRequest =
  | FirmwareOpenRequest
  | MeChecksumsRequest
  | FirmwareDetailRequest
  | FirmwareSpaceBytesRequest
  | FirmwareProtectedRangesRequest
  | FirmwareNodeAtOffsetRequest
  | FirmwareChildrenRequest
  | FirmwareInvalidateRequest
  | FirmwareAddressesRequest
  | FirmwareRepairRequest
  | FitReadRequest
  | FitEditRequest
  | MeAnalyzeRequest
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
  /**
   * Which bytes this node's ranges are in: the empty chain for the file, and
   * otherwise the compressed sections on the way in, each by its header offset
   * in the space before it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.space
   */
  readonly space: readonly number[];
  /**
   * The algorithm this node's body is compressed with, and whether the port
   * opens it — what a panel's compressed badge is read from. Absent for a body
   * that is not compressed.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.compression
   */
  readonly compression?: { readonly algorithm: string; readonly decodes: boolean } | undefined;
  readonly isErased: boolean;
  readonly isExpandable: boolean;
  readonly childDepth: number;
  /**
   * The Type and Subtype columns, in UEFITool's words. Worked out where the
   * parsed node is: a volume's subtype is its file system and a capsule's is
   * its GUID, and neither survives the trip as a byte.
   */
  readonly typeText: string;
  readonly subtypeText: string;
  readonly children: readonly WireNode[];
}

export interface WireDiagnostic {
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly offset: number;
  /**
   * Where inside, when the trouble is in what a compressed section decompresses
   * to: the space, and the offset in its buffer. The `offset` above is then the
   * outermost section's header — bytes of the file, which is all the dump can
   * show.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.inside
   */
  readonly inside?: { readonly space: readonly number[]; readonly offset: number } | undefined;
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

/**
 * The tree as it stands after an invalidation: the same nodes, with the
 * containers the edit made stale back to closed. It is sent as the whole top
 * level rather than as a list of what went, because the main thread holds the
 * tree it drew and a path-addressed patch of it would be a second way to say
 * the same thing.
 */
export interface FirmwareInvalidatedResponse {
  readonly kind: "firmwareInvalidated";
  readonly id: JobId;
  readonly size: number;
  readonly roots: readonly WireNode[];
}

export interface FirmwareAddressesResponse {
  readonly kind: "firmwareAddresses";
  readonly id: JobId;
  readonly addressDiff: number | undefined;
}

/** A protected range as it crosses the wire: the ranges flattened to pairs. */
export interface WireProtectedRange {
  readonly kind: string;
  readonly range?: readonly [number, number] | undefined;
  readonly source: readonly [number, number];
  /** The algorithms the digests are stored by, in their display names. */
  readonly algorithms: readonly string[];
  readonly verdict: "matches" | "mismatch" | "unsupported" | "unchecked";
  /** The algorithm an `unsupported` verdict names, by its display name. */
  readonly unsupported?: string | undefined;
  /** What a panel calls the range. */
  readonly name: string;
  /** The one kind the ACM checks before the firmware runs. */
  readonly isIbb: boolean;
}

export interface FirmwareProtectedRangesResponse {
  readonly kind: "firmwareProtectedRanges";
  readonly id: JobId;
  readonly ranges: readonly WireProtectedRange[];
  /** OBB digests the manifest names and does not place, by their algorithms. */
  readonly obbDigests: readonly string[];
  readonly diagnostics: readonly WireDiagnostic[];
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

/**
 * What the detail panel says about one node, built where the bytes are. The
 * rows are already text: every field is read off the node's header, and the
 * reader is in the worker.
 */
export interface FirmwareDetailResponse {
  readonly kind: "firmwareDetail";
  readonly id: JobId;
  readonly node: readonly number[];
  readonly detail: NodeDetail;
}

/**
 * The bytes asked for, or nothing at all where the section does not decompress
 * — a stream the decoder cannot read, or one that failed. The caller says so;
 * the worker does not guess at a message.
 */
export interface FirmwareSpaceBytesResponse {
  readonly kind: "firmwareSpaceBytes";
  readonly id: JobId;
  readonly bytes?: Uint8Array | undefined;
}

/**
 * The innermost node covering an offset, with every branch on the way to it
 * opened — so the whole tree comes back, not only the path.
 */
export interface FirmwareNodeAtOffsetResponse {
  readonly kind: "firmwareNodeAtOffset";
  readonly id: JobId;
  readonly roots: readonly WireNode[];
  readonly path: readonly number[] | undefined;
  readonly diagnostics: readonly WireDiagnostic[];
}

/**
 * What one look at the image found, as the reader built it.
 *
 * The report crosses whole rather than pre-formatted: every field of it is a
 * number or a string, so structured clone carries it as it stands, and the
 * panel's own presentation stays on the main thread where it can be tested
 * without a worker.
 */
export interface FitReportResponse {
  readonly kind: "fitReport";
  readonly id: JobId;
  readonly report: FITReport;
}

/**
 * What the edit came to: the writes to make, or the reason none can be.
 *
 * The writes cross as offsets and bytes rather than as a transaction, because
 * the transaction is the main thread's to name, validate and apply — the worker
 * has no document to write to.
 */
export interface FitEditResponse {
  readonly kind: "fitEdit";
  readonly id: JobId;
  readonly name: string | undefined;
  readonly writes: readonly { readonly offset: number; readonly bytes: Uint8Array }[];
  /** A sentence the panel can show, when the edit was refused. */
  readonly problem: string | undefined;
  /** What happened, for the sentence said afterwards. */
  readonly summary: string | undefined;
  /** Where the component ended up, so the dump can be sent there. */
  readonly landed: readonly [number, number] | undefined;
}

export interface MeAnalyzeResponse {
  readonly kind: "meAnalyze";
  readonly id: JobId;
  /** Where in the image the region analysed begins. */
  readonly regionOffset: number;
  readonly analysis: FirmwareAnalysis | undefined;
  readonly problem: string | undefined;
}

/** The digests of the same bytes the analysis read, uppercase hex; nothing where none could be read. */
export interface MeChecksumsResponse {
  readonly kind: "meChecksums";
  readonly id: JobId;
  readonly sha256: string | undefined;
  readonly sha384: string | undefined;
  readonly crc32: number | undefined;
}

export type FirmwareWorkerResponse =
  | MeAnalyzeResponse
  | MeChecksumsResponse
  | FitEditResponse
  | FitReportResponse
  | FirmwareRootsResponse
  | FirmwareChildrenResponse
  | FirmwareInvalidatedResponse
  | FirmwareAddressesResponse
  | FirmwareDetailResponse
  | FirmwareSpaceBytesResponse
  | FirmwareProtectedRangesResponse
  | FirmwareNodeAtOffsetResponse
  | FirmwareRepairResponse
  | FirmwareProgress
  | FirmwareFailed;
