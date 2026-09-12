import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { BinaryWriter, DRIVER_GUID, volume } from "@/firmware/testing/testImage";
import { crc32 } from "@/firmware/uefi/checksums";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import {
  edkiiWorkingBlockSignatureGuid,
  nvramMainStoreVolumeGuid,
  nvramVss2StoreGuid,
} from "@/firmware/uefi/nvramGuids";
import { NVRAM } from "@/firmware/uefi/nvramParser";

/**
 * NVRAM store images, built byte for byte on top of the image fixtures. Ported
 * from upstream's `TestNVRAM.swift`.
 *
 * A VSS store is a 16-byte header followed by a run of variables, each a
 * header, a UCS-2 name, and a data blob. The interesting images are the broken
 * ones — a deleted variable, a size that overruns — so every field is a
 * parameter.
 */

export const NVRAM_VOLUME_GUID = nvramMainStoreVolumeGuid;

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

const ascii = (text: string) => Uint8Array.from(text, (one) => one.charCodeAt(0));

/**
 * A UCS-2 string with a terminating zero, the way a variable name is stored in
 * a VSS store.
 */
export function ucs2(text: string): Uint8Array {
  const writer = new BinaryWriter();
  for (let index = 0; index < text.length; index++) writer.u16(text.charCodeAt(index));
  writer.u16(0);
  return writer.bytes;
}

/**
 * A standard VSS variable: the 0x55AA marker, state, attributes, the name and
 * data sizes, the vendor GUID, the name, and the data.
 */
export function vssVariable(options: {
  readonly name: string;
  readonly data?: Uint8Array;
  readonly vendorGuid?: EFIGUID;
  readonly state?: number;
  readonly attributes?: number;
}): Uint8Array {
  const data = options.data ?? Uint8Array.of(0x01, 0x02);
  const nameBytes = ucs2(options.name);
  return new BinaryWriter()
    .u8(NVRAM.variableMarkerFirst)
    .u8(NVRAM.variableMarkerLast)
    .u8(options.state ?? NVRAM.vssVariableValid)
    .u8(0) // reserved
    .u32(options.attributes ?? 0x0000_0003)
    .u32(nameBytes.length) // NameSize
    .u32(data.length) // DataSize
    .guid(options.vendorGuid ?? DRIVER_GUID)
    .raw(nameBytes)
    .raw(data).bytes;
}

/**
 * An authenticated VSS variable: a 60-byte header.
 *
 * Where a standard header keeps the name and data sizes and the vendor GUID at
 * offsets 8, 12 and 16, an authenticated one puts the two halves of a monotonic
 * counter, a timestamp and a key index before the sizes — so the real name and
 * data sizes sit at offsets 36 and 40, and the vendor GUID moves down the
 * header to its last sixteen bytes, offset 44, just before the name at 60.
 */
export function authVssVariable(options: {
  readonly name: string;
  readonly data?: Uint8Array;
  readonly vendorGuid?: EFIGUID;
  readonly state?: number;
  readonly attributes?: number;
}): Uint8Array {
  const data = options.data ?? Uint8Array.of(0x01, 0x02);
  const nameBytes = ucs2(options.name);
  return new BinaryWriter()
    .u8(NVRAM.variableMarkerFirst)
    .u8(NVRAM.variableMarkerLast)
    .u8(options.state ?? NVRAM.vssVariableAdded)
    .u8(0) // reserved
    .u32(options.attributes ?? NVRAM.vssAttributeTimeBasedAuth | 0x0000_0007)
    .u32(0) // monotonic counter, low
    .u32(0) // monotonic counter, high
    .fill(16, 0) // timestamp
    .u32(0) // key index
    .u32(nameBytes.length) // name size, at offset 36
    .u32(data.length) // data size, at offset 40
    .guid(options.vendorGuid ?? DRIVER_GUID) // vendor GUID, at offset 44
    .raw(nameBytes)
    .raw(data).bytes;
}

/**
 * A VSS store: the 16-byte header, the variables back to back, and erased free
 * space after them.
 */
