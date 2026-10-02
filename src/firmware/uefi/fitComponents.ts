import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { BootPolicy } from "@/firmware/uefi/protectedRanges";
import { addressDiffFromTail } from "@/firmware/uefi/secondPass";
import {
  FIT_POINTER_ADDRESS,
  FIT_SIGNATURE,
  findTopSwapCopy,
  topSwapped,
} from "@/firmware/uefi/topSwap";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * A structure the FIT points at that a board keeps outside every volume
 * (`UEFI_IMAGE_FORMAT.md` §9): the table itself, the Startup ACM, the Boot Guard
 * Key Manifest and Boot Policy.
 *
 * The CPU finds them by address, so a vendor is free to put them anywhere, and
 * some put them in the padding between volumes, or in the body of a pad file. The
 * scan reads those bytes as padding, as UEFITool does. The FIT says where each one
 * starts, and its own header how long it is — the FIT's size field, which for a
 * manifest gives the same length in bytes, is not trusted for it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent
 */
export interface FITComponent {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.kind */
  readonly kind: FITComponentKind;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.range */
  readonly range: ImageRange;
}

/**
 * By the FIT type that names it; the table is the header row's type.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.Kind
 */
export const FIT_COMPONENT_KINDS = {
  table: 0x00,
  startupACM: 0x02,
  keyManifest: 0x0b,
  bootPolicy: 0x0c,
} as const;
export type FITComponentKind = keyof typeof FIT_COMPONENT_KINDS;

