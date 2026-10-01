import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum8 } from "@/firmware/uefi/checksums";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { guidText } from "@/firmware/uefi/efiGuid";
import { nvramPadding } from "@/firmware/uefi/nvramParser";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * AMI's NVAR variable store (§9): the format Aptio firmware keeps its
 * variables in, and the one most laptops and desktop boards in a repair shop
 * carry.
 *
 * Not a store with a header of its own. An NVAR store is the body of an FFS
 * file — one of three GUIDs — or of a raw section, and it is a run of entries
 * back to back, each opening `NVAR`. Whatever follows the last entry is free
 * space, and the store's last bytes, counted from its end backwards, are a
 * table of the GUIDs the entries name by index.
 *
 * A variable is rarely one entry. Firmware does not rewrite an entry in
 * place: it clears the old one's valid bit and appends a new one, or — for a
 * variable written often — gives the first entry a `next` offset and appends
 * data-only entries along the chain. The entry that holds a variable's
 * current value is the last link of its chain, and only the first one carries
 * the name and the GUID.
 *
 * Ported from UEFITool's `NvramParser::parseNvarStore` and
 * `common/ksy/ami_nvar.ksy`, `new_engine`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NVAR
 */
export const NVAR = {
  /** `NVAR`. */
  signature: 0x5241_564e,
  /**
   * The byte the reference's walk decides on: an entry starts here, or the
   * store has ended.
   */
  signatureFirst: 0x4e,
  /** Signature, a 16-bit size, a 24-bit `next` and the attributes byte. */
  headerSize: 10,
  /** A `next` with every bit set is the end of a chain. */
  noNext: 0xff_ffff,

  // The attribute bits (`NVRAM_NVAR_ENTRY_*`).
  runtime: 0x01,
  asciiName: 0x02,
  /** The GUID is in the entry, not an index into the store's GUID table. */
  localGuid: 0x04,
  /** No GUID and no name: a later link of a chain. */
  dataOnly: 0x08,
  extendedHeader: 0x10,
  hwErrorRecord: 0x20,
  authWrite: 0x40,
  /** Cleared when the firmware supersedes the entry. */
  valid: 0x80,

  // The extended attribute bits (`NVRAM_NVAR_ENTRY_EXT_*`).
  extendedChecksum: 0x01,
  extendedAuthWrite: 0x10,
  extendedTimeBased: 0x20,

  /**
   * The extended header ends in its own 16-bit size, and is at least its
   * attributes byte and that size to count as one.
   */
  extendedHeaderMinimum: 3,
  /** The checksum, when there is one, is the byte before the size. */
  extendedChecksumMinimum: 4,
  timestampSize: 8,
  hashSize: 32,

  guidSize: 16,
} as const;

/**
 * What the walk keeps of an entry with a `next`: what the entry it points at
 * inherits.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.NvarLink
 */
interface NvarLink {
  readonly isValid: boolean;
  readonly name: string;
  readonly guid: EFIGUID | undefined;
}

/**
 * The fields of one entry, its parts laid out as header, data and extended
 * header.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.NvarEntry
 */
interface NvarEntry {
  readonly offset: number;
  readonly end: number;
  readonly next: number;
  readonly attributes: number;
  /** Where the data starts: after the GUID or its index, and the name. */
  readonly dataStart: number;
  /** Where the extended header starts, which is where the data ends. */
  readonly extendedStart: number;
  readonly guidIndex: number | undefined;
  readonly localGuid: EFIGUID | undefined;
  readonly text: string | undefined;
}

const isValidEntry = (entry: NvarEntry): boolean => (entry.attributes & NVAR.valid) !== 0;
const isDataOnlyEntry = (entry: NvarEntry): boolean => (entry.attributes & NVAR.dataOnly) !== 0;

/**
 * The entries of the NVAR store that fills `store`, then its free space and
 * its GUID table — or nothing when the bytes are not an NVAR store.
 *
 * `probe` is for a body that might be one: a raw section, which the reference
 * tries every one of. A probe that fails leaves nothing behind. A body that is
 * meant to be one — a file with an NVAR GUID — says so when it is not.
 *
 * The reference reads the whole store before it builds a node, and gives up on
 * all of it when one entry does not read. This keeps the entries before the
 * broken one and calls the rest padding: the variables a technician is looking
 * for are usually in the part that reads.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.parseNvarStore
 * @upstream-differs the entries are nodes in a plain array and the chain's links a Map keyed by offset, where upstream threads an inout counter; the walk and its outcomes are the same
 */