export function vssStore(
  options: {
    readonly variables?: readonly Uint8Array[];
    readonly signature?: number;
    readonly state?: number;
    readonly size?: number;
    readonly freeSpace?: number;
  } = {}
): Uint8Array {
  const body = new BinaryWriter();
  for (const variable of options.variables ?? []) body.raw(variable);
  body.fill(options.freeSpace ?? 0x10, 0xff);
  const storeSize = options.size ?? NVRAM.vssStoreHeaderSize + body.count;
  const header = new BinaryWriter()
    .u32(options.signature ?? NVRAM.vssSignature)
    .u32(storeSize)
    .u8(NVRAM.vssFormatted)
    .u8(options.state ?? 0x01)
    .u16(0) // reserved
    .u32(0); // reserved1
  return join(header.bytes, body.bytes);
}

/**
 * An NVRAM volume: an FV header with the NVRAM file-system GUID, whose body is
 * the given stores laid out back to back.
 */
export function nvramVolume(
  options: {
    readonly stores?: readonly Uint8Array[];
    readonly emptyByte?: number;
    readonly length?: number;
  } = {}
): Uint8Array {
  const body = new BinaryWriter();
  for (const store of options.stores ?? []) body.raw(store);
  return volume({
    fileSystem: NVRAM_VOLUME_GUID,
    length: options.length ?? 0x48 + body.count,
    files: [],
    emptyByte: options.emptyByte ?? 0xff,
    trailing: body.bytes,
  });
}

/** A standard VSS2 variable — the same shape as a VSS one. */
export const vss2Variable = vssVariable;

/**
 * A VSS2 store: the 28-byte header led by the store GUID, the variables back to
 * back with 4-byte alignment padding, and erased free space after them.
 */
export function vss2Store(
  options: {
    readonly variables?: readonly Uint8Array[];
    readonly signature?: EFIGUID;
    readonly state?: number;
    readonly size?: number;
    readonly freeSpace?: number;
  } = {}
): Uint8Array {
  const body = new BinaryWriter();
  for (const variable of options.variables ?? []) {
    body.raw(variable);
    // 4-byte alignment padding after each variable, from its own start.
    const used = variable.length;
    const aligned = Math.ceil(used / 4) * 4;
    if (aligned > used) body.fill(aligned - used, 0xff);
  }
  body.fill(options.freeSpace ?? 0x10, 0xff);
  const storeSize = options.size ?? NVRAM.vss2StoreHeaderSize + body.count;
  const header = new BinaryWriter()
    .guid(options.signature ?? nvramVss2StoreGuid)
    .u32(storeSize)
    .u8(NVRAM.vssFormatted)
    .u8(options.state ?? 0x01)
    .u16(0)
    .u32(0);
  return join(header.bytes, body.bytes);
}

/**
 * An FTW working block: the 28-byte header led by the signature GUID, with a
 * header CRC32 over itself (CRC and state blanked to the erase byte), and an
 * opaque write queue after it.
 */
export function ftwStore(
  options: {
    readonly signature?: EFIGUID;
    readonly state?: number;
    readonly writeQueue?: Uint8Array;
    readonly emptyByte?: number;
    readonly crc?: number;
  } = {}
): Uint8Array {
  const emptyByte = options.emptyByte ?? 0xff;
  // The write queue size's low nibble must be 4 for a 32-bit queue.
  const queue = new BinaryWriter().raw(options.writeQueue ?? new Uint8Array(0));
  while (queue.count % 0x10 !== 4) queue.u8(emptyByte);

  const headerBytes = new BinaryWriter()
    .guid(options.signature ?? edkiiWorkingBlockSignatureGuid)
    .u32(0) // crc placeholder
    .u8(options.state ?? 0x01)
    .u8(0)
    .u8(0)
    .u8(0) // reserved
    .u32(queue.count).bytes;

  // The header CRC32 is over the header with the CRC and state fields blanked
  // to the erase value.
  headerBytes[16] = emptyByte;
  headerBytes[17] = emptyByte;
  headerBytes[18] = emptyByte;
  headerBytes[19] = emptyByte;
  headerBytes[20] = emptyByte;
  const finalCrc = options.crc ?? crc32(headerBytes);
  for (let index = 0; index < 4; index++) {
    headerBytes[16 + index] = (finalCrc >>> (8 * index)) & 0xff;
  }
  return join(headerBytes, queue.bytes);
}

/**
 * An Insyde FDC store: `_FDC`, a size, a volume header and two block map
 * entries (0x50 bytes of header), then the store body the reference parser
 * reads as an NVRAM volume body of its own.
 */
