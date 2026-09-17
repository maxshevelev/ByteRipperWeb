import { lzmaDecodeWhole, SZ_ERROR_INPUT_EOF, SZ_OK } from "@/firmware/compression/lzmaDecoder";
import { TIANO_HEADER_SIZE, tianoDecode, tianoInfo } from "@/firmware/compression/tianoDecoder";
import { x86BranchConvert } from "@/firmware/compression/x86BranchConverter";

/**
 * Decoders for the compressed data a firmware image holds.
 *
 * Every function takes bytes read from an untrusted image and a limit on how
 * much the caller is willing to allocate, and hands back either the whole decoded
 * buffer or the reason there is none. Nothing comes back partial: a stream that
 * stops early is a failure, not a shorter buffer, because a parser reading a
 * short buffer finds structures cut off in the middle and blames the image for a
 * decode that did not finish.
 *
 * Ported from `Packages/FirmwareCompression/FirmwareDecompression.swift`.
 */

/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Failure */
export type DecompressionFailure =
  /** The data ends before its header does, or before the stream produced the declared size. */
  | { readonly kind: "truncated" }
  /** The header or the stream is not something the decoder accepts. */
  | { readonly kind: "corrupt" }
  /** The header declares more than the caller allows; refused before anything is allocated. */
  | { readonly kind: "tooLarge"; readonly declared: number };

/**
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Failure
 * @upstream-differs a thrown Error carrying the failure, since a TypeScript union cannot be thrown as itself
 */
export class DecompressionError extends Error {
  readonly failure: DecompressionFailure;

  constructor(failure: DecompressionFailure) {
    super(`Decompression failed: ${failure.kind}`);
    this.failure = failure;
    this.name = "DecompressionError";
  }
}

/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Variant */
export type LzmaVariant = "LZMA" | "LZMA (Intel legacy)" | "LZMA with x86 filter";

/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Variant */
export type TianoVariant = "Tiano" | "EFI 1.1";

/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Decoded */
export interface LzmaDecoded {
  /** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Decoded.bytes */
  readonly bytes: Uint8Array;
  /** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Decoded.variant */
  readonly variant: LzmaVariant;
  /**
   * The dictionary size from the properties — the one thing that tells two encoders apart.
   *
   * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.Decoded.dictionarySize
   */
  readonly dictionarySize: number;
}

/**
 * What a Tiano-or-EFI-1.1 buffer decoded to, each way it decoded.
 *
 * The two algorithms share a header and differ in one field width inside the
 * stream, so the stream alone does not always say which one it is: both can
 * succeed, and then only what the bytes are meant to be — a run of sections, for
 * a UEFI image — tells them apart. That is the caller's to decide, so both
 * results come back.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.TianoDecoded
 */
export interface TianoDecoded {
  /** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.TianoDecoded.tiano */
  readonly tiano: Uint8Array | undefined;
  /** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.TianoDecoded.efi11 */
  readonly efi11: Uint8Array | undefined;
}

/**
 * Compressed size, then original size, each 32 bits — the decoder's own
 * constant, handed on from here because this is where a caller looks for it.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.tianoHeaderSize
 */
export { TIANO_HEADER_SIZE } from "@/firmware/compression/tianoDecoder";

/**
 * Properties, then the uncompressed size as a 64-bit number.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.lzmaPropertiesSize
 */
export const LZMA_PROPERTIES_SIZE = 5;
/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.lzmaHeaderSize */
export const LZMA_HEADER_SIZE = 13;
/** @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.lzmaIntelLegacyPrefix */
export const LZMA_INTEL_LEGACY_PREFIX = 4;

/**
 * An LZMA stream as EDK2 writes it. The Intel legacy layout is recognised the way
 * UEFITool recognises it: when the header at the start does not give a size that
 * fits in 32 bits, the same header is looked for four bytes further on.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.lzma
 */
export function decompressLzma(data: Uint8Array, limit: number): LzmaDecoded {
  const declared = declaredSize(data, 0);
  if (declared !== undefined) {
    return {
      bytes: decode(data, 0, declared, limit),
      variant: "LZMA",
      dictionarySize: dictionarySize(data, 0),
    };
  }
  const start = LZMA_INTEL_LEGACY_PREFIX;
  const legacy = declaredSize(data, start);
  if (legacy === undefined) {
    throw new DecompressionError({
      kind: data.length <= LZMA_HEADER_SIZE ? "truncated" : "corrupt",
    });
  }
  return {
    bytes: decode(data, start, legacy, limit),
    variant: "LZMA (Intel legacy)",
    dictionarySize: dictionarySize(data, start),
  };
}

