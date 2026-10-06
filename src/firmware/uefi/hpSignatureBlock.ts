import type { ImageReader } from "@/firmware/imageReader";
import { isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The block HP puts in front of what it signs (`UEFI_IMAGE_FORMAT.md` §9): on a 4 KiB
 * boundary, in the padding before the main volume and before the boot block, two
 * ranges, an RSA signature and a payload naming the BIOS version and its date. Found on
 * four HP boards, Intel and AMD; the layout is read off those dumps and nothing
 * published, and the help says so.
 *
 * ```
 * 0x00  0, version (2 or 3), 0, S — the signature's length (0x100, 0x180)
 * 0x10  two ranges: address, length, 0xFFFFFFFF, 0
 * 0x30  the signature, S bytes, then S bytes of FF
 * 0x30+2S  the payload's length L, a second dword, then L bytes:
 *          +0x08 a word, +0x10 the BIOS version (16 bytes, NUL-padded),
 *          +0x20 the date — a 32-bit year, a 16-bit month and day
 * then     3 × S bytes nobody has read
 * ```
 *
 * A version-3 payload also holds a 40-character hex id at `0x368`, the same in both
 * blocks of a board, and a 48-byte digest at `0x43A`: in the block whose two ranges
 * start at one address, SHA-384 of the second range — on all three boards that carry
 * one. What the other block's digest covers is not known, and a version-2 block holds no
 * digest of its ranges.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock
 */
export interface HPSignatureBlock {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.version */
  readonly version: number;
  /** Bytes: 0x180 is RSA-3072, 0x100 RSA-2048. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.signatureLength */
  readonly signatureLength: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.ranges */
  readonly ranges: readonly HPSignedRange[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.payloadLength */
  readonly payloadLength: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.biosVersion */
  readonly biosVersion: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.year */
  readonly year: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.month */
  readonly month: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.day */
  readonly day: number;
  /** Version 3's 40-character hex id. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.identifier */
  readonly identifier?: string | undefined;
  /** Version 3's digest, where the layout puts it. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.digest */
  readonly digest?: Uint8Array | undefined;
  /** Header, signature, payload and the three blocks after it. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.length */
  readonly length: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.SignedRange */
export interface HPSignedRange {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.SignedRange.address */
  readonly address: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.SignedRange.length */
  readonly length: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.alignment */
export const HP_SIGNATURE_ALIGNMENT = 0x1000;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.identifierOffset */
const IDENTIFIER_OFFSET = 0x368;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.digestOffset */
const DIGEST_OFFSET = 0x43a;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.digestLength */
const DIGEST_LENGTH = 48;

const pad = (value: number, digits: number) => String(value).padStart(digits, "0");

/**
 * `YYYY-MM-DD`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.date
 */
export const hpSignatureDate = (block: HPSignatureBlock): string =>
  `${pad(block.year, 4)}-${pad(block.month, 2)}-${pad(block.day, 2)}`;

/**
 * The signature's algorithm by its length.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.signatureName
 */
export function hpSignatureName(block: HPSignatureBlock): string {
  switch (block.signatureLength) {
    case 0x100:
      return "RSA-2048";
    case 0x180:
      return "RSA-3072";
    default:
      return `${block.signatureLength} bytes`;
  }
}

/**
 * Whether the digest is the one this layout is known to hold: SHA-384 of the second
 * range, in a version-3 block whose ranges start at one address. Any other block's is
 * shown and not checked.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.digestCoversSecondRange
 */
export const digestCoversSecondRange = (block: HPSignatureBlock): boolean =>
  block.version === 3 &&
  block.digest !== undefined &&
  block.ranges.length === 2 &&
  block.ranges[0]?.address === block.ranges[1]?.address;

/**
 * The block at `offset`, when every field reads as one and its length ends before
 * `limit`; nothing otherwise, saying nothing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#HPSignatureBlock.read
 */
export function readHPSignatureBlock(
  offset: number,
  limit: number,
  reader: ImageReader
): HPSignatureBlock | undefined {
  if (reader.uint32(offset) !== 0) return undefined;
  const version = reader.uint32(offset + 4);
  if (version !== 2 && version !== 3) return undefined;
  if (reader.uint32(offset + 8) !== 0) return undefined;
  const signature = reader.uint32(offset + 12);
  if (signature !== 0x100 && signature !== 0x180) return undefined;
  const ranges: HPSignedRange[] = [];
  for (let index = 0; index < 2; index++) {
    const record = offset + 0x10 + index * 0x10;
    const address = reader.uint32(record);
    const length = reader.uint32(record + 4);
    if (
      address === undefined ||
      address === 0 ||
      length === undefined ||
      length === 0 ||
      reader.uint32(record + 8) !== 0xffff_ffff ||
      reader.uint32(record + 12) !== 0
    ) {
      return undefined;
    }
    ranges.push({ address, length });
  }
  const payload = 0x30 + 2 * signature;
  // The signature is followed by as many bytes of nothing.
  if (!reader.isFilled({ start: offset + 0x30 + signature, end: offset + payload }, 0xff)) {
    return undefined;
  }
  const payloadLength = reader.uint32(offset + payload);
  if (payloadLength === undefined || payloadLength < 0x28) return undefined;
  const length = payload + 8 + payloadLength + 3 * signature;
  if (length > HP_SIGNATURE_ALIGNMENT || offset + length > limit) return undefined;
  const at = offset + payload;
  const fields = reader.bytes({ start: at, end: at + 0x28 });
  if (fields === undefined) return undefined;
  const year = reader.uint32(at + 0x20);
  const month = reader.uint16(at + 0x24);
  const day = reader.uint16(at + 0x26);
  if (
    year === undefined ||
    year < 2000 ||
    year > 2099 ||
    month === undefined ||
    month < 1 ||
    month > 12 ||
    day === undefined ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }
  let versionLength = 0;
  while (versionLength < 16 && fields[0x10 + versionLength] !== 0) versionLength++;
  const versionBytes = fields.subarray(0x10, 0x10 + versionLength);
  if (versionBytes.length === 0 || !versionBytes.every((byte) => byte >= 0x20 && byte <= 0x7e)) {
    return undefined;
  }

  let identifier: string | undefined;
  let digest: Uint8Array | undefined;
  if (version === 3 && DIGEST_OFFSET + DIGEST_LENGTH <= payload + 8 + payloadLength) {
    const text = reader.bytes({
      start: offset + IDENTIFIER_OFFSET,
      end: offset + IDENTIFIER_OFFSET + 40,
    });
    if (
      text !== undefined &&
      text.every((byte) => (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66))
    ) {
      identifier = String.fromCharCode(...text);
    }
    digest = reader.bytes({
      start: offset + DIGEST_OFFSET,
      end: offset + DIGEST_OFFSET + DIGEST_LENGTH,
    });
  }
  return {
    offset,
    version,
    signatureLength: signature,
    ranges,
    payloadLength,
    biosVersion: String.fromCharCode(...versionBytes),
    year,
    month,
    day,
    identifier,
    digest,
    length,
  };
}

/**
 * `nodes` with HP's signature blocks in their padding read out as rows, each stretch
 * keeping its place, range and name (§9). Looked for on the 4 KiB boundaries of the file
 * inside every stretch of written padding, and in the padding rows read into one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPSignatureBlock.swift#Parser.readingHPSignatureBlocks
 */
export function readingHPSignatureBlocks(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (node.kind !== "padding" || isECFirmwarePadding(node)) return node;
    if (node.children.length > 0) {
      return { ...node, children: readingHPSignatureBlocks(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    const body = node.body;
    const blocks: HPSignatureBlock[] = [];
    let at = Math.ceil(body.start / HP_SIGNATURE_ALIGNMENT) * HP_SIGNATURE_ALIGNMENT;
    while (at + 0x30 <= body.end) {
      const block = readHPSignatureBlock(at, body.end, parser.reader);
      if (block !== undefined) blocks.push(block);
      at += HP_SIGNATURE_ALIGNMENT;
    }
    if (blocks.length === 0) return node;
    const rows: UEFINode[] = [];
    let claimed = body.start;
    for (const block of blocks) {
      rows.push(...parser.padding(claimed, block.offset, emptyByte));
      rows.push(
        makeNode({
          kind: "hpSignatureBlock",
          name: `HP signature block ${block.biosVersion}`,
          header: { start: block.offset, end: block.offset + 0x30 },
          body: { start: block.offset + 0x30, end: block.offset + block.length },
          // What it signs is named by address: it stays where it is.
          isFixed: true,
        })
      );
      claimed = block.offset + block.length;
    }
    rows.push(...parser.padding(claimed, body.end, emptyByte));
    return { ...node, children: rows };
  });
}