export function parseNvarStore(
  parser: Parser,
  store: ImageRange,
  options: { readonly emptyByte: number; readonly probe: boolean; readonly depth: number }
): UEFINode[] | undefined {
  const { emptyByte, probe, depth } = options;
  if (store.end <= store.start) return probe ? undefined : [];
  if (depth >= parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, store.start);
    return undefined;
  }

  const nodes: UEFINode[] = [];
  // Each entry with a `next`, by the offset it points at — the nearest one
  // wins, being the last written.
  const linksTo = new Map<number, NvarLink>();
  // The table at the store's end holds as many GUIDs as the highest index any
  // entry names. Nothing else says how long it is.
  const guidsInStore = { count: 0 };
  let offset = store.start;

  while (offset < store.end) {
    if (parser.reader.uint8(offset) !== NVAR.signatureFirst) {
      // The first byte that does not open an entry ends the walk: free space,
      // or padding, then the GUID table.
      return nvarStoreEnd(parser, {
        offset,
        store,
        guidsInStore: guidsInStore.count,
        emptyByte,
        probe,
        nodes,
      });
    }
    const entry = readNvarEntry(parser, offset, store);
    if (entry === undefined) {
      if (offset <= store.start) {
        if (!probe) parser.note({ kind: "unreadableNvarEntry" }, offset);
        return undefined;
      }
      parser.note({ kind: "unreadableNvarEntry" }, offset);
      return [...nodes, ...nvramPadding(parser, offset, store.end, emptyByte)];
    }

    const node = nvarNode(parser, entry, store, linksTo.get(offset), guidsInStore);
    if (entry.next !== NVAR.noNext) {
      linksTo.set(offset + entry.next, {
        isValid: node.subtype !== Sub.invalidNvarEntry && node.subtype !== Sub.invalidLinkNvarEntry,
        name: node.name,
        guid: node.guid,
      });
    }

    // An entry whose value is itself an NVAR store — the defaults a vendor
    // keeps inside one variable — opens onto it.
    if (
      (node.subtype === Sub.dataNvarEntry || node.subtype === Sub.fullNvarEntry) &&
      node.body.end - node.body.start >= 4 &&
      parser.reader.uint32(node.body.start) === NVAR.signature
    ) {
      node.children =
        parseNvarStore(parser, node.body, { emptyByte, probe: false, depth: depth + 1 }) ?? [];
    }
    nodes.push(node);
    offset = entry.end;
  }
  return nodes;
}

/**
 * The entry at `offset`, or nothing when it does not read: the signature is
 * not whole, the size is too small for the header or runs past the store, the
 * name has no end, or the extended header claims more than the data.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.readNvarEntry
 */
