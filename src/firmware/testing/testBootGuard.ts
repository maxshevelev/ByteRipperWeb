/**
 * The lists of `BOOT_GUARD_PROTECTED_RANGES.md` §4 and §5, byte for byte — what
 * the protected-range tests build their images out of.
 *
 * Ported from `Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift`'s
 * `TestBootGuard`, which upstream keeps in the test file itself; a test file here
 * cannot export, and two test files need these.
 */

import { sourceOver } from "@/firmware/byteSource";
import type { ImageRange } from "@/firmware/imageReader";
import { sha256 } from "@/firmware/me/crypto/digest";
import * as Test from "@/firmware/testing/testImage";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { sum8 } from "@/firmware/uefi/checksums";
import { type EFIGUID, guid, guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapParser";
import { AMI_HASH_FILE, DXE_CORE, PHOENIX_HASH_FILE } from "@/firmware/uefi/knownGuids";
import { BootPolicy, type ProtectedRanges } from "@/firmware/uefi/protectedRanges";
import { Section } from "@/firmware/uefi/sectionParser";
import { TCGHash } from "@/firmware/uefi/tcgHash";
import { DXE_CORE_VOLUME_LZMA, streamBytes } from "@/firmware/uefi/testing/compressedFixtures";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened } from "@/firmware/uefi/uefiNode";

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.MapEntry */
export interface MapEntry {
  readonly offset: number;
  readonly size: number;
  readonly attributes: number;
  readonly hash: Uint8Array;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.zero32 */
export const ZERO32 = new Uint8Array(32);

/**
 * An Insyde flash device map, its header checksum right.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.flashDeviceMap
 */
export function flashDeviceMapBytes(options: {
  readonly base: number;
  readonly entries: readonly MapEntry[];
  readonly entrySize?: number;
  readonly format?: number;
  readonly revision?: number;
}): Uint8Array {
  const body = new BinaryWriter();
  options.entries.forEach((entry, index) => {
    const id = (index + 1).toString(16).toUpperCase().padStart(12, "0");
    body.guid(guid(`FD000000-0000-4000-8000-${id}`));
    const text = `REGION${index}`;
    const regionId = Uint8Array.from(text, (character) => character.charCodeAt(0));
    body.raw(regionId).fill(16 - regionId.length, 0);
    body.u64(entry.offset).u64(entry.size).u32(entry.attributes).raw(entry.hash);
  });

  const header = new BinaryWriter()
    .u32(FlashDeviceMap.signature)
    .u32(FlashDeviceMap.headerSize + body.count)
    .u32(FlashDeviceMap.headerSize) // DataOffset
    .u32(options.entrySize ?? FlashDeviceMap.entrySize)
    .u8(options.format ?? 0)
    .u8(options.revision ?? 3)
    .u8(0) // ExtensionCount
    .u8(0) // Checksum, filled in below
    .u64(options.base).bytes;
  header[FlashDeviceMap.checksumOffset] = (0x100 - sum8(header)) & 0xff;

  const out = new Uint8Array(header.length + body.count);
  out.set(header);
  out.set(body.bytes, header.length);
  return out;
}

/**
 * The store at the start of a 64 KiB image, with a volume behind it so the image
 * is mapped.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.mapImage
 */
export function mapImage(store: Uint8Array): Uint8Array {
  const volume = Test.volume({ length: 0xf000, lastFile: Test.volumeTopFile({ size: 0x100 }) });
  const out = new Uint8Array(0x1000 + volume.length);
  out.fill(0xff);
  out.set(store);
  out.set(volume, 0x1000);
  return out;
}

// MARK: - The Boot Policy Manifest

/**
 * A stored digest and the range it covers, as the vendor tables lay one out.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.Entry
 */
export interface VendorEntry {
  readonly base: number;
  readonly size: number;
  readonly hash: Uint8Array;
}

/**
 * One IBB segment.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.Segment
 */
export interface TestSegment {
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.Segment.base */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.Segment.size */
  readonly size: number;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.Segment.flags */
  readonly flags?: number;
}

/**
 * `__TXTS__`: an element the reading does not know.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.txts
 */
const TXTS = { low: 0x5854_5f5f, high: 0x5f5f_5354 } as const;

const idBytes = (id: { readonly low: number; readonly high: number }) =>
  new BinaryWriter().u32(id.low).u32(id.high).bytes;

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.hashV1 */
export function hashV1(digest: Uint8Array, algorithm: number = TCGHash.sha256): Uint8Array {
  const padded = new Uint8Array(32);
  padded.set(digest.subarray(0, 32));
  return new BinaryWriter().u16(algorithm).u16(32).raw(padded).bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.hashV2 */
export function hashV2(digest: Uint8Array, algorithm: number = TCGHash.sha256): Uint8Array {
  return new BinaryWriter().u16(algorithm).u16(digest.length).raw(digest).bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.segments */
export function segmentBytes(list: readonly TestSegment[]): Uint8Array {
  const writer = new BinaryWriter();
  for (const segment of list) {
    writer.u16(0); // Reserved
    writer.u16(segment.flags ?? 0);
    writer.u32(segment.base);
    writer.u32(segment.size);
  }
  return writer.bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.bootPolicyV1 */
export function bootPolicyV1(options: {
  readonly segments: readonly TestSegment[];
  readonly ibbHash: Uint8Array;
  readonly postIbbHash?: Uint8Array;
  readonly pmda?: readonly VendorEntry[];
  readonly unknownElementFirst?: boolean;
}): Uint8Array {
  const pmda = options.pmda ?? [];
  const writer = new BinaryWriter()
    .raw(idBytes({ low: BootPolicy.structureIdLow, high: BootPolicy.structureIdHigh }))
    .u8(0x10) // Version
    .fill(5, 0) // Reserved0 … Reserved1
    .u16(0); // NemDataSize
  if (options.unknownElementFirst === true) {
    writer.raw(idBytes(TXTS)).u8(1).fill(0x20, 0);
  }
  writer
    .raw(idBytes({ low: BootPolicy.ibbsLow, high: BootPolicy.ibbsHigh }))
    .u8(1)
    .fill(3, 0) // Reserved
    .u32(0) // Flags
    .fill(0x28, 0) // MchBar … DmaProtectionLimit1
    .raw(hashV1(options.postIbbHash ?? ZERO32))
    .u32(0xffff_fff0) // IbbEntryPoint
    .raw(hashV1(options.ibbHash))
    .u8(options.segments.length)
    .raw(segmentBytes(options.segments));
  if (pmda.length > 0) {
    writer
      .raw(idBytes({ low: BootPolicy.pmdaLow, high: BootPolicy.pmdaHigh }))
      .u8(1)
      .u16(0x0a + pmda.length * 0x28)
      .u32(1) // Version
      .u32(pmda.length);
    for (const entry of pmda) writer.u32(entry.base).u32(entry.size).raw(entry.hash);
  }
  return writer
    .raw(idBytes({ low: BootPolicy.pmsgLow, high: BootPolicy.pmsgHigh }))
    .u8(1)
    .fill(0x40, 0x5a).bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.element */
export function element(
  id: { readonly low: number; readonly high: number },
  body: Uint8Array
): Uint8Array {
  return new BinaryWriter()
    .raw(idBytes(id))
    .u8(0x20) // Version
    .u8(0) // HeaderSpecific
    .u16(12 + body.length)
    .raw(body).bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.bootPolicyV2 */
export function bootPolicyV2(options: {
  readonly segments: readonly TestSegment[];
  readonly ibbDigests: readonly { readonly algorithm: number; readonly bytes: Uint8Array }[];
  readonly postIbb?: Uint8Array;
  readonly obb?: Uint8Array;
  readonly pmda?: readonly VendorEntry[];
}): Uint8Array {
  const pmda = options.pmda ?? [];
  const writer = new BinaryWriter()
    .raw(idBytes({ low: BootPolicy.structureIdLow, high: BootPolicy.structureIdHigh }))
    .u8(0x21) // Version
    .u8(0) // HeaderSpecific
    .u16(0x14) // TotalSize
    .u16(0) // KeySignatureOffset
    .fill(4, 0) // BpmRevision, BpSvn, AcmSvn, Reserved
    .u16(0) // NemDataSize
    .raw(element(TXTS, new Uint8Array(0x20).fill(0x77)));

  const ibbs = new BinaryWriter()
    .fill(4, 0) // Reserved0, SetNumber, Reserved1, PbetValue
    .u32(0) // Flags
    .fill(0x28, 0) // MchBar … DmaProtectionLimit1
    .raw(hashV2(options.postIbb ?? ZERO32))
    .u32(0xffff_fff0); // IbbEntryPoint
  const digests = new BinaryWriter();
  for (const digest of options.ibbDigests) digests.raw(hashV2(digest.bytes, digest.algorithm));
  ibbs
    .u16(digests.count)
    .u16(options.ibbDigests.length)
    .raw(digests.bytes)
    .raw(hashV2(options.obb ?? ZERO32))
    .fill(3, 0)
    .u8(options.segments.length)
    .raw(segmentBytes(options.segments));
  writer.raw(element({ low: BootPolicy.ibbsLow, high: BootPolicy.ibbsHigh }, ibbs.bytes));

  if (pmda.length > 0) {
    const entries = new BinaryWriter();
    for (const entry of pmda) {
      const hash = hashV2(entry.hash);
      entries
        .u32(0x4144_4d50) // EntryId
        .u32(entry.base)
        .u32(entry.size)
        .u16(0x10 + hash.length)
        .u16(1)
        .raw(hash);
    }
    const body = new BinaryWriter()
      .u16(0)
      .u16(0x0c + entries.count)
      .u32(3)
      .u32(pmda.length)
      .raw(entries.bytes).bytes;
    writer.raw(element({ low: BootPolicy.pmdaLow, high: BootPolicy.pmdaHigh }, body));
  }
  return writer.raw(
    element({ low: BootPolicy.pmsgLow, high: BootPolicy.pmsgHigh }, new Uint8Array(0x40).fill(0x5a))
  ).bytes;
}

/**
 * A header, a microcode row the reading passes over, and the Boot Policy.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.fitTable
 */
export function fitTable(bootPolicyAt: number): Uint8Array {
  const writer = new BinaryWriter();
  const row = (low: number, high: number, size: number, type: number) => {
    writer.u32(low).u32(high).u24(size).u8(0).u16(0x0100).u8(type).u8(0);
  };
  row(BootPolicy.fitSignatureLow, BootPolicy.fitSignatureHigh, 3, 0);
  row(0xffff_0000, 0, 0, 0x01);
  row(bootPolicyAt, 0, 0, BootPolicy.fitType);
  return writer.bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.vendorEntry */
export const vendorEntryBytes = (entry: VendorEntry): Uint8Array =>
  new BinaryWriter().raw(entry.hash).u32(entry.base).u32(entry.size).bytes;

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.amiFile */
export const amiFile = (body: Uint8Array): Uint8Array =>
  Test.sectionedFile({
    guid: AMI_HASH_FILE,
    type: 0x02,
    sections: [Test.section({ type: Section.raw, body })],
  });

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.phoenixFile */
export function phoenixFile(entries: readonly VendorEntry[]): Uint8Array {
  const writer = new BinaryWriter()
    .u32(BootPolicy.phoenixSignatureLow)
    .u32(BootPolicy.phoenixSignatureHigh)
    .u32(entries.length);
  for (const entry of entries) writer.raw(vendorEntryBytes(entry));
  return Test.file({ guid: PHOENIX_HASH_FILE, body: writer.bytes });
}

/**
 * A 64 KiB image mapped flush against the top of the address space: a DXE volume
 * first, then a volume holding the FIT, the Boot Policy, data for the IBB to
 * cover and the Volume Top File. The files are laid out before their contents
 * are written, so what points at what is known up front.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage
 */
export class BootGuardImage {
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.size */
  static readonly size = 0x10000;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.addressDiff */
  static readonly addressDiff = 0x1_0000_0000 - BootGuardImage.size;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.dxeVolume */
  static readonly dxeVolume: ImageRange = { start: 0, end: 0x4000 };
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.fitGUID */
  static readonly fitGuid = guid("F17A0000-0000-4000-8000-000000000001");
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.policyGUID */
  static readonly policyGuid = guid("F17A0000-0000-4000-8000-000000000002");
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.ibbGUID */
  static readonly ibbGuid = guid("F17A0000-0000-4000-8000-000000000003");

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.bytes */
  bytes: Uint8Array;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.fit */
  readonly fit: ImageRange;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.policy */
  readonly policy: ImageRange;
  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.ibb */
  readonly ibb: ImageRange;
  /**
   * The body of the AMI hash file's raw section, when one was asked for.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.amiTable
   */
  readonly amiTable: ImageRange | undefined;

  constructor(
    options: {
      readonly dxeCoreCompressed?: boolean;
      readonly extraFiles?: readonly Uint8Array[];
    } = {}
  ) {
    const core = Test.file({ guid: DXE_CORE, body: new Uint8Array(0x40).fill(0x33) });
    const dxeFiles = options.dxeCoreCompressed === true ? [compressedDxeFile()] : [core];
    const data = Uint8Array.from({ length: 0x800 }, (_, index) => (index * 7 + 3) & 0xff);
    const main = Test.volume({
      length: 0xc000,
      files: [
        Test.file({ guid: BootGuardImage.fitGuid, body: new Uint8Array(0x100).fill(0xff) }),
        Test.file({ guid: BootGuardImage.policyGuid, body: new Uint8Array(0x400).fill(0xff) }),
        Test.file({ guid: BootGuardImage.ibbGuid, body: data }),
        ...(options.extraFiles ?? []),
      ],
      lastFile: Test.volumeTopFile({ size: 0x100 }),
    });
    const dxe = Test.volume({ length: 0x4000, files: dxeFiles });
    this.bytes = new Uint8Array(dxe.length + main.length);
    this.bytes.set(dxe);
    this.bytes.set(main, dxe.length);

    const nodes = parseUefiImage(sourceOver(this.bytes), {
      readsProtectedRanges: false,
    }).roots.flatMap((root) => flattened(root));
    const body = (id: EFIGUID): ImageRange => {
      const found = nodes.find(
        (node) => node.kind === "file" && node.guid !== undefined && guidEquals(node.guid, id)
      );
      if (found === undefined) throw new Error("the fixture's own file is missing");
      return found.body;
    };
    this.fit = body(BootGuardImage.fitGuid);
    this.policy = body(BootGuardImage.policyGuid);
    this.ibb = body(BootGuardImage.ibbGuid);
    const ami = nodes.find(
      (node) => node.guid !== undefined && guidEquals(node.guid, AMI_HASH_FILE)
    );
    this.amiTable =
      ami === undefined
        ? undefined
        : flattened(ami).find((one) => one.kind === "section" && one.subtype === Section.raw)?.body;
  }

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.address */
  address(offset: number): number {
    return offset + BootGuardImage.addressDiff;
  }

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.write */
  write(data: Uint8Array, at: number): void {
    this.bytes.set(data, at);
  }

  /**
   * The manifest into its file, a FIT pointing at it, and the pointer at
   * `0xFFFFFFC0` — inside the Volume Top File, where it is in a real image.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.install
   */
  install(manifest: Uint8Array): void {
    this.write(manifest, this.policy.start);
    this.write(fitTable(this.address(this.policy.start)), this.fit.start);
    this.write(
      new BinaryWriter().u32(this.address(this.fit.start)).bytes,
      BootGuardImage.size - 0x40
    );
  }

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.slice */
  slice(range: ImageRange): Uint8Array {
    return this.bytes.subarray(range.start, range.end);
  }

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.sha256
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.sha256
   */
  sha256Of(...ranges: readonly ImageRange[]): Uint8Array {
    const parts = ranges.map((range) => this.slice(range));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      message.set(part, at);
      at += part.length;
    }
    return sha256(message);
  }

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.ranges */
  get ranges(): ProtectedRanges {
    const parsed = parseUefiImage(sourceOver(this.bytes));
    if (parsed.protectedRanges === undefined) throw new Error("the parse read no ranges");
    return parsed.protectedRanges;
  }
}

/**
 * The volume image section a compressed DXE volume holds: one volume with the
 * DXE Core in it, which the section's stream decodes to.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#BootGuardImage.init
 */
export const dxeCoreVolumeSection = (): Uint8Array =>
  Test.section({
    type: 0x17,
    body: Test.volume({
      length: 0x400,
      files: [Test.file({ guid: DXE_CORE, body: new Uint8Array(0x40).fill(0x33) })],
    }),
  });

/** The DXE Core inside a volume inside an LZMA section, for the nesting case. */
function compressedDxeFile(): Uint8Array {
  return Test.sectionedFile({
    type: 0x0b,
    sections: [
      Test.compressionSection(
        0x02,
        streamBytes(DXE_CORE_VOLUME_LZMA),
        dxeCoreVolumeSection().length
      ),
    ],
  });
}
