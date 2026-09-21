import {
  decompressLzma,
  decompressLzmaX86,
  decompressTiano,
  LZMA_INTEL_LEGACY_PREFIX,
  type LzmaVariant,
  type TianoVariant,
} from "@/firmware/compression/firmwareDecompression";
import { type LzmaEffort, lzmaCompress } from "@/firmware/compression/lzmaEncoder";
import { tianoCompress } from "@/firmware/compression/tianoEncoder";
import { x86BranchConvert } from "@/firmware/compression/x86BranchConverter";

/**
 * Encoders for the compressed data a firmware image holds — the other direction
 * from `firmwareDecompression.ts`, for putting an edited buffer back into its
 * section.
 *
 * Every stream is decoded again before it is handed back, and compared with what
 * went in. A compressed section whose stream does not open is a board that does
 * not start, and an encoder that misbehaves is not something to find out that
 * way — so a stream that does not come back byte for byte is an error, never a
 * result.
 *
 * Ported from `Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift`.
 */

/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.Failure */
export type CompressionFailure =
  /** The encoder refused, with its own result code. */
  | { readonly kind: "encoderFailed"; readonly code: number }
  /** More than the format holds: its sizes are 32 bits. */
  | { readonly kind: "tooLarge"; readonly size: number }
  /** The new stream does not decode to what went in. */
  | { readonly kind: "roundTripFailed" }
  /**
   * An Intel legacy stream starts with four bytes of its own, and they were not
   * given.
   */
  | { readonly kind: "missingLegacyPrefix" };

/**
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.Failure
 * @upstream-differs a thrown Error carrying the failure, since a TypeScript
 * union cannot be thrown as itself
 */
export class CompressionError extends Error {
  readonly failure: CompressionFailure;

  constructor(failure: CompressionFailure) {
    super(`Compression failed: ${failure.kind}`);
    this.failure = failure;
    this.name = "CompressionError";
  }
}

/** Every variant an encode can be asked for. */
export type CompressionVariant = LzmaVariant | TianoVariant;

/**
 * The part of the progress bar the encoding takes; the check is the rest.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.encodedShare
 */
export const ENCODED_SHARE = 0.8;

/**
 * The LZMA dictionary used when the caller has none to keep: 8 MiB, more than
 * the distance between any two matches in a section of a flash image.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.defaultDictionarySize
 */
export const DEFAULT_DICTIONARY_SIZE = 1 << 23;

/**
 * `bytes` as a stream of `variant`, decoded back and checked.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.compress
 */
export function compress(
  bytes: Uint8Array,
  options: {
    readonly variant: CompressionVariant;
    /** The LZMA dictionary written into the header; ignored by Tiano and EFI 1.1. */
    readonly dictionarySize?: number;
    /**
     * The four bytes an Intel legacy stream starts with — required for that
     * variant, ignored by the others.
     */
    readonly legacyPrefix?: Uint8Array;
    /** The LZMA level; ignored by Tiano and EFI 1.1. */
    readonly effort?: LzmaEffort;
    /**
     * How far the work has got, from 0 to 1: the encoding up to `ENCODED_SHARE`,
     * the decode that checks it after. The LZMA encoder reports as it reads;
     * Tiano reports only when it is done.
     *
     * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.Progress
     */
    readonly onProgress?: (fraction: number) => void;
  }
): Uint8Array {
  // The format's sizes are 32 bits, and the encoder's own buffer is half again.
  if (bytes.length > 0xffff_ffff / 2) {
    throw new CompressionError({ kind: "tooLarge", size: bytes.length });
  }
  const dictionarySize = options.dictionarySize ?? DEFAULT_DICTIONARY_SIZE;
  const progress = options.onProgress;
  progress?.(0);

  let stream: Uint8Array;
  switch (options.variant) {
    case "LZMA":
      stream = lzma(bytes, dictionarySize, options.effort, progress);
      break;
    case "LZMA (Intel legacy)": {
      const prefix = options.legacyPrefix;
      if (prefix === undefined || prefix.length !== LZMA_INTEL_LEGACY_PREFIX) {
        throw new CompressionError({ kind: "missingLegacyPrefix" });
      }
      const body = lzma(bytes, dictionarySize, options.effort, progress);
      stream = new Uint8Array(prefix.length + body.length);
      stream.set(prefix);
      stream.set(body, prefix.length);
      break;
    }
    case "LZMA with x86 filter":
      stream = lzma(x86Filter(bytes), dictionarySize, options.effort, progress);
      break;
    case "Tiano":
      stream = tiano(bytes, true);
      break;
    case "EFI 1.1":
      stream = tiano(bytes, false);
      break;
  }

  progress?.(ENCODED_SHARE);
  if (!decodes(stream, options.variant, bytes)) {
    throw new CompressionError({ kind: "roundTripFailed" });
  }
  progress?.(1);
  return stream;
}

