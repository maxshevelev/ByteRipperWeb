import type { ByteSource, Bytes } from "@/core/storage/byteStorage";

/**
 * Somewhere to put a copy of a document's content that is not the user's file.
 *
 * Upstream writes a temporary file: `EditOverlayStorage` folds a long piece
 * list into a fresh base with `FileHandle`, and `TemporaryFileStore` cleans up
 * after it. A browser has no temp directory — what it has is the origin-private
 * file system, which is reachable only from `src/platform` (D1). So the domain
 * half names the capability and does not implement it.
 *
 * An overlay given no scratch store still works; it simply never folds its
 * piece list, which costs read speed on a pathological edit session and nothing
 * else. The platform-backed implementation arrives with saving, in M4.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TemporaryFileStore.swift#TemporaryFileStore
 */
export interface ScratchStore {
  /**
   * Writes `content` somewhere private and returns it as a readable source.
   *
   * The returned source must survive this store being asked for another one:
   * an overlay reads through its previous base until the moment it swaps.
   */
  write(content: AsyncIterable<Bytes>): Promise<ByteSource>;

  /** Releases everything but the most recent write, which is still the base. */
  releaseAllButLatest(): Promise<void>;
}
