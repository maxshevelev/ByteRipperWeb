import { sourceOver } from "@/firmware/byteSource";
import {
  DecompressionError,
  type DecompressionFailure,
  decompressLzma,
  decompressLzmaX86,
  decompressTiano,
  type TianoDecoded,
} from "@/firmware/compression/firmwareDecompression";
import { ImageReader } from "@/firmware/imageReader";
import { type EFIGUID, guid, guidKey } from "@/firmware/uefi/efiGuid";
import { DEFAULT_EMPTY_BYTE, DEFAULT_LIMITS, Parser } from "@/firmware/uefi/parserState";
import { Section, walkSections } from "@/firmware/uefi/sectionParser";

/**
 * A compressed section this parser opens: which ones those are, where the
 * compressed bytes sit, and how they are decoded.
 *
 * Read from the section's own header rather than from its node, because a
 * buffer evicted from the cache is decoded again from nothing but the offsets in
 * a `ByteSpace` — the nodes that were built from it may be long gone.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift`.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Algorithm */
export type CompressionAlgorithm =
  | "lzma"
  | "lzmaX86"
  /** Tiano or EFI 1.1: one header for both, told apart after decoding. */
  | "tiano";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Algorithm.name */
export function algorithmDisplayName(algorithm: CompressionAlgorithm): string {
  switch (algorithm) {
    case "lzma":
      return "LZMA";
    case "lzmaX86":
      return "LZMA with x86 filter";
    case "tiano":
      return "Tiano";
  }
}

/**
 * `EFI_GUIDED_SECTION_PROCESSING_REQUIRED`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.processingRequired
 */
export const PROCESSING_REQUIRED = 0x01;

const LZMA_GUIDS: readonly EFIGUID[] = [
  guid("EE4E5898-3914-4259-9D6E-DC7BD79403CF"),
  guid("0ED85E23-F253-413F-A03C-901987B04397"), // HP
  guid("BD9921EA-ED91-404A-8B2F-B4D724747C8C"), // Microsoft
];
const LZMA_X86_GUID = guid("D42AE6BD-1352-4BFB-909A-CA72A6EAE889");
const TIANO_GUID = guid("A31280AD-481E-41B6-95E8-127F4C984779");
const GZIP_GUID = guid("1D301FE9-BE79-4353-91C2-D23BC959AE0C");

const DECODED_BY_GUID = new Map<string, CompressionAlgorithm>([
  ...LZMA_GUIDS.map((one) => [guidKey(one), "lzma"] as const),
  [guidKey(LZMA_X86_GUID), "lzmaX86"],
  [guidKey(TIANO_GUID), "tiano"],
]);

/**
 * A compression section's `CompressionType`: `0x01` is EDK2's standard
 * compression — Tiano or EFI 1.1 — `0x02` is what EDK2 calls customized and
 * means LZMA, `0x86` is LZMA with the x86 filter.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.algorithm
 */