/**
 * LZMA, then the x86 branch converter run backwards over the result. There is no
 * legacy layout of this one.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.lzmaX86
 */
export function decompressLzmaX86(data: Uint8Array, limit: number): LzmaDecoded {
  const declared = declaredSize(data, 0);
  if (declared === undefined) {
    throw new DecompressionError({
      kind: data.length <= LZMA_HEADER_SIZE ? "truncated" : "corrupt",
    });
  }
  const bytes = decode(data, 0, declared, limit);
  x86BranchConvert(bytes, false);
  return { bytes, variant: "LZMA with x86 filter", dictionarySize: dictionarySize(data, 0) };
}

/**
 * A Tiano or EFI 1.1 buffer decoded both ways.
 *
 * The header has to account for the data exactly, the way UEFITool checks it:
 * compressed size plus the header is the length of what was handed in. It fails
 * only when neither algorithm decodes.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.tiano
 */
export function decompressTiano(data: Uint8Array, limit: number): TianoDecoded {
  if (data.length < TIANO_HEADER_SIZE) throw new DecompressionError({ kind: "truncated" });
  const compressed = littleEndian32(data, 0);
  const original = littleEndian32(data, 4);
  if (compressed + TIANO_HEADER_SIZE > data.length) {
    throw new DecompressionError({ kind: "truncated" });
  }
  if (compressed + TIANO_HEADER_SIZE !== data.length) {
    throw new DecompressionError({ kind: "corrupt" });
  }
  if (original > limit) throw new DecompressionError({ kind: "tooLarge", declared: original });

  const declared = tianoInfo(data);
  if (declared === undefined || declared !== original) {
    throw new DecompressionError({ kind: "corrupt" });
  }
  if (declared === 0) return { tiano: new Uint8Array(0), efi11: new Uint8Array(0) };

  const attempt = (tiano: boolean): Uint8Array | undefined => {
    const bytes = new Uint8Array(declared);
    return tianoDecode(data, bytes, tiano) ? bytes : undefined;
  };
  const decoded: TianoDecoded = { tiano: attempt(true), efi11: attempt(false) };
  if (decoded.tiano === undefined && decoded.efi11 === undefined) {
    throw new DecompressionError({ kind: "corrupt" });
  }
  return decoded;
}

/**
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareDecompression.swift#FirmwareDecompression.littleEndian32
 */
function littleEndian32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * The size the header at `start` declares, or nothing when there is no header
 * there — fewer bytes than a header and a stream, or a size that does not fit in
 * 32 bits, which no section of a flash image has.
 */
function declaredSize(data: Uint8Array, start: number): number | undefined {
  if (data.length - start <= LZMA_HEADER_SIZE) return undefined;
  const byte = (index: number) => data[start + LZMA_PROPERTIES_SIZE + index] ?? 0;
  if (byte(4) !== 0 || byte(5) !== 0 || byte(6) !== 0 || byte(7) !== 0) return undefined;
  return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}

function dictionarySize(data: Uint8Array, start: number): number {
  return (
    ((data[start + 1] ?? 0) |
      ((data[start + 2] ?? 0) << 8) |
      ((data[start + 3] ?? 0) << 16) |
      ((data[start + 4] ?? 0) << 24)) >>>
    0
  );
}

function decode(data: Uint8Array, start: number, declared: number, limit: number): Uint8Array {
  if (declared > limit) throw new DecompressionError({ kind: "tooLarge", declared });
  if (declared === 0) return new Uint8Array(0);
  const output = new Uint8Array(declared);
  const { result, written } = lzmaDecodeWhole(data.subarray(start), output);
  if (result === SZ_OK) {
    // The decoder stops where the stream does. Short of the declared size, the
    // header and the stream disagree about where that is.
    if (written !== declared) throw new DecompressionError({ kind: "truncated" });
    return output;
  }
  throw new DecompressionError({ kind: result === SZ_ERROR_INPUT_EOF ? "truncated" : "corrupt" });
}
