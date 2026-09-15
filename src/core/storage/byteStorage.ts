/**
 * What it means to be a stream of bytes this application can read.
 *
 * Ported from `ByteStorage.swift`, with one divergence that shapes everything
 * above it: **reads are asynchronous here**. On the desktop a read is a
 * `pread(2)` and returns bytes; in a browser the bytes come out of
 * `Blob.slice().arrayBuffer()`, which is a promise, and no amount of wishing
 * makes it otherwise. A canvas repaint cannot await anything, so the renderer
 * needs a synchronous path that is allowed to fail — {@link ByteStorage.peek} —
 * and a way to say what it is about to need — {@link ByteStorage.prefetch}.
 * That pair is the read-ahead window M2 is built on: the rows around the
 * viewport are made resident before they are painted, a miss paints a
 * placeholder, and the chunk landing triggers a repaint.
 *
 * Nothing in this file names a browser type. A `File` satisfies
 * {@link ByteSource} structurally, so the platform layer hands one straight in
 * and the domain half stays compilable without a DOM (D1).
 */

/**
 * Bytes backed by a plain `ArrayBuffer`.
 *
 * TypeScript models a typed array's backing store as a type parameter, and the
 * bare `Uint8Array` means "backed by anything" — including a
 * `SharedArrayBuffer`, which the DOM's `BufferSource` excludes. Every array
 * this application *produces* is freshly allocated over an `ArrayBuffer`, so
 * saying so here is what lets a read go straight to a writable stream without
 * an assertion at every call site.
 *
 * Only return types are narrowed. What the editing methods *accept* stays the
 * bare `Uint8Array`, because a caller's bytes may come from anywhere.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/**
 * The shape of a `Blob`, named structurally so `src/core` never mentions one.
 *
 * A browser `File` or `Blob` satisfies this as it stands; tests supply a few
 * lines over a `Uint8Array`.
 */
export interface ByteSource {
  readonly size: number;
  slice(start: number, end: number): ByteSourceSlice;
}

/** The part of a `Blob` slice this application uses. */
export interface ByteSourceSlice {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Read-only access to a stream of bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#ByteStorage
 */
export interface ByteStorage {
  /**
   * Total number of bytes.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#ByteStorage.size
   */
  readonly size: number;

  /**
   * Up to `length` bytes at `at`, clamped to EOF.
   *
   * Asking past the end is not an error — it yields fewer bytes, or none. That
   * is upstream's contract and the reason no caller range-checks before
   * reading.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#ByteStorage.read
   */
  read(at: number, length: number): Promise<Bytes>;

  /**
   * The same bytes, but only if they can be produced without awaiting —
   * otherwise `undefined`.
   *
   * For the renderer, which paints inside a frame and cannot wait. A miss is a
   * normal outcome, not a failure: paint a placeholder and repaint when
   * {@link prefetch} reports the bytes are in.
   */
  peek(at: number, length: number): Bytes | undefined;

  /**
   * Make the bytes covering `[at, at + length)` resident, so a later
   * {@link peek} of that window succeeds.
   *
   * Resolves when they are. Calling it for a window already resident is cheap
   * and does no I/O.
   */
  prefetch(at: number, length: number): Promise<void>;
}

/**
 * Mutable byte storage.
 *
 * Every mutation records enough for the document layer above to build undo,
 * redo and dirty state on top — see `src/core/document/binaryDocument.ts`.
 *
 * Ranges are half-open `[start, end)` throughout (D13).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#EditableByteStorage
 */
export interface EditableByteStorage extends ByteStorage {
  /**
   * Lays `bytes` over the content starting at `at`. Exactly `bytes.length`
   * bytes are written. Extends the file when the write runs past EOF, zero
   * filling any gap. Never shifts an existing offset.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#EditableByteStorage.overwrite
   */
  overwrite(at: number, bytes: Uint8Array): Promise<void>;

  /**
   * Inserts `bytes` at `at`, shifting everything after it right.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#EditableByteStorage.insert
   */
  insert(at: number, bytes: Uint8Array): Promise<void>;

  /**
   * Removes `[start, end)`, shifting everything after it left.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#EditableByteStorage.delete
   */
  delete(start: number, end: number): Promise<void>;

  /**
   * Appends `bytes` at the current end.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteStorage.swift#EditableByteStorage.append
   */
  append(bytes: Uint8Array): Promise<void>;
}