function readNvarEntry(parser: Parser, offset: number, store: ImageRange): NvarEntry | undefined {
  const reader = parser.reader;
  const size = reader.uint16(offset + 4);
  const next = reader.uint24(offset + 6);
  const attributes = reader.uint8(offset + 9);
  if (
    reader.uint32(offset) !== NVAR.signature ||
    size === undefined ||
    size <= NVAR.headerSize ||
    next === undefined ||
    attributes === undefined
  ) {
    return undefined;
  }
  const end = offset + size;
  if (end > store.end) return undefined;

  const valid = (attributes & NVAR.valid) !== 0;
  const dataOnly = (attributes & NVAR.dataOnly) !== 0;
  let cursor = offset + NVAR.headerSize;
  let guidIndex: number | undefined;
  let localGuid: EFIGUID | undefined;
  let text: string | undefined;

  // A valid entry that is not a later link carries its GUID, or its index into
  // the store's table, and then its name.
  if (valid && !dataOnly) {
    if ((attributes & NVAR.localGuid) !== 0) {
      if (cursor + NVAR.guidSize > end) return undefined;
      const found = reader.guid(cursor);
      if (found === undefined) return undefined;
      localGuid = found;
      cursor += NVAR.guidSize;
    } else {
      if (cursor >= end) return undefined;
      const index = reader.uint8(cursor);
      if (index === undefined) return undefined;
      guidIndex = index;
      cursor += 1;
    }
    const bytes = reader.bytes({ start: cursor, end });
    if (bytes === undefined) return undefined;
    if ((attributes & NVAR.asciiName) !== 0) {
      const zero = bytes.indexOf(0);
      if (zero < 0) return undefined;
      text = new TextDecoder("utf-8").decode(bytes.subarray(0, zero));
      cursor += zero + 1;
    } else {
      let index = 0;
      let terminated = false;
      while (index + 1 < bytes.length) {
        const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
        index += 2;
        if (unit === 0) {
          terminated = true;
          break;
        }
      }
      if (!terminated) return undefined;
      text = new TextDecoder("utf-16le").decode(bytes.subarray(0, index - 2));
      cursor += index;
    }
  }

  // The extended header sits at the entry's end and ends in its own size. The
  // reference takes the size only when it is big enough to be one, and only on
  // a valid entry.
  let extendedSize = 0;
  if (valid && (attributes & NVAR.extendedHeader) !== 0 && size > NVAR.headerSize + 2) {
    const field = reader.uint16(end - 2);
    if (field !== undefined && field >= NVAR.extendedHeaderMinimum) extendedSize = field;
  }
  if (extendedSize > end - cursor) return undefined;
  return {
    offset,
    end,
    next,
    attributes,
    dataStart: cursor,
    extendedStart: end - extendedSize,
    guidIndex,
    localGuid,
    text,
  };
}

/**
 * The node for an entry, named and classified the way the reference does.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.nvarNode
 */
function nvarNode(
  parser: Parser,
  entry: NvarEntry,
  store: ImageRange,
  previous: NvarLink | undefined,
  guidsInStore: { count: number }
): UEFINode {
  let subtype: number = Sub.fullNvarEntry;
  let name = "";
  let guid: EFIGUID | undefined;

  if (!isValidEntry(entry)) {
    subtype = Sub.invalidNvarEntry;
    name = "Invalid";
  } else {
    if (entry.next !== NVAR.noNext) subtype = Sub.linkNvarEntry;
    if (isDataOnlyEntry(entry)) {
      // A later link: the name and GUID are the chain's, taken from the entry
      // whose `next` points here. The reference searches back to the second
      // entry of the store and never the first — an off-by-one that calls a
      // chain started by the first entry broken. Every entry counts here.
      if (previous?.isValid === true) {
        name = previous.name;
        guid = previous.guid;
        if (entry.next === NVAR.noNext) subtype = Sub.dataNvarEntry;
      } else {
        subtype = Sub.invalidLinkNvarEntry;
        name = "Invalid link";
      }
    } else {
      if (entry.localGuid !== undefined) {
        guid = entry.localGuid;
      } else if (entry.guidIndex !== undefined) {
        // The table is read from the store's end backwards: index 0 is the
        // last sixteen bytes.
        const count = entry.guidIndex + 1;
        guidsInStore.count = Math.max(guidsInStore.count, count);
        if (store.end - store.start >= NVAR.guidSize * count) {
          guid = parser.reader.guid(store.end - NVAR.guidSize * count);
        }
      }
      name = entry.text ?? "";
      if (name === "") name = guid === undefined ? "" : guidText(guid);
    }
  }

  verifyNvarChecksum(parser, entry);

  return makeNode({
    kind: "nvarEntry",
    subtype,
    name,
    guid,
    header: { start: entry.offset, end: entry.dataStart },
    body: { start: entry.dataStart, end: entry.extendedStart },
    tail: { start: entry.extendedStart, end: entry.end },
    isFixed: true,
  });
}

/**
 * An entry whose extended header says it carries a checksum: the data, the
 * extended header, the size and the attributes add up to zero.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.verifyNvarChecksum
 */