/** @web-only the `FITComponent.Kind(rawValue:)` initialiser the enum gets from Swift for nothing */
export function fitComponentKindOf(type: number): FITComponentKind | undefined {
  return (Object.keys(FIT_COMPONENT_KINDS) as FITComponentKind[]).find(
    (kind) => FIT_COMPONENT_KINDS[kind] === type
  );
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.Kind.name */
export const fitComponentName = (kind: FITComponentKind): string =>
  ({
    table: "FIT",
    startupACM: "Startup ACM",
    keyManifest: "Boot Guard Key Manifest",
    bootPolicy: "Boot Guard Boot Policy",
  })[kind];

/** `__KEYM__`. */
const KEY_MANIFEST_ID = 0x5f5f_4d59_454b_5f5fn;
/** `__ACBP__`, `__IBBS__`, `__PMDA__`, `__PMSG__`: the Boot Policy's own, as eight bytes. */
const BOOT_POLICY_ID = 0x5f5f_5042_4341_5f5fn;
const IBBS = 0x5f5f_5342_4249_5f5fn;
const PMDA = 0x5f5f_4144_4d50_5f5fn;
const PMSG = 0x5f5f_4753_4d50_5f5fn;
const ACM_MODULE_TYPE = 0x0002;
const INTEL_VENDOR = 0x8086;
/** Larger than any of them is: a length past it is not a length. */
const LARGEST_MANIFEST = 0x1_0000;
const LARGEST_ACM = 0x10_0000;
const ROW_SIZE = 16;

/**
 * Every component the FIT of the image in `reader` names, in file order, given
 * where the image sits in the address space — and, when the image keeps a Top Swap
 * copy, the same components in the copy.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.all
 */
export function allFITComponents(reader: ImageReader, addressDiff: number): FITComponent[] {
  const offsetOf = (address: number): number | undefined =>
    address >= addressDiff && address - addressDiff < reader.count
      ? address - addressDiff
      : undefined;
  const pointer = offsetOf(FIT_POINTER_ADDRESS);
  const tableAddress = pointer === undefined ? undefined : reader.uint32(pointer);
  const table = tableAddress === undefined ? undefined : offsetOf(tableAddress);
  const tableLength = table === undefined ? undefined : lengthOf("table", table, reader);
  if (
    pointer === undefined ||
    tableAddress === undefined ||
    table === undefined ||
    tableLength === undefined
  ) {
    return [];
  }

  const found: FITComponent[] = [
    { kind: "table", range: { start: table, end: table + tableLength } },
  ];
  for (let row = table + ROW_SIZE; row < table + tableLength; row += ROW_SIZE) {
    const type = reader.uint8(row + 0x0e);
    const kind = type === undefined ? undefined : fitComponentKindOf(type & 0x7f);
    const address = reader.uint64(row);
    const start = address === undefined ? undefined : offsetOf(address);
    if (kind === undefined || kind === "table" || start === undefined) continue;
    const length = lengthOf(kind, start, reader);
    if (length === undefined) continue;
    const component: FITComponent = { kind, range: { start, end: start + length } };
    if (
      !found.some(
        (one) =>
          one.kind === component.kind &&
          one.range.start === component.range.start &&
          one.range.end === component.range.end
      )
    ) {
      found.push(component);
    }
  }

  // The copy names the top block's addresses, so its components are the top
  // block's, moved down by the block's size.
  const copy = findTopSwapCopy(
    {
      pointerOffset: pointer,
      pointerAddress: tableAddress,
      table: { start: table, end: table + tableLength },
    },
    reader
  );
  if (copy !== undefined) {
    for (const component of [...found]) {
      if (component.range.start < copy.top.start || component.range.start >= copy.top.end) continue;
      const start = topSwapped(copy, component.range.start);
      const size = component.range.end - component.range.start;
      if (lengthOf(component.kind, start, reader) === size) {
        found.push({ kind: component.kind, range: { start, end: start + size } });
      }
    }
  }
  return found.sort((left, right) => left.range.start - right.range.start);
}

/**
 * How long the component of `kind` at `offset` says it is, or nothing when what is
 * there is not one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponent.length
 */
export function lengthOf(
  kind: FITComponentKind,
  offset: number,
  reader: ImageReader
): number | undefined {
  let length: number | undefined;
  switch (kind) {
    case "table": {
      const rows = reader.uint24(offset + 8);
      if (reader.uint64Bits(offset) !== FIT_SIGNATURE || rows === undefined || rows === 0) {
        return undefined;
      }
      length = rows * ROW_SIZE;
      break;
    }
    case "startupACM": {
      const dwords = reader.uint32(offset + 0x18);
      if (
        reader.uint16(offset) !== ACM_MODULE_TYPE ||
        reader.uint32(offset + 0x10) !== INTEL_VENDOR ||
        dwords === undefined ||
        dwords * 4 > LARGEST_ACM
      ) {
        return undefined;
      }
      length = dwords * 4;
      break;
    }
    case "keyManifest":
      length = keyManifestLength(offset, reader);
      break;
    case "bootPolicy":
      length = bootPolicyLength(offset, reader);
      break;
  }
  if (length === undefined || length <= 0) return undefined;
  return reader.has({ start: offset, end: offset + length }) ? length : undefined;
}

/**
 * v1: the header, one hash, the key and signature. v2: the key and signature at the
 * offset the header gives.
 */
function keyManifestLength(offset: number, reader: ImageReader): number | undefined {
  const version = reader.uint8(offset + 8);
  if (reader.uint64Bits(offset) !== KEY_MANIFEST_ID || version === undefined) return undefined;
  let keySignature: number;
  if (version < BootPolicy.v2MinVersion) {
    const hashLength = reader.uint16(offset + 0x0e);
    if (hashLength === undefined) return undefined;
    keySignature = 0x10 + hashLength;
  } else {
    const at = reader.uint16(offset + 0x0c);
    if (at === undefined) return undefined;
    keySignature = at;
  }
  return manifestLength(keySignature, offset, reader);
}

/**
 * v2: the key and signature at the offset the header gives. v1 has no such offset
 * and no element sizes: its elements are stepped over by what each is known to
 * hold, up to the `__PMSG__` that ends them.
 */
function bootPolicyLength(offset: number, reader: ImageReader): number | undefined {
  const version = reader.uint8(offset + 8);
  if (reader.uint64Bits(offset) !== BOOT_POLICY_ID || version === undefined) return undefined;
  if (version >= BootPolicy.v2MinVersion) {
    const at = reader.uint16(offset + 0x0c);
    return at === undefined ? undefined : manifestLength(at, offset, reader);
  }
  let element = offset + BootPolicy.v1HeaderSize;
  for (let count = 0; count < BootPolicy.maxElements; count++) {
    if (element - offset >= LARGEST_MANIFEST) return undefined;
    const id = reader.uint64Bits(element);
    if (id === undefined) return undefined;
    const body = element + BootPolicy.v1ElementHeaderSize;
    if (id === IBBS) {
      const segments = reader.uint8(body + 0x7b);
      if (segments === undefined) return undefined;
      element = body + 0x7c + segments * BootPolicy.segmentSize;
    } else if (id === PMDA) {
      const entries = reader.uint32(body + 6);
      const version2 = reader.uint32(body + 2);
      const entrySize = version2 === 1 ? 0x28 : version2 === 2 ? 0x2c : undefined;
      if (entries === undefined || entrySize === undefined) return undefined;
      element = body + 0x0a + entries * entrySize;
    } else if (id === PMSG) {
      return manifestLength(body - offset, offset, reader);
    } else {
      return undefined;
    }
  }
  return undefined;
}

/**
 * A manifest ends with its key and signature (`KEY_AND_SIGNATURE`): a version and
 * key id, the public key — version, size in bits, exponent, modulus — then the
 * scheme and the signature — version, size in bits, hash algorithm, the signature
 * itself.
 */
function manifestLength(
  keySignature: number,
  offset: number,
  reader: ImageReader
): number | undefined {
  const at = offset + keySignature;
  const keyBits = reader.uint16(at + 4);
  if (keyBits === undefined || keyBits === 0 || keyBits % 8 !== 0) return undefined;
  const signatureBits = reader.uint16(at + 13 + keyBits / 8);
  if (signatureBits === undefined || signatureBits === 0 || signatureBits % 8 !== 0) {
    return undefined;
  }
  const length = keySignature + 17 + keyBits / 8 + signatureBits / 8;
  return length <= LARGEST_MANIFEST ? length : undefined;
}

/**
 * What a component's header says, as far as this tool reads it
 * (`UEFI_IMAGE_FORMAT.md` §9): the fields UEFITool shows for it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponentHeader
 */
export type FITComponentHeader =
  /** The number of rows, the header row among them. */
  | { readonly kind: "table"; readonly rows: number }
  /** `date` as the ACM stores it, BCD `yyyy-mm-dd`. */
  | {
      readonly kind: "acm";
      readonly subtype: number;
      readonly headerVersion: number;
      readonly chipsetID: number;
      readonly date: string;
      readonly svn: number;
    }
  | {
      readonly kind: "keyManifest";
      readonly version: number;
      readonly kmVersion: number;
      readonly svn: number;
      readonly id: number;
    }
  | {
      readonly kind: "bootPolicy";
      readonly version: number;
      readonly revision: number;
      readonly svn: number;
      readonly acmSVN: number;
    };

const hexDigits = (value: number, width: number): string =>
  value.toString(16).toUpperCase().padStart(width, "0");

/** @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponentHeader.read */
export function readFITComponentHeader(
  kind: FITComponentKind,
  offset: number,
  reader: ImageReader
): FITComponentHeader | undefined {
  switch (kind) {
    case "table": {
      const rows = reader.uint24(offset + 8);
      return rows === undefined ? undefined : { kind: "table", rows };
    }
    case "startupACM": {
      const subtype = reader.uint16(offset + 2);
      const headerVersion = reader.uint32(offset + 8);
      const chipsetID = reader.uint16(offset + 0x0c);
      const day = reader.uint8(offset + 0x14);
      const month = reader.uint8(offset + 0x15);
      const year = reader.uint16(offset + 0x16);
      const svn = reader.uint16(offset + 0x1c);
      if (
        subtype === undefined ||
        headerVersion === undefined ||
        chipsetID === undefined ||
        day === undefined ||
        month === undefined ||
        year === undefined ||
        svn === undefined
      ) {
        return undefined;
      }
      return {
        kind: "acm",
        subtype,
        headerVersion,
        chipsetID,
        date: `${hexDigits(year, 4)}-${hexDigits(month, 2)}-${hexDigits(day, 2)}`,
        svn,
      };
    }
    case "keyManifest": {
      // v2 moves the fields past the key signature's offset and three reserved
      // bytes.
      const version = reader.uint8(offset + 8);
      if (version === undefined) return undefined;
      const fields = offset + (version < BootPolicy.v2MinVersion ? 9 : 0x11);
      const kmVersion = reader.uint8(fields);
      const svn = reader.uint8(fields + 1);
      const id = reader.uint8(fields + 2);
      if (kmVersion === undefined || svn === undefined || id === undefined) return undefined;
      return { kind: "keyManifest", version, kmVersion, svn, id };
    }
    case "bootPolicy": {
      const version = reader.uint8(offset + 8);
      if (version === undefined) return undefined;
      const fields = offset + (version < BootPolicy.v2MinVersion ? 0x0a : 0x0e);
      const revision = reader.uint8(fields);
      const svn = reader.uint8(fields + 1);
      const acmSVN = reader.uint8(fields + 2);
      if (revision === undefined || svn === undefined || acmSVN === undefined) return undefined;
      return { kind: "bootPolicy", version, revision, svn, acmSVN };
    }
  }
}

/**
 * The ACM's module subtype, by the names UEFITool gives them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#FITComponentHeader.acmSubtypeName
 */
export function acmSubtypeName(subtype: number): string | undefined {
  switch (subtype) {
    case 0:
      return "TXT";
    case 1:
      return "Startup";
    case 3:
      return "Boot Guard";
    default:
      return undefined;
  }
}

/**
 * What the FIT of the image this parser reads names, worked out once: every raw
 * area the parser scans asks.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#Parser.fitComponents
 */
export function fitComponentsOf(parser: Parser): readonly FITComponent[] {
  if (parser.fitComponentsCache !== undefined) return parser.fitComponentsCache;
  const addressDiff = addressDiffFromTail(parser);
  const found = addressDiff === undefined ? [] : allFITComponents(parser.reader, addressDiff);
  parser.fitComponentsCache = found;
  return found;
}

/**
 * `nodes` with every structure the FIT names that lies wholly inside a stretch of
 * padding read out of it (`UEFI_IMAGE_FORMAT.md` §9), the way the flash device
 * map's regions are. Like those, this runs before the second pass has the mapping,
 * so it takes it from a Volume Top File at the image's tail; an image with no VTF
 * at its tail keeps its padding.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FITComponents.swift#Parser.readingFITComponents
 */
export function readingFITComponents(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  if (!nodes.some((node) => node.kind === "padding")) return [...nodes];
  const result = [...nodes];
  for (const component of fitComponentsOf(parser)) {
    const index = result.findIndex((node) => {
      const around = nodeRange(node);
      return (
        node.kind === "padding" &&
        !node.isErased &&
        around.start <= component.range.start &&
        component.range.end <= around.end
      );
    });
    if (index < 0) continue;
    const around = nodeRange(result[index] as UEFINode);
    result.splice(
      index,
      1,
      ...parser.padding(around.start, component.range.start, emptyByte),
      makeNode({
        kind: "fitComponent",
        subtype: FIT_COMPONENT_KINDS[component.kind],
        name: fitComponentName(component.kind),
        header: { start: component.range.start, end: component.range.start },
        body: component.range,
        // The FIT names it by address: moved, it is not found.
        isFixed: true,
      }),
      ...parser.padding(component.range.end, around.end, emptyByte)
    );
  }
  return result;
}