export function algorithmOfCompressionType(type: number): CompressionAlgorithm | undefined {
  switch (type) {
    case 0x01:
      return "tiano";
    case 0x02:
      return "lzma";
    case 0x86:
      return "lzmaX86";
    default:
      return undefined;
  }
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.algorithm */
export function algorithmOfGuid(candidate: EFIGUID): CompressionAlgorithm | undefined {
  return DECODED_BY_GUID.get(guidKey(candidate));
}

/**
 * The GUID-defined sections whose body is compressed, decoded here or not — the
 * ones UEFITool expects `PROCESSING_REQUIRED` on.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.isCompressed
 */
export function isCompressedGuid(candidate: EFIGUID): boolean {
  const key = guidKey(candidate);
  return DECODED_BY_GUID.has(key) || key === guidKey(TIANO_GUID) || key === guidKey(GZIP_GUID);
}

/**
 * Where a compressed section's stream is, and what reads it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Located
 */
export interface LocatedSection {
  /**
   * The compressed bytes, in the space the section header was read in.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Located.body
   */
  readonly body: { readonly start: number; readonly end: number };
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Located.algorithm */
  readonly algorithm: CompressionAlgorithm;
  /**
   * A compression section's `UncompressedLength`. A GUID-defined one says
   * nothing, and the stream's own header is all there is.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.Located.declaredLength
   */
  readonly declaredLength?: number | undefined;
}

/**
 * The section whose header starts at `offset`, when it is one this parser
 * decodes.
 *
 * The extended size is taken only when it is larger than a three-byte size could
 * say — in an FFSv2 volume `0xFFFFFF` is a size, not a marker, and no FFSv3
 * section uses the long form for less.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.locate
 */
export function locateCompressedSection(
  offset: number,
  reader: ImageReader
): LocatedSection | undefined {
  const shortSize = reader.uint24(offset);
  const type = reader.uint8(offset + 3);
  if (shortSize === undefined || type === undefined) return undefined;
  let headerSize: number = Section.headerSize;
  let size = shortSize;
  if (shortSize === Section.extendedSizeMarker) {
    const extended = reader.uint32(offset + 4);
    if (extended !== undefined && extended > Section.extendedSizeMarker) {
      headerSize = Section.extendedHeaderSize;
      size = extended;
    }
  }
  if (size <= headerSize) return undefined;
  const end = Math.min(offset + size, reader.count);

  if (type === Section.compression) {
    const start = offset + headerSize + Section.compressionHeaderSize;
    const compressionType = reader.uint8(offset + headerSize + 4);
    const declared = reader.uint32(offset + headerSize);
    if (start >= end || compressionType === undefined || declared === undefined) return undefined;
    const algorithm = algorithmOfCompressionType(compressionType);
    if (algorithm === undefined) return undefined;
    return { body: { start, end }, algorithm, declaredLength: declared };
  }

  if (type === Section.guidDefined) {
    const sectionGuid = reader.guid(offset + headerSize);
    const dataOffset = reader.uint16(offset + headerSize + 16);
    if (sectionGuid === undefined || dataOffset === undefined) return undefined;
    const algorithm = algorithmOfGuid(sectionGuid);
    if (
      algorithm === undefined ||
      dataOffset < headerSize + Section.guidDefinedHeaderSize ||
      offset + dataOffset >= end
    ) {
      return undefined;
    }
    return { body: { start: offset + dataOffset, end }, algorithm };
  }

  return undefined;
}

/** What a decode gave back, or why there is nothing. */
export type DecodeResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly variant: "Tiano" | "EFI 1.1" | string;
    }
  | { readonly ok: false; readonly failure: DecompressionFailure };

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.decode */
export function decodeCompressedSection(
  section: LocatedSection,
  reader: ImageReader,
  limit: number
): DecodeResult {
  const bytes = reader.bytes(section.body);
  if (bytes === undefined) return { ok: false, failure: { kind: "truncated" } };
  try {
    switch (section.algorithm) {
      case "lzma": {
        const decoded = decompressLzma(bytes, limit);
        return { ok: true, bytes: decoded.bytes, variant: decoded.variant };
      }
      case "lzmaX86": {
        const decoded = decompressLzmaX86(bytes, limit);
        return { ok: true, bytes: decoded.bytes, variant: decoded.variant };
      }
      case "tiano": {
        const chosen = chooseTiano(decompressTiano(bytes, limit));
        return { ok: true, bytes: chosen.bytes, variant: chosen.variant };
      }
    }
  } catch (error) {
    if (error instanceof DecompressionError) return { ok: false, failure: error.failure };
    throw error;
  }
}

/** Which reading of a Tiano buffer was kept, and its bytes. */
export interface ChosenTiano {
  readonly bytes: Uint8Array;
  readonly variant: "Tiano" | "EFI 1.1";
}

/**
 * Which of a Tiano buffer's readings is the one: the only one that decoded, or —
 * both having decoded — the first that reads as a run of sections, Tiano before
 * EFI 1.1. When neither does, Tiano: it is what UEFITool keeps too, and the walk
 * over it then says what is wrong.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.chooseTiano
 */
export function chooseTiano(decoded: TianoDecoded): ChosenTiano {
  const { tiano, efi11 } = decoded;
  if (tiano !== undefined && efi11 === undefined) return { bytes: tiano, variant: "Tiano" };
  if (tiano === undefined && efi11 !== undefined) return { bytes: efi11, variant: "EFI 1.1" };
  if (tiano !== undefined && efi11 !== undefined) {
    if (!readsAsSections(tiano) && readsAsSections(efi11)) {
      return { bytes: efi11, variant: "EFI 1.1" };
    }
    return { bytes: tiano, variant: "Tiano" };
  }
  return { bytes: new Uint8Array(0), variant: "Tiano" };
}

/**
 * Whether a buffer walks as sections without a single complaint — the pre-parse
 * UEFITool decides between the two readings with.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.readsAsSections
 */
export function readsAsSections(buffer: Uint8Array): boolean {
  if (buffer.length === 0) return false;
  const parser = new Parser(new ImageReader(sourceOver(buffer)), DEFAULT_LIMITS);
  const nodes = walkSections(parser, parser.reader.all, {
    ffsVersion: 3,
    emptyByte: DEFAULT_EMPTY_BYTE,
    depth: 0,
  });
  return parser.diagnostics.length === 0 && nodes.some((node) => node.kind === "section");
}