function verifyNvarChecksum(parser: Parser, entry: NvarEntry): void {
  const checksum = readNvarChecksum(parser.reader, {
    entry: { start: entry.offset, end: entry.end },
    dataStart: entry.dataStart,
    extendedStart: entry.extendedStart,
  });
  if (checksum === undefined || checksum.valid) return;
  parser.note(
    {
      kind: "checksumMismatch",
      structure: "nvarEntry",
      stored: checksum.stored,
      computed: checksum.expected,
    },
    entry.end - 3
  );
}

/**
 * The end of the walk at `offset`: free space or padding up to the GUID table,
 * then the table.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#Parser.nvarStoreEnd
 */
function nvarStoreEnd(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly store: ImageRange;
    readonly guidsInStore: number;
    readonly emptyByte: number;
    readonly probe: boolean;
    readonly nodes: UEFINode[];
  }
): UEFINode[] | undefined {
  const { offset, store, guidsInStore, emptyByte, probe, nodes } = options;
  // Nothing read, and this was only a look: whatever the body is, it is not a
  // store worth showing — and a raw section can be megabytes that there is no
  // point reading to find that out.
  if (probe && offset === store.start) return undefined;
  const length = store.end - store.start;
  const tableStart = Math.max(offset, store.end - Math.min(NVAR.guidSize * guidsInStore, length));
  const rest: ImageRange = { start: offset, end: tableStart };
  const isFree = parser.reader.isFilled(rest, emptyByte);
  if (offset === store.start && !isFree) {
    // An erased body is an empty store; anything else is not a store.
    parser.note({ kind: "unreadableNvarEntry" }, offset);
    return undefined;
  }
  const result = [...nodes, ...nvramPadding(parser, rest.start, rest.end, emptyByte)];
  if (tableStart < store.end) {
    result.push(
      makeNode({
        kind: "nvarGuidStore",
        name: "GUID store",
        header: { start: tableStart, end: tableStart },
        body: { start: tableStart, end: store.end },
        isFixed: true,
      })
    );
  }
  return result;
}

/**
 * The checksum an NVAR entry's extended header may carry: the stored byte,
 * whether it adds up, and the byte that would make it.
 *
 * Public because the parser checks it and the details panel shows it, and the
 * two must not compute it two ways.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum
 */
export interface NvarChecksum {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum.stored */
  readonly stored: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum.valid */
  readonly valid: boolean;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum.expected */
  readonly expected: number;
}

/**
 * The checksum of an entry the parser read, or nothing when it carries none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum.read
 */
export function nvarChecksumOf(node: UEFINode, reader: ImageReader): NvarChecksum | undefined {
  if (node.kind !== "nvarEntry") return undefined;
  return readNvarChecksum(reader, {
    entry: nodeRange(node),
    dataStart: node.body.start,
    extendedStart: node.tail.start,
  });
}

/**
 * The sum is over the data and the extended header, the 16-bit size and the
 * attributes — not the signature, the `next` or the name, so an entry can be
 * relinked without being summed again — and is zero when it adds up. Only a
 * valid entry's extended header is read at all.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvarParser.swift#NvarChecksum.read
 */
function readNvarChecksum(
  reader: ImageReader,
  where: {
    readonly entry: ImageRange;
    readonly dataStart: number;
    readonly extendedStart: number;
  }
): NvarChecksum | undefined {
  const { entry, dataStart, extendedStart } = where;
  const offset = entry.start;
  const attributes = reader.uint8(offset + 9);
  if (
    attributes === undefined ||
    (attributes & NVAR.valid) === 0 ||
    (attributes & NVAR.extendedHeader) === 0 ||
    entry.end - extendedStart < NVAR.extendedChecksumMinimum
  ) {
    return undefined;
  }
  const extended = reader.uint8(extendedStart);
  if (extended === undefined || (extended & NVAR.extendedChecksum) === 0) return undefined;
  const stored = reader.uint8(entry.end - 3);
  const covered = reader.bytes({ start: dataStart, end: entry.end });
  const size = reader.bytesAt(offset + 4, 2);
  if (stored === undefined || covered === undefined || size === undefined) return undefined;
  const sum = (sum8(covered) + sum8(size) + attributes) & 0xff;
  return { stored, valid: sum === 0, expected: (stored - sum) & 0xff };
}