/**
 * `bytes` compressed the way `original` was: the same variant, the same LZMA
 * dictionary size, and the same four bytes in front of an Intel legacy stream.
 * `stream` is the compressed data `original` was decoded from.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.compress
 */
export function compressLike(
  bytes: Uint8Array,
  original: {
    readonly variant: CompressionVariant;
    readonly dictionarySize?: number | undefined;
  },
  stream: Uint8Array,
  options: {
    readonly effort?: LzmaEffort;
    readonly onProgress?: (fraction: number) => void;
  } = {}
): Uint8Array {
  const prefix =
    original.variant === "LZMA (Intel legacy)"
      ? stream.subarray(0, LZMA_INTEL_LEGACY_PREFIX)
      : undefined;
  return compress(bytes, {
    variant: original.variant,
    dictionarySize: original.dictionarySize ?? DEFAULT_DICTIONARY_SIZE,
    ...(prefix === undefined ? {} : { legacyPrefix: prefix }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });
}

/**
 * The x86 branch converter run forwards: what an LZMA + x86 section's stream
 * holds, before it is encoded.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.x86Filter
 */
export function x86Filter(bytes: Uint8Array): Uint8Array {
  const filtered = Uint8Array.from(bytes);
  x86BranchConvert(filtered, true);
  return filtered;
}

// MARK: - Encoding

/**
 * The LZMA SDK's encoder in EDK2's layout: five property bytes, the size in
 * eight, the stream with no end mark.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.lzma
 */
function lzma(
  bytes: Uint8Array,
  dictionarySize: number,
  effort: LzmaEffort | undefined,
  progress: ((fraction: number) => void) | undefined
): Uint8Array {
  const total = Math.max(bytes.length, 1);
  const encoded = lzmaCompress(bytes, {
    dictionarySize,
    ...(effort === undefined ? {} : { effort }),
    ...(progress === undefined
      ? {}
      : {
          onProgress: (processed: number) =>
            progress(Math.min(processed / total, 1) * ENCODED_SHARE),
        }),
  });
  if (!encoded.ok) throw new CompressionError({ kind: "encoderFailed", code: 1 });
  return encoded.bytes;
}

/**
 * EDK2's Tiano or EFI 1.1 compressor. Asked again with the size it says it needs
 * when the first buffer is too small.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.tiano
 * @upstream-differs no lock around it: upstream's C keeps its state in
 * file-level statics, so two encodes at once would write into each other, where
 * the port's state is made where the encode starts
 */
function tiano(bytes: Uint8Array, asTiano: boolean): Uint8Array {
  let capacity = bytes.length * 2 + 256;
  for (let attempt = 0; attempt < 2; attempt++) {
    const encoded = tianoCompress(bytes, asTiano, capacity);
    if (encoded.ok) return encoded.bytes;
    if (encoded.needed <= capacity) break;
    capacity = encoded.needed;
  }
  throw new CompressionError({ kind: "encoderFailed", code: 1 });
}

// MARK: - Checking

/**
 * Whether `stream` opens, as `variant`, to exactly `bytes`.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.decodes
 */
function decodes(stream: Uint8Array, variant: CompressionVariant, bytes: Uint8Array): boolean {
  const limit = bytes.length;
  try {
    switch (variant) {
      case "LZMA":
      case "LZMA (Intel legacy)": {
        const decoded = decompressLzma(stream, limit);
        return decoded.variant === variant && same(decoded.bytes, bytes);
      }
      case "LZMA with x86 filter":
        return same(decompressLzmaX86(stream, limit).bytes, bytes);
      case "Tiano": {
        const decoded = decompressTiano(stream, limit).tiano;
        return decoded !== undefined && same(decoded, bytes);
      }
      case "EFI 1.1": {
        const decoded = decompressTiano(stream, limit).efi11;
        return decoded !== undefined && same(decoded, bytes);
      }
    }
  } catch {
    return false;
  }
}

const same = (one: Uint8Array, other: Uint8Array) =>
  one.length === other.length && one.every((byte, index) => byte === other[index]);