export function fdcStore(
  options: {
    readonly stores?: readonly Uint8Array[];
    readonly signature?: number;
    readonly size?: number;
    readonly freeSpace?: number;
  } = {}
): Uint8Array {
  const body = new BinaryWriter();
  for (const store of options.stores ?? []) body.raw(store);
  body.fill(options.freeSpace ?? 0x10, 0xff);
  const storeSize = options.size ?? NVRAM.fdcStoreHeaderSize + body.count;
  const header = new BinaryWriter()
    .u32(options.signature ?? NVRAM.insydeFdcSignature)
    .u32(storeSize)
    .fill(NVRAM.fdcStoreHeaderSize - 8, 0xff);
  return join(header.bytes, body.bytes);
}

// MARK: - Apple SysF / Diag

/**
 * A SysF variable: a name-length byte (the length in its low seven bits, the
 * invalid flag on top), the ASCII name, a data length and the data.
 */
export function sysfVariable(options: {
  readonly name: string;
  readonly data?: Uint8Array;
  readonly invalid?: boolean;
}): Uint8Array {
  const nameBytes = ascii(options.name);
  const data = options.data ?? new Uint8Array(0);
  const flags = nameBytes.length | (options.invalid === true ? NVRAM.sysfInvalidFlag : 0);
  return new BinaryWriter().u8(flags).raw(nameBytes).u16(data.length).raw(data).bytes;
}

/**
 * The chunk that ends a SysF store: a name-length byte, `EOF`, and no data
 * after it. The parser reads nothing past an EOF chunk.
 */
export function sysfEofChunk(): Uint8Array {
  return join(Uint8Array.of(3), ascii("EOF"));
}

/**
 * An Apple SysF/Diag store: the 11-byte header, the variables, an EOF chunk,
 * zero free space, and the CRC32 in the last four bytes.
 */
export function sysfStore(
  options: {
    readonly variables?: readonly Uint8Array[];
    readonly signature?: number;
    readonly size?: number;
    readonly freeSpace?: number;
  } = {}
): Uint8Array {
  const content = new BinaryWriter();
  for (const variable of options.variables ?? []) content.raw(variable);
  content.raw(sysfEofChunk());
  content.fill(options.freeSpace ?? 0x10, 0x00);
  const storeSize =
    options.size ?? NVRAM.sysfStoreHeaderSize + content.count + NVRAM.sysfStoreCrcSize;
  const header = new BinaryWriter()
    .u32(options.signature ?? NVRAM.appleSysfSignature)
    .u8(0) // unknown
    .u32(0) // unknown1
    .u16(storeSize);
  const writer = new BinaryWriter().raw(header.bytes).raw(content.bytes);
  // CRC32 over the store itself.
  return join(writer.bytes, new BinaryWriter().u32(crc32(writer.bytes)).bytes);
}

// MARK: - Phoenix SCT flash map

/**
 * A Phoenix SCT flash map entry: a region GUID, its data and entry types,
 * physical address, size and offset — one fixed 36-byte record.
 */
export function flashMapEntry(options: {
  readonly guid: EFIGUID;
  readonly dataType: number;
  readonly entryType?: number;
  readonly address?: number;
  readonly size?: number;
  readonly offset?: number;
}): Uint8Array {
  return new BinaryWriter()
    .guid(options.guid)
    .u16(options.dataType)
    .u16(options.entryType ?? 0)
    .u64(options.address ?? 0)
    .u32(options.size ?? 0)
    .u32(options.offset ?? 0).bytes;
}

/**
 * A Phoenix SCT flash map: the 16-byte header and one 36-byte entry per region.
 * `entryCount` overrides the count implied by the entries.
 */
export function flashMapStore(
  options: { readonly entries?: readonly Uint8Array[]; readonly entryCount?: number } = {}
): Uint8Array {
  const entries = options.entries ?? [];
  const writer = new BinaryWriter()
    .raw(ascii("_FLASH_MAP"))
    .u16(options.entryCount ?? entries.length)
    .u32(0); // reserved
  for (const entry of entries) writer.raw(entry);
  return writer.bytes;
}

// MARK: - Phoenix EVSA

/**
 * A Phoenix EVSA GUID entry: a type byte, a checksum, a size word, an id word
 * and the 16-byte GUID the id names.
 */
export function evsaGuidEntry(options: {
  readonly guid: EFIGUID;
  readonly id: number;
  readonly type?: number;
}): Uint8Array {
  return new BinaryWriter()
    .u8(options.type ?? NVRAM.evsaEntryTypeGuid1)
    .u8(0) // checksum
    .u16(22)
    .u16(options.id)
    .guid(options.guid).bytes;
}

