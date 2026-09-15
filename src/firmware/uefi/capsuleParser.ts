import { guid, guidKey } from "@/firmware/uefi/efiGuid";
import type { Parser } from "@/firmware/uefi/parserState";
import { parseTopLevel } from "@/firmware/uefi/rawScan";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The wrapper an update file arrives in.
 *
 * A capsule is not part of the image — it is the envelope the vendor shipped it
 * in, and the image inside starts where `HeaderSize` says. Recognising one is
 * what turns "this file makes no sense" into "this file is an update".
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.Layout */
interface CapsuleLayout {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.Layout.name */
  readonly name: string;
  /**
   * Where the total size is written, which is not the same field in every
   * vendor's version of this header.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.Layout.sizeOffset
   */
  readonly sizeOffset: number;
  /**
   * Aptio signed capsules put a certificate between the header and the image,
   * and only `RomImageOffset` knows how much of it there is.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.Layout.romImageOffsetAt
   */
  readonly romImageOffsetAt?: number | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule */
export const Capsule = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.headerSizeOffset */
  headerSizeOffset: 0x10,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.minimumHeaderSize */
  minimumHeaderSize: 0x1c,
} as const;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Capsule.layout */
const LAYOUTS = new Map<string, CapsuleLayout>(
  (
    [
      ["3B6686BD-0D76-4030-B70E-B5519E2FC5A0", { name: "EFI capsule", sizeOffset: 0x18 }],
      ["6DCBD5ED-E82D-4C44-BDA1-7194199AD92A", { name: "FMP capsule", sizeOffset: 0x18 }],
      ["539182B9-ABB5-4391-B69A-E3A943F72FCC", { name: "Intel capsule", sizeOffset: 0x18 }],
      ["E20BAFD3-9914-4F4F-9537-3129E090EB3C", { name: "Lenovo capsule", sizeOffset: 0x18 }],
      ["25B5FE76-8243-4A5C-A9BD-7EE3246198B5", { name: "Lenovo capsule", sizeOffset: 0x18 }],
      // Toshiba writes the full size where everyone else writes the flags.
      ["3BE07062-1D51-45D2-832B-F093257ED461", { name: "Toshiba capsule", sizeOffset: 0x14 }],
      [
        "4A3CA68B-7723-48FB-803D-578CC1FEC44D",
        { name: "AMI Aptio signed capsule", sizeOffset: 0x18, romImageOffsetAt: 0x1c },
      ],
      [
        "14EEBB90-890A-43DB-AED1-5D3C4588A418",
        { name: "AMI Aptio unsigned capsule", sizeOffset: 0x18 },
      ],
    ] as const
  ).map(([text, layout]) => [guidKey(guid(text)), layout])
);

/**
 * Nothing when there is no capsule here, which is the usual answer — a dump off
 * a chip has no envelope.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CapsuleParser.swift#Parser.parseCapsule
 */
export function parseCapsule(
  parser: Parser,
  options: { readonly offset: number; readonly limit: number; readonly depth: number }
): UEFINode | undefined {
  const { offset, limit, depth } = options;
  const reader = parser.reader;

  const found = reader.guid(offset);
  if (found === undefined) return undefined;
  const layout = LAYOUTS.get(guidKey(found));
  if (layout === undefined) return undefined;
  const headerSize = reader.uint32(offset + Capsule.headerSizeOffset);
  const imageSize = reader.uint32(offset + layout.sizeOffset);
  if (headerSize === undefined || imageSize === undefined) return undefined;

  let bodyStart = offset + headerSize;
  if (layout.romImageOffsetAt !== undefined) {
    const romImageOffset = reader.uint16(offset + layout.romImageOffsetAt);
    if (romImageOffset !== undefined && romImageOffset >= Capsule.minimumHeaderSize) {
      bodyStart = offset + romImageOffset;
    }
  }
  if (headerSize < Capsule.minimumHeaderSize || bodyStart >= limit) {
    parser.note(
      { kind: "truncated", structure: "capsuleHeader" },
      offset + Capsule.headerSizeOffset
    );
    return undefined;
  }

  // A capsule that claims less than the file holds has something after it, and
  // that something is kept rather than quietly folded in.
  let end = limit;
  if (imageSize > 0 && offset + imageSize < limit) end = offset + imageSize;

  return makeNode({
    kind: "capsule",
    name: layout.name,
    guid: found,
    header: { start: offset, end: bodyStart },
    body: { start: bodyStart, end },
    children: parseTopLevel(parser, { start: bodyStart, end }, depth + 1),
  });
}
