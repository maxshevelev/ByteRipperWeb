import type { ImageRange } from "@/firmware/imageReader";
import { alignUp, crc32 } from "@/firmware/uefi/checksums";
import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";
import {
  microcodeRange,
  parseMicrocode,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { isFtwStore, isStoreVolume, isVss2Store } from "@/firmware/uefi/nvramGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import { ucs2String } from "@/firmware/uefi/sectionParser";
import { makeNode, makeSpan, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { FV } from "@/firmware/uefi/volumeFormat";
import { parseVolume } from "@/firmware/uefi/volumeParser";

export { isStoreVolume };

/**
 * The NVRAM volume body: a run of stores, each recognisable by a signature that
 * is not a byte the tree can read back.
 *
 * The reference parser walks the body byte by byte, trying the store
 * recognisers in a fixed order — first match wins — and calls everything in
 * between padding. The order matters: VSS before VSS2, because a GUID whose
 * first dword happens to read `$VSS` would otherwise misroute.
 */
export const NVRAM = {
  // VSS store signatures.
  vssSignature: 0x5353_5624, // $VSS
  appleSvsSignature: 0x5356_5324, // $SVS
  appleNssSignature: 0x5353_4e24, // $NSS
  /** The only store format the parser reads. */
  vssFormatted: 0x5a,
  /** The store header, signature through reserved1. */
  vssStoreHeaderSize: 16,
  /** A variable opens with the two-byte marker 0x55AA. */
  variableMarkerFirst: 0xaa,
  variableMarkerLast: 0x55,
  // Variable header sizes.
  vssStandardHeaderSize: 32,
  vssAppleHeaderSize: 36,
  vssAuthHeaderSize: 60,
  vssIntelLegacyHeaderSize: 28,
  // Variable states.
  vssVariableValid: 0x7f,
  vssVariableAdded: 0x3f,
  vssVariableIntelValid: 0xfc,
  vssVariableIntelInvalid: 0xf8,
  // Attribute bits that decide which header a variable carries.
  vssAttributeAuthWrite: 0x0000_0010,
  vssAttributeTimeBasedAuth: 0x0000_0020,
  vssAttributeAppendWrite: 0x0000_0040,
  vssAttributeAppleDataChecksum: 0x8000_0000,
  /** Signature (16) + size + format + state + reserved + reserved1. */
  vss2StoreHeaderSize: 28,
  // FTW working block headers, 32-bit and 64-bit write queue forms.
  ftwStoreHeaderSize32: 28,
  ftwStoreHeaderSize64: 32,
  /**
   * An Insyde FDC store opens `_FDC`, a size, a volume header and two block map
   * entries before the store itself: 4 + 4 + 0x38 + 2 * 8.
   */
  insydeFdcSignature: 0x4344_465f, // _FDC
  fdcStoreHeaderSize: 0x50,
  // Apple SysF / Diag store.
  appleSysfSignature: 0x7379_7346, // Fsys
  appleDiagSignature: 0x6469_6147, // Gaid
  sysfStoreHeaderSize: 11,
  /** The last four bytes of a SysF store are its CRC32, not store. */
  sysfStoreCrcSize: 4,
  sysfInvalidFlag: 0x80,
  sysfNameLengthMask: 0x7f,
  // Phoenix SCT flash map.
  phoenixFlashMapHeaderSize: 16,
  phoenixFlashMapEntrySize: 36,
  phoenixFlashMapMaxEntries: 113,
  // Phoenix EVSA.
  evsaSignature: 0x4156_5345, // EVSA
  evsaStoreHeaderSize: 20,
  evsaEntryTypeStore: 0xec,
  evsaEntryTypeGuid1: 0xed,
  evsaEntryTypeGuid2: 0xe1,
  evsaEntryTypeName1: 0xee,
  evsaEntryTypeName2: 0xe2,
  evsaEntryTypeData1: 0xef,
  evsaEntryTypeData2: 0xe3,
  evsaEntryTypeDataInvalid: 0x83,
  /**
   * A data entry whose attributes set the extended-header bit carries a
   * data-size word before its data.
   */
  evsaExtendedHeaderBit: 0x1000_0000,
  evsaDataEntryHeaderSize: 12,
  evsaExtendedDataEntryHeaderSize: 16,
  // Phoenix CMDB, a store long past use.
  cmdbSignature: 0x4244_4d43, // CMDB
  cmdbStoreSize: 0x100,
  // Microsoft SLIC pubkey and marker.
  slicPubkeySize: 0x9c,
  slicPubkeyType: 0,
  slicPubkeyMagic: 0x3141_5352, // RSA1
  slicMarkerSize: 0xb6,
  slicMarkerType: 1,
  /** The WindowsFlag field, the eight bytes "WINDOWS " read little-endian. */
  slicMarkerWindowsFlag: 0x2053_574f_444e_4957n,
  slicMarkerReservedByte: 0,
} as const;

/** `_FLASH_MAP`, the ten bytes a Phoenix SCT map opens with. */
const FLASH_MAP_SIGNATURE = Uint8Array.from("_FLASH_MAP", (one) => one.charCodeAt(0));
/** The name of the chunk that ends a SysF store, with no data after it. */
const SYSF_EOF_NAME = Uint8Array.from("EOF", (one) => one.charCodeAt(0));

function isEvsaEntryType(type: number): boolean {
  return (
    type === NVRAM.evsaEntryTypeGuid1 ||
    type === NVRAM.evsaEntryTypeGuid2 ||
    type === NVRAM.evsaEntryTypeName1 ||
    type === NVRAM.evsaEntryTypeName2 ||
    type === NVRAM.evsaEntryTypeData1 ||
    type === NVRAM.evsaEntryTypeData2 ||
    type === NVRAM.evsaEntryTypeDataInvalid
  );
}

/**
 * The body of an NVRAM volume, or nothing when this volume is not one.
 *
 * The recursion budget is the parser's own: an FDC store wraps another volume
 * body, which can wrap another. The bound is inclusive because the volume
 * parser already spends the level below `maxDepth` on this body.
 */
export function walkNvramVolumeBody(
  parser: Parser,
  fileSystem: EFIGUID,
  body: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode[] | undefined {
  if (!isStoreVolume(fileSystem)) return undefined;
  return walkStores(parser, body, emptyByte, depth);
}

function walkStores(
  parser: Parser,
  body: ImageRange,
  emptyByte: number,
  depth: number,
  fdcStoreSizeOverride?: number
): UEFINode[] {
  if (depth > parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, body.start);
    return [];
  }
  const nodes: UEFINode[] = [];
  let paddingStart = body.start;
  let storeOffset = body.start;

  while (storeOffset < body.end) {
    // Free space is a run of the erase byte, and no store starts with the erase
    // byte, so a whole run is jumped in one step instead of paying a recogniser
    // probe for every erased byte. Real NVRAM volumes end in hundreds of
    // kilobytes of free space; stepping it byte by byte would try all twelve
    // recognisers at each one — and the last (a nested firmware volume) a full
    // volume-header read.
    if (parser.reader.uint8(storeOffset) === emptyByte) {
      storeOffset =
        parser.reader.firstOffsetNotEqualTo({ start: storeOffset, end: body.end }, emptyByte) ??
        body.end;
      continue;
    }

    // The recognisers, in the order the reference parser tries them: first
    // match wins. Each decides on its own cheapest field before reading
    // anything else — this loop runs at every unclaimed byte, so a recogniser
    // that reads four fields to reject one byte costs four reads times the
    // length of the run. VSS before VSS2, because a store GUID whose first
    // dword reads `$VSS` would otherwise misroute.
    const store =
      parseVssStore(parser, storeOffset, body, emptyByte, fdcStoreSizeOverride) ??
      parseVss2Store(parser, storeOffset, body, emptyByte) ??
      parseFtwStore(parser, storeOffset, body, emptyByte) ??
      parseFdcStore(parser, storeOffset, body, emptyByte, depth) ??
      parseSysFStore(parser, storeOffset, body) ??
      parsePhoenixFlashMapStore(parser, storeOffset, body) ??
      parsePhoenixEvsaStore(parser, storeOffset, body, emptyByte) ??
      parsePhoenixCmdbStore(parser, storeOffset, body) ??
      parseSlicPublicKey(parser, storeOffset, body) ??
      parseSlicMarker(parser, storeOffset, body) ??
      microcodeStore(parser, storeOffset, body) ??
      volumeStore(parser, storeOffset, body, depth);

    if (store !== undefined) {
      const range = nodeRange(store);
      nodes.push(...nvramPadding(parser, paddingStart, range.start, emptyByte));
      nodes.push(store);
      paddingStart = range.end;
      storeOffset = range.end;
      continue;
    }
    // No store here: the byte belongs to the padding run that starts where the
    // last store ended (or at the body's start).
    storeOffset += 1;
  }
  nodes.push(...nvramPadding(parser, paddingStart, body.end, emptyByte));
  return nodes;
}

/**
 * A run of bytes between NVRAM stores. All the erase byte is free space;
 * anything in it is padding somebody put there.
 */
function nvramPadding(parser: Parser, start: number, end: number, emptyByte: number): UEFINode[] {
  if (start >= end) return [];
  const range: ImageRange = { start, end };
  if (parser.reader.isFilled(range, emptyByte)) {
    return [makeSpan({ kind: "freeSpace", name: "Free space", range, isErased: true })];
  }
  return [makeSpan({ kind: "padding", name: "Padding", range, isErased: false })];
}

// MARK: - VSS

/**
 * A VSS variable store, or nothing when the bytes at `offset` are not one.
 *
 * A candidate that fails leaves no diagnostic: a false `$VSS` inside data is
 * padding, not a defect. Inside an Insyde FDC body a plain `$VSS` store may
 * carry the "no size" marker instead of its size; the FDC parse passes its
 * body's length down so such a store still spans it.
 */
export function parseVssStore(
  parser: Parser,
  offset: number,
  body: ImageRange,
  emptyByte: number,
  fdcStoreSizeOverride?: number
): UEFINode | undefined {
  // The whole header must be in the body, and the signature decides before
  // anything else is read — this runs at every unclaimed byte of the walk, so
  // what is not a store must cost one dword.
  if (body.end - offset < NVRAM.vssStoreHeaderSize) return undefined;
  const signature = parser.reader.uint32(offset);
  if (
    signature !== NVRAM.vssSignature &&
    signature !== NVRAM.appleSvsSignature &&
    signature !== NVRAM.appleNssSignature
  ) {
    return undefined;
  }
  let storeSize = parser.reader.uint32(offset + 4);
  const format = parser.reader.uint8(offset + 8);
  if (storeSize === undefined || format !== NVRAM.vssFormatted) return undefined;

  // A `$VSS` store inside an Insyde FDC body carries the "no size" marker where
  // its size should be; it means the store is the whole FDC body, whose length
  // the FDC parse hands down. Only a plain `$VSS` gets this — an Apple `$SVS`
  // or `$NSS` store with the marker is refused, the way the reference parser
  // refuses it.
  if (
    storeSize === 0xffff_ffff &&
    fdcStoreSizeOverride !== undefined &&
    fdcStoreSizeOverride < 0xffff_ffff &&
    signature === NVRAM.vssSignature
  ) {
    storeSize = fdcStoreSizeOverride;
  }

  // The reference parser refuses a size that is not strictly between the header
  // and 0xFFFFFFFF: too small to hold a variable, or the "no size" marker an
  // FDC store leaves behind.
  if (storeSize <= NVRAM.vssStoreHeaderSize || storeSize >= 0xffff_ffff) return undefined;

  // The store may not run past the end of the body.
  const size = Math.min(storeSize, body.end - offset);
  const storeEnd = offset + size;
  const headerEnd = offset + NVRAM.vssStoreHeaderSize;

  const name =
    signature === NVRAM.appleSvsSignature
      ? "Apple SVS store"
      : signature === NVRAM.appleNssSignature
        ? "Apple NSS store"
        : "VSS store";

  return makeNode({
    kind: "vssStore",
    name,
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
    children: vssVariables(parser, headerEnd, storeEnd, emptyByte),
  });
}

/** The variables of a VSS store, walked until the marker stops. */
function vssVariables(
  parser: Parser,
  start: number,
  storeEnd: number,
  emptyByte: number
): UEFINode[] {
  const entries: UEFINode[] = [];
  let offset = start;

  while (offset < storeEnd) {
    const marker = parser.reader.uint8(offset);
    if (marker === undefined) break;
    // The marker 0x55AA opens a variable; anything else is the terminating
    // entry, and what follows is the store's free space.
    if (marker !== NVRAM.variableMarkerFirst) {
      entries.push(...nvramPadding(parser, offset, storeEnd, emptyByte));
      break;
    }
    const entry = vssVariable(parser, offset, storeEnd);
    if (entry === undefined) break;
    entries.push(entry);
    offset = nodeRange(entry).end;
  }
  return entries;
}

/**
 * One VSS variable, or nothing when its header does not check out.
 *
 * The header shape is decided by the state and attribute bits, the way the
 * reference parser's Kaitai struct decides it: Intel legacy, authenticated,
 * Apple (a data CRC), or the plain standard form.
 */
function vssVariable(parser: Parser, offset: number, storeEnd: number): UEFINode | undefined {
  const reader = parser.reader;
  if (reader.uint8(offset + 1) !== NVRAM.variableMarkerLast) return undefined;
  const state = reader.uint8(offset + 2);
  const attributes = reader.uint32(offset + 4);
  if (state === undefined || attributes === undefined) return undefined;

  const isIntelLegacy =
    state === NVRAM.vssVariableIntelInvalid || state === NVRAM.vssVariableIntelValid;

  let headerSize: number;
  let nameRange: ImageRange;
  let dataRange: ImageRange;
  let subtype: number;

  if (isIntelLegacy) {
    // Intel legacy: a total size in place of the name and data sizes, and the
    // name and value run together after the vendor GUID.
    headerSize = NVRAM.vssIntelLegacyHeaderSize;
    const totalSize = reader.uint32(offset + 8);
    if (totalSize === undefined) return undefined;
    const end = Math.min(offset + totalSize, storeEnd);
    const nameEnd = Math.min(offset + headerSize + 4, end);
    nameRange = { start: offset + headerSize, end: nameEnd };
    dataRange = { start: nameEnd, end };
    subtype = Sub.intelVssEntry;
  } else {
    // The two size fields are read up front whatever the header turns out to
    // be: for an authenticated variable they are the monotonic counter's two
    // halves. A standard variable always carries a name and data, so two fields
    // that both read zero cannot be that — the variable is authenticated, with
    // a counter that happens to be zero, and its real name and data sizes come
    // after the timestamp and key index. Firmware that never increments the
    // counter writes every variable this way, so the zero check matters as much
    // as the attribute bit.
    const sizeLow = reader.uint32(offset + 8);
    const sizeHigh = reader.uint32(offset + 12);
    if (sizeLow === undefined || sizeHigh === undefined) return undefined;

    const isAuth =
      (attributes &
        (NVRAM.vssAttributeAuthWrite |
          NVRAM.vssAttributeTimeBasedAuth |
          NVRAM.vssAttributeAppendWrite)) !==
        0 ||
      sizeLow === 0 ||
      sizeHigh === 0;

    if (isAuth) {
      // Authenticated: the name and data sizes come after the timestamp and key
      // index.
      headerSize = NVRAM.vssAuthHeaderSize;
      const nameSize = reader.uint32(offset + 36);
      const dataSize = reader.uint32(offset + 40);
      if (nameSize === undefined || dataSize === undefined) return undefined;
      const nameStart = offset + headerSize;
      const nameEnd = Math.min(nameStart + nameSize, storeEnd);
      nameRange = { start: nameStart, end: nameEnd };
      dataRange = { start: nameEnd, end: Math.min(nameEnd + dataSize, storeEnd) };
      subtype = Sub.authVssEntry;
    } else {
      // Standard, or Apple when the data-checksum bit is set (one extra word
      // after the vendor GUID).
      const apple = (attributes & NVRAM.vssAttributeAppleDataChecksum) !== 0;
      headerSize = apple ? NVRAM.vssAppleHeaderSize : NVRAM.vssStandardHeaderSize;
      const nameStart = offset + headerSize;
      const nameEnd = Math.min(nameStart + sizeLow, storeEnd);
      nameRange = { start: nameStart, end: nameEnd };
      dataRange = { start: nameEnd, end: Math.min(nameEnd + sizeHigh, storeEnd) };
      subtype = apple ? Sub.appleVssEntry : Sub.standardVssEntry;
    }
  }

  // A variable whose state is not one of the valid ones is invalid, whatever it
  // otherwise looked like.
  const isValid =
    state === NVRAM.vssVariableValid || state === NVRAM.vssVariableAdded || isIntelLegacy;
  if (!isValid) subtype = Sub.invalidVssEntry;

  // The vendor GUID is the variable's owner, and the last sixteen bytes of the
  // header before the name in every shape but Apple's — where a data-CRC word
  // follows the GUID and pushes the name four bytes on. So an authenticated
  // variable, whose header is 60 bytes long, keeps its GUID at offset 44, not
  // the 16 a standard 32-byte header does.
  const vendorGuid =
    headerSize === NVRAM.vssAppleHeaderSize
      ? reader.guid(offset + 16)
      : reader.guid(offset + headerSize - 16);

  // The name is the decoded variable name, or the vendor GUID for a variable
  // whose name is not a readable string.
  const decoded = isValid ? ucs2String(parser, nameRange) : undefined;
  const name =
    decoded !== undefined && decoded.length > 0
      ? decoded
      : vendorGuid !== undefined
        ? guidText(vendorGuid)
        : "Invalid";

  const entryEnd = Math.max(dataRange.end, nameRange.end);
  return makeNode({
    kind: "vssEntry",
    subtype,
    name: isValid ? name : "Invalid",
    guid: vendorGuid,
    header: { start: offset, end: offset + headerSize },
    body: { start: offset + headerSize, end: entryEnd },
    isFixed: true,
  });
}

// MARK: - VSS2

/**
 * A VSS2 variable store, or nothing when the bytes at `offset` are not one.
 *
 * A VSS2 store is led by a 16-byte store GUID (not a four-byte signature) and
 * is 28 bytes of header; its variables are 4-byte aligned, so the padding after
 * each one is a node of its own.
 */
export function parseVss2Store(
  parser: Parser,
  offset: number,
  body: ImageRange,
  emptyByte: number
): UEFINode | undefined {
  // Same order as the `$VSS` walk above: the GUID decides, then the rest is
  // read.
  if (body.end - offset < NVRAM.vss2StoreHeaderSize) return undefined;
  const signature = parser.reader.guid(offset);
  if (signature === undefined || !isVss2Store(signature)) return undefined;
  const storeSize = parser.reader.uint32(offset + 16);
  const format = parser.reader.uint8(offset + 20);
  if (storeSize === undefined || format !== NVRAM.vssFormatted) return undefined;
  if (storeSize <= NVRAM.vss2StoreHeaderSize || storeSize >= 0xffff_ffff) return undefined;

  const size = Math.min(storeSize, body.end - offset);
  const storeEnd = offset + size;
  const headerEnd = offset + NVRAM.vss2StoreHeaderSize;

  return makeNode({
    kind: "vss2Store",
    name: "VSS2 store",
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
    children: vss2Variables(parser, headerEnd, storeEnd, emptyByte),
  });
}

/**
 * The variables of a VSS2 store, walked until the marker stops. Each variable
 * is 4-byte aligned from its own start, so the padding after one is a node of
 * its own — the way a volume's file walk keeps its gaps.
 */
function vss2Variables(
  parser: Parser,
  start: number,
  storeEnd: number,
  emptyByte: number
): UEFINode[] {
  const entries: UEFINode[] = [];
  let offset = start;

  while (offset < storeEnd) {
    const marker = parser.reader.uint8(offset);
    if (marker === undefined) break;
    if (marker !== NVRAM.variableMarkerFirst) {
      entries.push(...nvramPadding(parser, offset, storeEnd, emptyByte));
      break;
    }
    const entry = vss2Variable(parser, offset, storeEnd);
    if (entry === undefined) break;
    entries.push(entry);

    // The alignment padding to the next four-byte boundary, counted from the
    // variable's own start, is a node of its own.
    const used = nodeRange(entry).end - offset;
    const aligned = alignUp(used, 4) ?? used;
    if (aligned > used) {
      const padEnd = Math.min(offset + aligned, storeEnd);
      const range: ImageRange = { start: nodeRange(entry).end, end: padEnd };
      entries.push(
        makeSpan({
          kind: "padding",
          name: "Padding",
          range,
          isErased: parser.reader.isFilled(range, emptyByte),
        })
      );
    }
    offset = Math.min(offset + aligned, storeEnd);
  }
  return entries;
}

/**
 * One VSS2 variable, or nothing when its header does not check out.
 *
 * The header shape is decided by the attribute bits and the two size fields:
 * authenticated (a monotonic counter in place of the sizes, a timestamp, and a
 * key index) or the plain standard form. There is no Intel legacy or Apple form
 * in VSS2, and the name sits in the header, with the data as the body.
 */
function vss2Variable(parser: Parser, offset: number, storeEnd: number): UEFINode | undefined {
  const reader = parser.reader;
  if (reader.uint8(offset + 1) !== NVRAM.variableMarkerLast) return undefined;
  const state = reader.uint8(offset + 2);
  const attributes = reader.uint32(offset + 4);
  const lenName = reader.uint32(offset + 8);
  const lenData = reader.uint32(offset + 12);
  if (
    state === undefined ||
    attributes === undefined ||
    lenName === undefined ||
    lenData === undefined
  ) {
    return undefined;
  }

  // VSS2 has no Intel legacy: a variable is authenticated when an auth bit is
  // set, or when either size field is zero.
  const isAuth =
    (attributes &
      (NVRAM.vssAttributeAuthWrite |
        NVRAM.vssAttributeTimeBasedAuth |
        NVRAM.vssAttributeAppendWrite)) !==
      0 ||
    lenName === 0 ||
    lenData === 0;

  let headerSize: number;
  let nameSize: number;
  let dataSize: number;
  let subtype: number;

  if (isAuth) {
    headerSize = NVRAM.vssAuthHeaderSize;
    const nameSizeAuth = reader.uint32(offset + 36);
    const dataSizeAuth = reader.uint32(offset + 40);
    if (nameSizeAuth === undefined || dataSizeAuth === undefined) return undefined;
    nameSize = nameSizeAuth;
    dataSize = dataSizeAuth;
    subtype = Sub.authVssEntry;
  } else {
    headerSize = NVRAM.vssStandardHeaderSize;
    nameSize = lenName;
    dataSize = lenData;
    subtype = Sub.standardVssEntry;
  }

  // The name is in the header; the data is the body.
  const nameStart = offset + headerSize;
  const nameEnd = Math.min(nameStart + nameSize, storeEnd);
  const dataEnd = Math.min(nameEnd + dataSize, storeEnd);

  const isValid = state === NVRAM.vssVariableValid || state === NVRAM.vssVariableAdded;
  if (!isValid) subtype = Sub.invalidVssEntry;

  // The vendor GUID is the sixteen bytes just before the name.
  const vendorGuid = reader.guid(offset + headerSize - 16);
  const decoded = isValid ? ucs2String(parser, { start: nameStart, end: nameEnd }) : undefined;
  const name =
    decoded !== undefined && decoded.length > 0
      ? decoded
      : vendorGuid !== undefined
        ? guidText(vendorGuid)
        : "Invalid";

  return makeNode({
    kind: "vssEntry",
    subtype,
    name: isValid ? name : "Invalid",
    guid: vendorGuid,
    header: { start: offset, end: nameEnd },
    body: { start: nameEnd, end: dataEnd },
    isFixed: true,
  });
}

// MARK: - FTW and FDC

/**
 * An FTW working block, or nothing when the bytes at `offset` are not one.
 *
 * An FTW block is led by a 16-byte signature GUID and carries a header CRC32
 * over itself with the CRC and state fields blanked to the erase value. The
 * write queue after the header is opaque: the reference parser keeps it whole.
 */
export function parseFtwStore(
  parser: Parser,
  offset: number,
  body: ImageRange,
  emptyByte: number
): UEFINode | undefined {
  if (body.end - offset < NVRAM.ftwStoreHeaderSize32) return undefined;
  const signature = parser.reader.guid(offset);
  if (signature === undefined || !isFtwStore(signature)) return undefined;
  const writeQueueSize32 = parser.reader.uint32(offset + 24);
  if (writeQueueSize32 === undefined) return undefined;

  // The write queue size's low nibble decides the header form: ending in 4 is a
  // 32-bit queue, ending in 0 a 64-bit one, anything else unknown.
  let headerSize: number;
  let writeQueueSize: number;
  switch (writeQueueSize32 % 0x10) {
    case 4:
      headerSize = NVRAM.ftwStoreHeaderSize32;
      writeQueueSize = writeQueueSize32;
      break;
    case 0: {
      if (body.end - offset < NVRAM.ftwStoreHeaderSize64) return undefined;
      const writeQueueSize64 = parser.reader.uint32(offset + 28);
      if (writeQueueSize64 === undefined) return undefined;
      headerSize = NVRAM.ftwStoreHeaderSize64;
      writeQueueSize = writeQueueSize64 * 0x1_0000_0000 + writeQueueSize32;
      break;
    }
    default:
      return undefined;
  }

  const size = Math.min(headerSize + writeQueueSize, body.end - offset);
  const storeEnd = offset + size;
  const headerEnd = offset + headerSize;

  // The header CRC32 is over the header with the CRC and state fields blanked
  // to the erase value.
  const read = parser.reader.bytesAt(offset, headerSize);
  if (read !== undefined) {
    const headerBytes = Uint8Array.from(read);
    headerBytes[16] = emptyByte;
    headerBytes[17] = emptyByte;
    headerBytes[18] = emptyByte;
    headerBytes[19] = emptyByte;
    headerBytes[20] = emptyByte;
    const stored = parser.reader.uint32(offset + 16) ?? 0;
    const computed = crc32(headerBytes);
    if (stored !== computed) {
      parser.note(
        { kind: "checksumMismatch", structure: "nvramStore", stored, computed },
        offset + 16
      );
    }
  }

  return makeNode({
    kind: "ftwStore",
    name: "FTW store",
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
  });
}

/**
 * An Insyde FDC store, or nothing when the bytes at `offset` are not one.
 *
 * An FDC store is a working copy of a variable store: `_FDC`, a size, a volume
 * header and two block map entries, then the store itself. The reference parser
 * reads what follows as an NVRAM volume body of its own, handing it the FDC
 * body's length so a `$VSS` store inside that says "no size" is understood to
 * span the whole body.
 */
export function parseFdcStore(
  parser: Parser,
  offset: number,
  body: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode | undefined {
  if (body.end - offset < NVRAM.fdcStoreHeaderSize) return undefined;
  if (parser.reader.uint32(offset) !== NVRAM.insydeFdcSignature) return undefined;
  const storeSize = parser.reader.uint32(offset + 4);
  if (storeSize === undefined) return undefined;
  if (storeSize <= NVRAM.fdcStoreHeaderSize || storeSize >= 0xffff_ffff) return undefined;

  const size = Math.min(storeSize, body.end - offset);
  const headerEnd = offset + NVRAM.fdcStoreHeaderSize;
  const storeEnd = offset + size;
  const fdcBody: ImageRange = { start: headerEnd, end: storeEnd };

  return makeNode({
    kind: "fdcStore",
    name: "Insyde FDC store",
    header: { start: offset, end: headerEnd },
    body: fdcBody,
    isFixed: true,
    children: walkStores(parser, fdcBody, emptyByte, depth + 1, fdcBody.end - fdcBody.start),
  });
}

// MARK: - Apple SysF

/**
 * An Apple SysF or Diag store, or nothing when the bytes at `offset` are not
 * one.
 *
 * A SysF store is a signature, a couple of unknown fields and a 16-bit size,
 * then a run of variables — each a length byte, an ASCII name, and a data
 * length and data — that ends with a chunk named `EOF`. The last four bytes are
 * the store's CRC32, which is how the store knows its own extent.
 */
export function parseSysFStore(
  parser: Parser,
  offset: number,
  body: ImageRange
): UEFINode | undefined {
  const reader = parser.reader;
  if (body.end - offset < NVRAM.sysfStoreHeaderSize + NVRAM.sysfStoreCrcSize) return undefined;
  const signature = reader.uint32(offset);
  if (signature !== NVRAM.appleSysfSignature && signature !== NVRAM.appleDiagSignature) {
    return undefined;
  }
  const declaredSize = reader.uint16(offset + 9);
  if (declaredSize === undefined) return undefined;

  // A store must hold its header and the CRC32 at its end, and a store that
  // declares more than the body holds is rejected: the reference parser reads
  // the store's fixed-size body whole, so a store cut short by the volume is
  // not one.
  const storeEnd = offset + declaredSize;
  if (storeEnd > body.end) return undefined;
  if (storeEnd - offset < NVRAM.sysfStoreHeaderSize + NVRAM.sysfStoreCrcSize) return undefined;

  const headerEnd = offset + NVRAM.sysfStoreHeaderSize;
  // The variables live in everything but the final CRC32.
  const regionEnd = storeEnd - NVRAM.sysfStoreCrcSize;
  const name = signature === NVRAM.appleDiagSignature ? "Apple Diag store" : "Apple SysF store";

  const entries: UEFINode[] = [];
  let cursor = headerEnd;
  while (cursor < regionEnd) {
    // A variable is a length byte (the name length in its low seven bits, the
    // invalid flag on top), the ASCII name, then a data length and the data.
    const flags = reader.uint8(cursor);
    if (flags === undefined) break;
    const invalid = (flags & NVRAM.sysfInvalidFlag) !== 0;
    const nameLength = flags & NVRAM.sysfNameLengthMask;
    const nameStart = cursor + 1;
    if (nameStart + nameLength > regionEnd) return undefined;
    const nameBytes = reader.bytesAt(nameStart, nameLength);
    if (nameBytes === undefined) return undefined;

    const subtype = invalid ? Sub.invalidSysFEntry : Sub.normalSysFEntry;

    // A chunk named "EOF" ends the store: four bytes of header and no data, and
    // the reference parser reads nothing after it.
    if (sameBytes(nameBytes, SYSF_EOF_NAME)) {
      entries.push(
        makeNode({
          kind: "sysFEntry",
          subtype,
          name: invalid ? "Invalid" : "EOF",
          header: { start: cursor, end: cursor + 4 },
          body: { start: cursor + 4, end: cursor + 4 },
          isFixed: true,
        })
      );
      cursor += 4;
      break;
    }

    const dataLengthOffset = nameStart + nameLength;
    if (dataLengthOffset + 2 > regionEnd) return undefined;
    const dataLength = reader.uint16(dataLengthOffset);
    if (dataLength === undefined) return undefined;
    const bodyStart = dataLengthOffset + 2;
    const bodyEnd = bodyStart + dataLength;
    if (bodyEnd > regionEnd) return undefined;

    entries.push(
      makeNode({
        kind: "sysFEntry",
        subtype,
        name: invalid ? "Invalid" : asciiName(nameBytes),
        header: { start: cursor, end: bodyStart },
        body: { start: bodyStart, end: bodyEnd },
        isFixed: true,
      })
    );
    cursor = bodyEnd;
  }

  // What follows the last variable is free space when it is zeroes; the CRC32
  // in the final four bytes is not part of the test.
  if (cursor < storeEnd) {
    const checkEnd = Math.max(cursor, storeEnd - NVRAM.sysfStoreCrcSize);
    const range: ImageRange = { start: cursor, end: storeEnd };
    entries.push(
      parser.reader.isFilled({ start: cursor, end: checkEnd }, 0)
        ? makeSpan({ kind: "freeSpace", name: "Free space", range })
        : makeSpan({ kind: "padding", name: "Padding", range })
    );
  }

  return makeNode({
    kind: "sysFStore",
    name,
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
    children: entries,
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * The readable prefix of a SysF variable name: its ASCII bytes up to the first
 * zero, if a stored name carries a terminator.
 */
function asciiName(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  const prefix = zero < 0 ? bytes : bytes.subarray(0, zero);
  return String.fromCharCode(...prefix);
}

// MARK: - Phoenix

/**
 * A Phoenix SCT flash map, or nothing when the bytes at `offset` are not one.
 *
 * A flash map is a 10-byte `_FLASH_MAP` signature, an entry count and a
 * reserved dword, then one fixed 36-byte entry per region of the SCT: a GUID
 * that names the region, its data and entry types, its physical address, size
 * and offset.
 */
export function parsePhoenixFlashMapStore(
  parser: Parser,
  offset: number,
  body: ImageRange
): UEFINode | undefined {
  if (body.end - offset < NVRAM.phoenixFlashMapHeaderSize) return undefined;
  const signature = parser.reader.bytesAt(offset, FLASH_MAP_SIGNATURE.length);
  if (signature === undefined || !sameBytes(signature, FLASH_MAP_SIGNATURE)) return undefined;
  const entryCount = parser.reader.uint16(offset + 10);
  if (entryCount === undefined || entryCount > NVRAM.phoenixFlashMapMaxEntries) return undefined;

  const storeSize = NVRAM.phoenixFlashMapHeaderSize + entryCount * NVRAM.phoenixFlashMapEntrySize;
  // The map runs to the length its entry count claims; a map that runs past the
  // body is not one.
  if (storeSize > body.end - offset) return undefined;

  const storeEnd = offset + storeSize;
  const headerEnd = offset + NVRAM.phoenixFlashMapHeaderSize;

  const entries: UEFINode[] = [];
  let cursor = headerEnd;
  while (cursor < storeEnd) {
    const entryEnd = cursor + NVRAM.phoenixFlashMapEntrySize;
    if (entryEnd > storeEnd) break;
    const found = parser.reader.guid(cursor);
    if (found === undefined) break;
    const dataType = parser.reader.uint16(cursor + 16) ?? 0;
    const subtype =
      dataType === 0x0000
        ? Sub.volumeFlashMapEntry
        : dataType === 0x0001
          ? Sub.dataFlashMapEntry
          : Sub.unknownFlashMapEntry;
    entries.push(
      makeNode({
        kind: "flashMapEntry",
        subtype,
        name: guidText(found),
        guid: found,
        header: { start: cursor, end: entryEnd },
        body: { start: entryEnd, end: entryEnd },
        isFixed: true,
      })
    );
    cursor = entryEnd;
  }

  return makeNode({
    kind: "flashMapStore",
    name: "Phoenix SCT flash map",
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
    children: entries,
  });
}

/**
 * A Phoenix EVSA store, or nothing when the bytes at `offset` are not one.
 *
 * An EVSA store is an entry of type 0xEC whose signature is `EVSA`, holding a
 * run of entries that define variables: GUID entries give a variable's vendor
 * GUID a numeric GuidId, name entries give a variable a name and a numeric
 * VarId, and data entries hold a value referenced by the two ids. An entry type
 * the parser does not know ends the store.
 */
export function parsePhoenixEvsaStore(
  parser: Parser,
  offset: number,
  body: ImageRange,
  emptyByte: number
): UEFINode | undefined {
  const reader = parser.reader;
  if (body.end - offset < NVRAM.evsaStoreHeaderSize) return undefined;
  if (reader.uint8(offset) !== NVRAM.evsaEntryTypeStore) return undefined;
  if (reader.uint16(offset + 2) !== NVRAM.evsaStoreHeaderSize) return undefined;
  if (reader.uint32(offset + 4) !== NVRAM.evsaSignature) return undefined;
  const declaredSize = reader.uint32(offset + 12);
  if (declaredSize === undefined || declaredSize <= NVRAM.evsaStoreHeaderSize) return undefined;

  // A store that declares more than the body holds is rejected.
  const storeEnd = offset + declaredSize;
  if (storeEnd > body.end) return undefined;

  const headerEnd = offset + NVRAM.evsaStoreHeaderSize;

  const children: UEFINode[] = [];
  const guidMap = new Map<number, EFIGUID>();
  const nameMap = new Map<number, string>();
  const dataVariables: { index: number; type: number; guidId: number; varId: number }[] = [];

  let cursor = headerEnd;
  while (cursor < storeEnd) {
    const entryType = reader.uint8(cursor);
    if (entryType === undefined) break;
    // The reference parser reads entries until the entry type is not one it
    // knows; the rest of the store is free space or padding.
    if (!isEvsaEntryType(entryType)) {
      children.push(...nvramPadding(parser, cursor, storeEnd, emptyByte));
      break;
    }
    const entrySize = reader.uint16(cursor + 2);
    if (entrySize === undefined) return undefined;
    if (cursor + entrySize > storeEnd) return undefined;
    const entryEnd = cursor + entrySize;

    let next = entryEnd;
    if (entryType === NVRAM.evsaEntryTypeGuid1 || entryType === NVRAM.evsaEntryTypeGuid2) {
      // A GUID entry is a header, an id word and the 16-byte GUID.
      if (entrySize !== 22) return undefined;
      const found = reader.guid(cursor + 6);
      if (found === undefined) return undefined;
      const guidId = reader.uint16(cursor + 4) ?? 0;
      children.push(
        makeNode({
          kind: "evsaEntry",
          subtype: Sub.guidEvsaEntry,
          name: guidText(found),
          guid: found,
          header: { start: cursor, end: cursor + 6 },
          body: { start: cursor + 6, end: entryEnd },
          isFixed: true,
        })
      );
      guidMap.set(guidId, found);
    } else if (entryType === NVRAM.evsaEntryTypeName1 || entryType === NVRAM.evsaEntryTypeName2) {
      // A name entry is a header, an id word and a UCS-2 name.
      if (entrySize < 6) return undefined;
      const varId = reader.uint16(cursor + 4) ?? 0;
      const decoded = ucs2String(parser, { start: cursor + 6, end: entryEnd }) ?? "";
      children.push(
        makeNode({
          kind: "evsaEntry",
          subtype: Sub.nameEvsaEntry,
          name: decoded,
          header: { start: cursor, end: cursor + 6 },
          body: { start: cursor + 6, end: entryEnd },
          isFixed: true,
        })
      );
      if (decoded.length > 0) nameMap.set(varId, decoded);
    } else {
      // A data entry: a GuidId, a VarId, an attributes word, and the data —
      // prefixed by a data-size word when the extended-header bit is set. It is
      // named and typed again once every entry has been read and the id maps
      // are complete.
      if (entrySize < 12) return undefined;
      const guidId = reader.uint16(cursor + 4) ?? 0;
      const varId = reader.uint16(cursor + 6) ?? 0;
      const attributes = reader.uint32(cursor + 8) ?? 0;
      const extended = (attributes & NVRAM.evsaExtendedHeaderBit) !== 0;
      const headerLength = extended
        ? NVRAM.evsaExtendedDataEntryHeaderSize
        : NVRAM.evsaDataEntryHeaderSize;
      if (entrySize < headerLength) return undefined;
      // An extended entry carries its own data size after the attributes; the
      // reference parser steps by that, not by the entry's size field, when the
      // two disagree.
      if (extended) {
        const dataSize = reader.uint32(cursor + 12);
        if (dataSize === undefined) return undefined;
        next = cursor + headerLength + dataSize;
        if (next > storeEnd) return undefined;
      }
      dataVariables.push({ index: children.length, type: entryType, guidId, varId });
      children.push(
        makeNode({
          kind: "evsaEntry",
          subtype: Sub.dataEvsaEntry,
          name: "Data",
          header: { start: cursor, end: cursor + headerLength },
          body: { start: cursor + headerLength, end: next },
          isFixed: true,
        })
      );
    }
    cursor = next;
  }

  // A data variable needs both of its ids to resolve, to a GUID entry and to a
  // name entry; a data entry marked invalid, or one whose ids resolve to
  // nothing, is invalid.
  for (const draft of dataVariables) {
    const node = children[draft.index];
    if (node === undefined) continue;
    const resolved = guidMap.has(draft.guidId) && nameMap.has(draft.varId);
    if (draft.type === NVRAM.evsaEntryTypeDataInvalid || !resolved) {
      node.name = "Invalid";
      node.subtype = Sub.invalidEvsaEntry;
    } else {
      // The name a person gave the variable is what the tree shows; the vendor
      // GUID stays out of the way the way a VSS variable's does.
      node.name = nameMap.get(draft.varId) ?? "Invalid";
    }
  }

  return makeNode({
    kind: "evsaStore",
    name: "Phoenix EVSA store",
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
    children,
  });
}

/**
 * A Phoenix CMDB store, or nothing when the bytes at `offset` are not one.
 *
 * CMDB is a store long past use: the parser reads its signature, sizes its
 * header from the store's own total size, and keeps the rest whole.
 */
export function parsePhoenixCmdbStore(
  parser: Parser,
  offset: number,
  body: ImageRange
): UEFINode | undefined {
  if (body.end - offset < NVRAM.cmdbStoreSize) return undefined;
  if (parser.reader.uint32(offset) !== NVRAM.cmdbSignature) return undefined;
  const totalSize = parser.reader.uint32(offset + 8);
  if (totalSize === undefined) return undefined;

  const storeEnd = offset + NVRAM.cmdbStoreSize;
  // The header reaches to the store's total size — never past the store itself
  // — and what follows it is the body the parser keeps whole.
  const headerEnd = offset + Math.min(totalSize, NVRAM.cmdbStoreSize);
  return makeNode({
    kind: "cmdbStore",
    name: "Phoenix CMDB store",
    header: { start: offset, end: headerEnd },
    body: { start: headerEnd, end: storeEnd },
    isFixed: true,
  });
}

// MARK: - SLIC

/**
 * A SLIC public key, or nothing when the bytes at `offset` are not one.
 *
 * A pubkey is a fixed 0x9C bytes: type and size, key material, and the `RSA1`
 * magic. The whole record is the store's header.
 */
export function parseSlicPublicKey(
  parser: Parser,
  offset: number,
  body: ImageRange
): UEFINode | undefined {
  if (body.end - offset < NVRAM.slicPubkeySize) return undefined;
  if (parser.reader.uint32(offset) !== NVRAM.slicPubkeyType) return undefined;
  if (parser.reader.uint32(offset + 4) !== NVRAM.slicPubkeySize) return undefined;
  if (parser.reader.uint32(offset + 16) !== NVRAM.slicPubkeyMagic) return undefined;

  const storeEnd = offset + NVRAM.slicPubkeySize;
  return makeNode({
    kind: "slicData",
    subtype: Sub.pubkeySlicData,
    name: "SLIC pubkey",
    header: { start: offset, end: storeEnd },
    body: { start: storeEnd, end: storeEnd },
    isFixed: true,
  });
}

/**
 * A SLIC marker, or nothing when the bytes at `offset` are not one.
 *
 * A marker is a fixed 0xB6 bytes: type and size, a version, the OEM's id and
 * table id, the eight-byte `WINDOWS ` flag, and sixteen reserved zero bytes.
 */
export function parseSlicMarker(
  parser: Parser,
  offset: number,
  body: ImageRange
): UEFINode | undefined {
  if (body.end - offset < NVRAM.slicMarkerSize) return undefined;
  if (parser.reader.uint32(offset) !== NVRAM.slicMarkerType) return undefined;
  if (parser.reader.uint32(offset + 4) !== NVRAM.slicMarkerSize) return undefined;
  // Eight bytes where every one of them matters, so read as bits.
  if (parser.reader.uint64Bits(offset + 26) !== NVRAM.slicMarkerWindowsFlag) return undefined;
  // The reserved bytes after the windows flag must all be zero.
  if (
    !parser.reader.isFilled({ start: offset + 38, end: offset + 54 }, NVRAM.slicMarkerReservedByte)
  ) {
    return undefined;
  }

  const storeEnd = offset + NVRAM.slicMarkerSize;
  return makeNode({
    kind: "slicData",
    subtype: Sub.markerSlicData,
    name: "SLIC marker",
    header: { start: offset, end: storeEnd },
    body: { start: storeEnd, end: storeEnd },
    isFixed: true,
  });
}

// MARK: - The two that delegate

/**
 * A store that is really an Intel microcode image.
 *
 * The microcode parser is the one that knows microcode, so this hands the bytes
 * to it. The reference parser only lets a candidate through when the whole
 * image fits in what is left of the body: an image that overruns it is not a
 * store, whatever its header says.
 */
function microcodeStore(parser: Parser, offset: number, body: ImageRange): UEFINode | undefined {
  const header = readMicrocodeHeader(offset, parser.reader);
  if (header === undefined) return undefined;
  const imageEnd = microcodeRange(header).end;
  if (imageEnd > body.end) return undefined;
  // Limiting the delegate to the image's own extent means it never has to cut
  // the image short; the checksum is then over the whole image.
  return parseMicrocode(parser, offset, imageEnd);
}

/**
 * A store that is really a firmware volume nested whole inside the NVRAM area.
 *
 * The `_FVH` signature is read here before the volume parser is asked: the walk
 * offers this recogniser a candidate on every byte that is not free space, and
 * the parser's own header read slices off several fields before it reaches the
 * signature.
 */
function volumeStore(
  parser: Parser,
  offset: number,
  body: ImageRange,
  depth: number
): UEFINode | undefined {
  if (parser.reader.uint32(offset + FV.signatureOffset) !== FV.signature) return undefined;
  return parseVolume(parser, { offset, limit: body.end, depth: depth + 1 });
}
