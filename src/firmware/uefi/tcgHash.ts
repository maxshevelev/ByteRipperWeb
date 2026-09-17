import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sha1, sha256, sha384, sha512 } from "@/firmware/me/crypto/digest";

/**
 * The TCG algorithm ids the Boot Policy and the vendor tables store their
 * digests by, and hashing with them.
 *
 * Ported from the `TCGHash` of
 * `Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift`, in a file of its
 * own because a diagnostic names an algorithm and nothing else of the ranges
 * belongs in `diagnostic.ts`.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash */
export const TCGHash = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.sha1 */
  sha1: 0x0004,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.sha256 */
  sha256: 0x000b,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.sha384 */
  sha384: 0x000c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.sha512 */
  sha512: 0x000d,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.null */
  null: 0x0010,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.sm3 */
  sm3: 0x0012,
} as const;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.name */
export function tcgHashName(algorithm: number): string {
  switch (algorithm) {
    case TCGHash.sha1:
      return "SHA-1";
    case TCGHash.sha256:
      return "SHA-256";
    case TCGHash.sha384:
      return "SHA-384";
    case TCGHash.sha512:
      return "SHA-512";
    case TCGHash.null:
      return "NULL";
    case TCGHash.sm3:
      return "SM3";
    default:
      return `algorithm 0x${algorithm.toString(16).toUpperCase().padStart(4, "0")}`;
  }
}

/**
 * The digest of `ranges` concatenated, or nothing when the algorithm is not one
 * this project computes — SM3 is in no system library and the project takes no
 * third-party code — or a range is not in the image.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#TCGHash.digest
 * @upstream-differs the bytes are gathered and hashed once, where upstream feeds
 * a CryptoKit `HashFunction` a megabyte at a time: the digests here take a whole
 * message, and a ranged read already comes back as one buffer
 */
export function tcgDigest(
  ranges: readonly ImageRange[],
  reader: ImageReader,
  algorithm: number
): Uint8Array | undefined {
  const hash = hashFunction(algorithm);
  if (hash === undefined) return undefined;
  let total = 0;
  const parts: Uint8Array[] = [];
  for (const range of ranges) {
    const bytes = reader.bytes(range);
    if (bytes === undefined) return undefined;
    parts.push(bytes);
    total += bytes.length;
  }
  const message = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    message.set(part, at);
    at += part.length;
  }
  return hash(message);
}

function hashFunction(algorithm: number): ((message: Uint8Array) => Uint8Array) | undefined {
  switch (algorithm) {
    case TCGHash.sha1:
      return sha1;
    case TCGHash.sha256:
      return sha256;
    case TCGHash.sha384:
      return sha384;
    case TCGHash.sha512:
      return sha512;
    default:
      return undefined;
  }
}