/**
 * A Phoenix EVSA name entry: a type byte, a checksum, a size word, an id word
 * and the UCS-2 name the id gives a variable.
 */
export function evsaNameEntry(options: {
  readonly name: string;
  readonly id: number;
  readonly type?: number;
}): Uint8Array {
  const nameBytes = ucs2(options.name);
  return new BinaryWriter()
    .u8(options.type ?? NVRAM.evsaEntryTypeName1)
    .u8(0)
    .u16(6 + nameBytes.length)
    .u16(options.id)
    .raw(nameBytes).bytes;
}

/**
 * A Phoenix EVSA data entry: a type byte, a checksum, a size word, the GuidId
 * and VarId words, an attributes word and the data.
 */
export function evsaDataEntry(options: {
  readonly type?: number;
  readonly guidId: number;
  readonly varId: number;
  readonly data: Uint8Array;
  readonly attributes?: number;
}): Uint8Array {
  const attributes = options.attributes ?? 0x0000_0007;
  const extended = (attributes & NVRAM.evsaExtendedHeaderBit) !== 0;
  const writer = new BinaryWriter()
    .u8(options.type ?? NVRAM.evsaEntryTypeData1)
    .u8(0)
    .u16(extended ? 16 + options.data.length : 12 + options.data.length)
    .u16(options.guidId)
    .u16(options.varId)
    .u32(attributes);
  if (extended) writer.u32(options.data.length);
  return writer.raw(options.data).bytes;
}

/**
 * A Phoenix EVSA store: the 20-byte header (an entry of type 0xEC whose
 * signature is `EVSA`), the entries back to back, and erased free space.
 */
export function evsaStore(
  options: {
    readonly entries?: readonly Uint8Array[];
    readonly signature?: number;
    readonly freeSpace?: number;
    readonly size?: number;
  } = {}
): Uint8Array {
  const body = new BinaryWriter();
  for (const entry of options.entries ?? []) body.raw(entry);
  body.fill(options.freeSpace ?? 0x10, 0xff);
  const storeSize = options.size ?? NVRAM.evsaStoreHeaderSize + body.count;
  const header = new BinaryWriter()
    .u8(NVRAM.evsaEntryTypeStore)
    .u8(0) // checksum
    .u16(NVRAM.evsaStoreHeaderSize)
    .u32(options.signature ?? NVRAM.evsaSignature)
    .u32(0) // attributes
    .u32(storeSize)
    .u32(0); // reserved
  return join(header.bytes, body.bytes);
}

// MARK: - Phoenix CMDB, SLIC

/** A Phoenix CMDB store: a 0x100-byte region led by the signature and sizes. */
export function cmdbStore(totalSize = 0x10): Uint8Array {
  return new BinaryWriter()
    .u32(NVRAM.cmdbSignature)
    .u32(0x10) // header size
    .u32(totalSize)
    .fill(NVRAM.cmdbStoreSize - 12, 0xff).bytes;
}

/** A Microsoft SLIC public key: a fixed 0x9C-byte activation record. */
export function slicPubkey(): Uint8Array {
  return new BinaryWriter()
    .u32(NVRAM.slicPubkeyType)
    .u32(NVRAM.slicPubkeySize)
    .u8(0x01) // key type
    .u8(0x01) // version
    .u16(0) // reserved
    .u32(0x01) // algorithm
    .u32(NVRAM.slicPubkeyMagic) // RSA1
    .u32(0x400) // bit length
    .u32(0x10001) // exponent
    .fill(128, 0xcd).bytes; // modulus
}

/** A Microsoft SLIC marker: a fixed 0xB6-byte activation record. */
export function slicMarker(): Uint8Array {
  const writer = new BinaryWriter()
    .u32(NVRAM.slicMarkerType)
    .u32(NVRAM.slicMarkerSize)
    .u32(0x01) // version
    .raw(ascii("TESTCO")) // OEM id
    .raw(ascii("TABLID01")); // OEM table id
  // The eight-byte windows flag, written as its bytes so the bigint constant
  // does not have to be split.
  writer.raw(ascii("WINDOWS "));
  return writer
    .u32(0x01) // SLIC version
    .fill(16, 0) // reserved
    .fill(128, 0xee).bytes; // signature
}

/** A reader over an image, for the fixtures that check their own bytes. */
export const readerOver = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
