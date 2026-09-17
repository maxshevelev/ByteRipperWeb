import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { alignUp, checksum16, sum8, sum32Of } from "@/firmware/uefi/checksums";
import { Descriptor, FLASH_REGIONS, type FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { type EFIGUID, GUID_ZERO, guid, guidBytes } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { FFS_V2, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { Microcode } from "@/firmware/uefi/microcodeParser";
import { RESET_VECTOR_SIZE } from "@/firmware/uefi/secondPass";
import { Section } from "@/firmware/uefi/sectionParser";
import { FV } from "@/firmware/uefi/volumeFormat";

/**
 * Images built by hand, byte for byte. Ported from upstream's `TestImage.swift`.
 *
 * A parser is only as trustworthy as the images it has been shown, and the
 * interesting ones are the broken ones: a stale checksum, a size of zero, a
 * block map that disagrees with the header. Those cannot be found — they have
 * to be built. So every fixture here is assembled in code with each field
 * spelled out, and every way of breaking one is a parameter.
 *
 * No real dump is ever committed to this repository, which this also settles.
 */
export class BinaryWriter {
  private readonly parts: number[] = [];

  get count(): number {
    return this.parts.length;
  }

  get bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }

  u8(value: number): this {
    this.parts.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }

  u24(value: number): this {
    return this.u16(value).u8(Math.floor(value / 0x10000));
  }

  u32(value: number): this {
    for (let index = 0; index < 4; index++) this.u8(Math.floor(value / 2 ** (8 * index)));
    return this;
  }

  u64(value: number): this {
    for (let index = 0; index < 8; index++) this.u8(Math.floor(value / 2 ** (8 * index)));
    return this;
  }

  guid(value: EFIGUID): this {
    return this.raw(guidBytes(value));
  }

  raw(value: Iterable<number>): this {
    for (const byte of value) this.parts.push(byte & 0xff);
    return this;
  }

  fill(count: number, byte: number): this {
    for (let index = 0; index < count; index++) this.parts.push(byte & 0xff);
    return this;
  }

  pad(to: number, byte: number): this {
    if (this.count < to) this.fill(to - this.count, byte);
    return this;
  }
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.driverGUID */
export const DRIVER_GUID = guid("11111111-2222-3333-4444-555555555555");

const join = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

/**
 * An FFS file, checksums correct unless a test asks otherwise.
 *
 * Raw by default, because a raw file's body is the bytes it says it is — every
 * other type's body is read as sections, which is a different test.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.file
 */
export function file(options: {
  readonly guid?: EFIGUID;
  readonly type?: number;
  readonly attributes?: number;
  readonly state?: number;
  readonly body: Uint8Array;
  readonly volumeRevision?: number;
  readonly size?: number;
  readonly headerChecksum?: number;
  readonly bodyChecksum?: number;
}): Uint8Array {
  const name = options.guid ?? DRIVER_GUID;
  const type = options.type ?? FFS.rawType;
  const attributes = options.attributes ?? 0;
  const state = options.state ?? 0xf8;
  const volumeRevision = options.volumeRevision ?? 2;
  const total = FFS.headerSize + options.body.length;
  const bodySum =
    (attributes & FFS.checksumBit) !== 0
      ? (0x100 - sum8(options.body)) & 0xff
      : volumeRevision === 1
        ? FFS.fixedChecksum
        : FFS.fixedChecksum2;

  const header = new BinaryWriter()
    .guid(name)
    .u8(0) // header checksum, filled in below
    .u8(options.bodyChecksum ?? bodySum)
    .u8(type)
    .u8(attributes)
    .u24(options.size ?? total)
    .u8(state).bytes;

  // The header sum leaves out both checksum bytes and the state byte, so
  // computing it with a zero in place of the first one is exact.
  const sum =
    (sum8(header) - (header[0x10] ?? 0) - (header[0x11] ?? 0) - (header[0x17] ?? 0)) & 0xff;
  header[0x10] = options.headerChecksum ?? (0x100 - sum) & 0xff;
  return join(header, options.body);
}

/**
 * An FFSv3 large file: the size lives in a 64-bit field after the base header,
 * and the header is eight bytes longer for it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.largeFile
 */
export function largeFile(options: {
  readonly guid?: EFIGUID;
  readonly type?: number;
  readonly body: Uint8Array;
}): Uint8Array {
  const total = FFS.largeHeaderSize + options.body.length;
  const header = new BinaryWriter()
    .guid(options.guid ?? DRIVER_GUID)
    .u8(0) // header checksum, filled in below
    .u8(FFS.fixedChecksum2)
    .u8(options.type ?? 0x07)
    .u8(FFS.largeFile)
    .u24(0)
    .u8(0xf8) // state
    .u64(total).bytes;

  const sum =
    (sum8(header) - (header[0x10] ?? 0) - (header[0x11] ?? 0) - (header[0x17] ?? 0)) & 0xff;
  header[0x10] = (0x100 - sum) & 0xff;
  return join(header, options.body);
}

/**
 * A section: a three-byte size, a type, whatever the type puts in front of the
 * body, and the body.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.section
 */
export function section(options: {
  readonly type: number;
  readonly body: Uint8Array;
  readonly extra?: Uint8Array;
  readonly size?: number;
  readonly extendedSize?: boolean;
}): Uint8Array {
  const extra = options.extra ?? new Uint8Array(0);
  const extendedSize = options.extendedSize ?? false;
  const total = 4 + (extendedSize ? 4 : 0) + extra.length + options.body.length;
  const writer = new BinaryWriter();
  if (extendedSize) {
    writer
      .u24(Section.extendedSizeMarker)
      .u8(options.type)
      .u32(options.size ?? total);
  } else {
    writer.u24(options.size ?? total).u8(options.type);
  }
  return join(writer.bytes, extra, options.body);
}

/**
 * A compression section, whose header says how big the body gets and how it was
 * squeezed.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.compressionSection
 */
export function compressionSection(
  algorithm: number,
  body: Uint8Array,
  uncompressedLength?: number
): Uint8Array {
  const extra = new BinaryWriter().u32(uncompressedLength ?? body.length * 3).u8(algorithm).bytes;
  return section({ type: Section.compression, body, extra });
}

/**
 * A GUID-defined section. `dataOffset` is from the start of the section, so a
 * vendor header between the structure and the data just moves it along.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.guidedSection
 */
export function guidedSectionBytes(options: {
  readonly guid: EFIGUID;
  readonly body: Uint8Array;
  readonly vendorHeader?: Uint8Array;
  readonly attributes?: number;
}): Uint8Array {
  const vendorHeader = options.vendorHeader ?? new Uint8Array(0);
  const extra = new BinaryWriter()
    .guid(options.guid)
    .u16(4 + Section.guidDefinedHeaderSize + vendorHeader.length)
    .u16(options.attributes ?? 0)
    .raw(vendorHeader).bytes;
  return section({ type: Section.guidDefined, body: options.body, extra });
}

/**
 * A name section: UCS-2 with a terminating zero.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.nameSection
 */
export function nameSection(text: string): Uint8Array {
  const writer = new BinaryWriter();
  for (let index = 0; index < text.length; index++) writer.u16(text.charCodeAt(index));
  writer.u16(0);
  return section({ type: Section.userInterface, body: writer.bytes });
}

/**
 * A file whose body is a run of sections, four-byte aligned.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.sectionedFile
 */
export function sectionedFile(options: {
  readonly guid?: EFIGUID;
  readonly type?: number;
  readonly sections: readonly Uint8Array[];
}): Uint8Array {
  const body = new BinaryWriter();
  for (const one of options.sections) {
    body.pad(alignUp(body.count, 4) ?? body.count, 0xff);
    body.raw(one);
  }
  return file({
    ...(options.guid === undefined ? {} : { guid: options.guid }),
    type: options.type ?? 0x07,
    body: body.bytes,
  });
}

/**
 * A Volume Top File whose last forty-eight bytes are the reset vector — which
 * is where they are in a real image, since the file's last byte is mapped at
 * `0xFFFFFFFF`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.volumeTopFile
 */
export function volumeTopFile(
  options: {
    readonly size?: number;
    readonly peiCoreEntryPoint?: number;
    readonly bootFvBaseAddress?: number;
  } = {}
): Uint8Array {
  const size = options.size ?? 0x100;
  const body = new BinaryWriter()
    .fill(size - FFS.headerSize - RESET_VECTOR_SIZE, 0xff)
    .fill(8, 0xea) // ApEntryVector
    .fill(8, 0xff) // Reserved0
    .u32(options.peiCoreEntryPoint ?? 0xfff8_0000)
    .fill(12, 0xff) // Reserved1
    .fill(8, 0x90) // ResetVector
    .u32(0xffff_0000) // ApStartupSegment
    .u32(options.bootFvBaseAddress ?? 0xfff0_0000).bytes;
  return file({ guid: VOLUME_TOP_FILE, body });
}

/**
 * A volume, its files laid out eight-byte aligned, the rest erased.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.volume
 */
export function volume(
  options: {
    readonly fileSystem?: EFIGUID;
    readonly revision?: number;
    readonly length?: number;
    readonly files?: readonly Uint8Array[];
    readonly emptyByte?: number;
    readonly blockMapLength?: number;
    readonly checksum?: number;
    readonly extendedHeader?: EFIGUID;
    readonly trailing?: Uint8Array;
    readonly lastFile?: Uint8Array;
  } = {}
): Uint8Array {
  const fileSystem = options.fileSystem ?? FFS_V2;
  const revision = options.revision ?? 2;
  const length = options.length ?? 0x400;
  const emptyByte = options.emptyByte ?? 0xff;

  // The extended header goes straight after the block map, and the base
  // header's length does not grow to cover it.
  const extHeaderOffset = options.extendedHeader === undefined ? 0 : 0x48;
  const header = new BinaryWriter()
    .fill(16, 0) // ZeroVector
    .guid(fileSystem)
    .u64(length)
    .u32(FV.signature)
    .u32(emptyByte === 0xff ? FV.erasePolarity : 0)
    .u16(0x48) // HeaderLength
    .u16(0) // Checksum, filled in below
    .u16(extHeaderOffset)
    .u8(0) // Reserved
    .u8(revision)
    .u32(1) // BlockMap: NumBlocks
    .u32(options.blockMapLength ?? length) //           Length
    .u32(0)
    .u32(0).bytes;

  const stored = options.checksum ?? checksum16(header) ?? 0;
  header[FV.checksumOffset] = stored & 0xff;
  header[FV.checksumOffset + 1] = (stored >>> 8) & 0xff;

  const writer = new BinaryWriter().raw(header);
  if (options.extendedHeader !== undefined) {
    writer.guid(options.extendedHeader).u32(0x14); // ExtHeaderSize
  }
  for (const one of options.files ?? []) {
    writer.pad(alignUp(writer.count, 8) ?? writer.count, emptyByte);
    writer.raw(one);
  }
  if (options.trailing !== undefined) writer.raw(options.trailing);
  if (options.lastFile !== undefined) {
    // Flush against the end of the volume, the way a Volume Top File is — with
    // a pad file covering the space in front of it, which is how a real volume
    // reaches one. The pad file sits on the eight-byte boundary a file walk
    // looks for it at.
    writer.pad(alignUp(writer.count, 8) ?? writer.count, emptyByte);
    const start = length - options.lastFile.length;
    const gap = start - writer.count;
    if (gap >= FFS.headerSize) {
      writer.raw(
        file({
          guid: GUID_ZERO,
          type: FFS.padType,
          body: new Uint8Array(gap - FFS.headerSize).fill(emptyByte),
        })
      );
    }
    writer.pad(start, emptyByte);
    writer.raw(options.lastFile);
  }
  writer.pad(length, emptyByte);
  return writer.bytes;
}

/**
 * An Intel microcode image, its dword checksum correct unless a test breaks it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.microcode
 */
export function microcode(
  options: {
    readonly signature?: number;
    readonly revision?: number;
    readonly year?: number;
    readonly month?: number;
    readonly day?: number;
    readonly dataSize?: number;
    readonly totalSize?: number;
    readonly headerType?: number;
    readonly loaderRevision?: number;
    readonly checksum?: number;
  } = {}
): Uint8Array {
  const dataSize = options.dataSize ?? 0x40;
  const total = options.totalSize ?? Microcode.headerSize + dataSize;
  const writer = new BinaryWriter()
    .u32(options.headerType ?? 1)
    .u32(options.revision ?? 0x1f)
    .u16(options.year ?? 0x2019)
    .u8(options.day ?? 0x15)
    .u8(options.month ?? 0x07)
    .u32(options.signature ?? 0x0003_06a9)
    .u32(0) // checksum, filled in below
    .u32(options.loaderRevision ?? 1)
    .u32(1) // PlatformIds
    .u32(dataSize)
    .u32(total)
    .u32(0) // MetadataSize
    .u32(0) // UpdateRevisionMin
    .u32(0); // Reserved

  const bytes = new Uint8Array(Math.max(total, writer.count));
  bytes.set(writer.bytes);
  bytes.fill(0x5a, writer.count);

  const sum = sum32Of({ start: 0, end: bytes.length }, new ImageReader(sourceOver(bytes))) ?? 0;
  const stored = options.checksum ?? (0x1_0000_0000 - sum) >>> 0;
  for (let index = 0; index < 4; index++) {
    bytes[0x10 + index] = Math.floor(stored / 2 ** (8 * index)) & 0xff;
  }
  return bytes;
}

export interface RegionPlacement {
  readonly type: FlashRegionType;
  readonly start: number;
  readonly end: number;
}

/**
 * An Intel flash descriptor: `0x1000` bytes, the signature at `0x10`, and a
 * region section at `RegionBase << 4`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.descriptor
 */
export function descriptor(options: {
  readonly regions: readonly RegionPlacement[];
  readonly regionBase?: number;
  readonly version1?: boolean;
  readonly reservedVector?: Uint8Array;
  readonly masterBase?: number;
  readonly masters?: readonly { readonly read: number; readonly write: number }[];
  readonly vsccBase?: number;
  readonly chips?: readonly number[];
}): Uint8Array {
  const regionBase = options.regionBase ?? 0x04;
  const bytes = new Uint8Array(Descriptor.size).fill(0xff);
  const put32 = (value: number, at: number) => {
    for (let index = 0; index < 4; index++) bytes[at + index] = (value >>> (8 * index)) & 0xff;
  };
  const put16 = (value: number, at: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >>> 8) & 0xff;
  };
  put32(Descriptor.signature, 0x10);
  put32(regionBase * 0x10000, Descriptor.mapOffset);
  put32(
    options.version1 === true ? Descriptor.reservedVersion : 0x0020_0000,
    Descriptor.versionOffset
  );

  const section = regionBase * 16;
  for (let index = 0; index < FLASH_REGIONS.length; index++) {
    const entry = section + index * 4;
    if (entry + 4 > bytes.length) break;
    const type = FLASH_REGIONS[index];
    const region = options.regions.find((one) => one.type === type);
    if (region === undefined) {
      put16(0, entry); // limit zero: the region is absent
      put16(0, entry + 2);
      continue;
    }
    put16(Math.floor(region.start / 0x1000), entry);
    put16(Math.floor((region.end - 1) / 0x1000), entry + 2);
  }

  if (options.reservedVector !== undefined) bytes.set(options.reservedVector, 0);

  // The master section and the VSCC table are written only when a test asks for
  // them: what they say is the descriptor's *detail*, not its map, and the
  // parse tests that use this fixture read neither.
  const masters = options.masters ?? [];
  if (masters.length > 0) {
    const masterBase = options.masterBase ?? 0x0a;
    put32(masterBase, 0x18);
    const base = masterBase * 16;
    for (let index = 0; index < masters.length; index++) {
      const master = masters[index];
      if (master === undefined) continue;
      if (options.version1 === true) {
        // id, read, write — four bytes a master.
        put16(0, base + index * 4);
        bytes[base + index * 4 + 2] = master.read & 0xff;
        bytes[base + index * 4 + 3] = master.write & 0xff;
      } else {
        // One dword: eight reserved bits, twelve of read, twelve of write — and
        // EC's is a dword past a reserved one.
        const offsets = [0, 4, 8, 16];
        const at = offsets[index];
        if (at === undefined) break;
        put32(((master.read & 0xfff) << 8) | ((master.write & 0xfff) << 20), base + at);
      }
    }
  }

  const chips = options.chips ?? [];
  if (chips.length > 0) {
    const vsccBase = options.vsccBase ?? 0x10;
    // The upper map: where the VSCC table is, and its length in dwords.
    put16(((chips.length * 2) << 8) | vsccBase, 0x0efc);
    const base = vsccBase * 16;
    for (let index = 0; index < chips.length; index++) {
      const id = chips[index] ?? 0;
      const entry = base + index * 8;
      bytes[entry] = (id >>> 16) & 0xff;
      bytes[entry + 1] = (id >>> 8) & 0xff;
      bytes[entry + 2] = id & 0xff;
      bytes[entry + 3] = 0;
      put32(0x2005, entry + 4);
    }
  }
  return bytes;
}

/**
 * A full flash dump: a descriptor and the contents of the regions it maps.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.intelImage
 */
export function intelImage(options: {
  readonly size: number;
  readonly regions: readonly RegionPlacement[];
  readonly contents?: ReadonlyMap<FlashRegionType, Uint8Array>;
  readonly version1?: boolean;
  readonly regionBase?: number;
}): Uint8Array {
  const bytes = new Uint8Array(options.size).fill(0xff);
  bytes.set(
    descriptor({
      regions: options.regions,
      ...(options.regionBase === undefined ? {} : { regionBase: options.regionBase }),
      ...(options.version1 === undefined ? {} : { version1: options.version1 }),
    }),
    0
  );
  for (const [type, content] of options.contents ?? new Map()) {
    const region = options.regions.find((one) => one.type === type);
    if (region === undefined) continue;
    bytes.set(content, region.start);
  }
  return bytes;
}

/**
 * A capsule wrapping an image.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.capsule
 */
export function capsule(options: {
  readonly guid?: EFIGUID;
  readonly headerSize?: number;
  readonly imageSize?: number;
  readonly romImageOffset?: number;
  readonly body: Uint8Array;
  readonly trailing?: number;
}): Uint8Array {
  const headerSize = options.headerSize ?? 0x20;
  const writer = new BinaryWriter()
    .guid(options.guid ?? guid("3B6686BD-0D76-4030-B70E-B5519E2FC5A0"))
    .u32(headerSize)
    .u32(0) // Flags
    .u32(options.imageSize ?? headerSize + options.body.length);
  if (options.romImageOffset !== undefined) {
    writer.u16(options.romImageOffset).u16(0); // RomLayoutOffset
  }
  // A signed capsule's image starts after the certificate, which is what
  // `RomImageOffset` measures — not after the header.
  writer.pad(options.romImageOffset ?? headerSize, 0xff);
  writer.raw(options.body);
  writer.fill(options.trailing ?? 0, 0xff);
  return writer.bytes;
}

/**
 * A volume with nothing before or after it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestImage.swift#TestImage.image
 */
export function image(options: {
  readonly before?: number;
  readonly volume: Uint8Array;
  readonly after?: number;
}): Uint8Array {
  return join(
    new Uint8Array(options.before ?? 0).fill(0xff),
    options.volume,
    new Uint8Array(options.after ?? 0).fill(0xff)
  );
}
