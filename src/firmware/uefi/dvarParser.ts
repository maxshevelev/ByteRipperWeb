import type { ImageReader } from "@/firmware/imageReader";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Dell's DVAR variable store (§9): the format Dell firmware keeps its own
 * settings in, beside or instead of the standard VSS store.
 *
 * A store is `DVAR`, its size and a flags byte, then entries back to back until
 * one opens on the erase byte. Every field after the signature is stored as its
 * complement — `0xFF - value`, `0xFFFF - value` — so a field is written by
 * clearing bits. An entry is a state, flags, a type that says how wide its name
 * id and data size are, attributes and a namespace id; then, on an entry that
 * declares a namespace, its GUID; then the name id, the data size and the data. A
 * variable has no name of its own: it is a number in a namespace, and an entry
 * that does not declare one names its namespace by the id another entry declared
 * it under.
 *
 * Ported from UEFITool's `FfsParser::parseRawArea` (`Types::DellDvarStore`) and
 * `common/ksy/dell_dvar.ksy`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR
 */
export const DVAR = {
  /**
   * `DVAR`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.signature
   */
  signature: 0x5241_5644,
  /**
   * Signature, the store size and the flags byte.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.headerSize
   */
  headerSize: 9,
  /**
   * State, flags, type, attributes and the namespace id.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.entryHeaderSize
   */
  entryHeaderSize: 5,
  // States, after the complement.
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.storing */
  storing: 0x01,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.stored */
  stored: 0x05,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.deleting */
  deleting: 0x15,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.deleted */
  deleted: 0x55,
  /**
   * The variable is named by a number.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.flagNameId
   */
  flagNameId: 0x02,
  /**
   * The entry declares its namespace's GUID. Its state applies to the variable it
   * carries, not to the declaration, which stands regardless.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.flagNamespaceGuid
   */
  flagNamespaceGuid: 0x04,
  // Types: how wide the name id and the data size are.
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.nameId8Size8 */
  nameId8Size8: 0x00,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.nameId16Size8 */
  nameId16Size8: 0x04,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.nameId16Size16 */
  nameId16Size16: 0x05,
} as const;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.states */
const STATES: ReadonlySet<number> = new Set([
  DVAR.storing,
  DVAR.stored,
  DVAR.deleting,
  DVAR.deleted,
]);

/**
 * One entry's header, its fields already complemented back.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.Entry
 */
export interface DvarEntry {
  readonly offset: number;
  readonly state: number;
  readonly flags: number;
  readonly type: number;
  readonly attributes: number;
  readonly namespaceId: number;
  readonly namespaceGuid: EFIGUID | undefined;
  readonly nameId: number;
  readonly dataStart: number;
  readonly end: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.Entry.declaresNamespace */
export const declaresNamespace = (entry: { readonly flags: number }): boolean =>
  entry.flags === (DVAR.flagNameId | DVAR.flagNamespaceGuid);

/**
 * The entry at `offset`, read up to the end of the store. Nothing when its fields
 * run past the store; `known` is false when its state, flags or type are none the
 * format is known to use, and the rest is not read.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.entry
 */
export function readDvarEntry(
  offset: number,
  storeEnd: number,
  reader: ImageReader
): { readonly entry: DvarEntry | undefined; readonly known: boolean } {
  const raw =
    offset + DVAR.entryHeaderSize <= storeEnd
      ? reader.bytesAt(offset, DVAR.entryHeaderSize)
      : undefined;
  if (raw === undefined) return { entry: undefined, known: true };
  const state = 0xff - (raw[0] ?? 0);
  const flags = 0xff - (raw[1] ?? 0);
  const type = 0xff - (raw[2] ?? 0);
  const known =
    STATES.has(state) &&
    (flags === DVAR.flagNameId || flags === (DVAR.flagNameId | DVAR.flagNamespaceGuid)) &&
    (type === DVAR.nameId8Size8 || type === DVAR.nameId16Size8 || type === DVAR.nameId16Size16);
  if (!known) return { entry: undefined, known: false };

  let cursor = offset + DVAR.entryHeaderSize;
  let namespaceGuid: EFIGUID | undefined;
  if ((flags & DVAR.flagNamespaceGuid) !== 0) {
    const guid = cursor + 16 <= storeEnd ? reader.guid(cursor) : undefined;
    if (guid === undefined) return { entry: undefined, known: true };
    namespaceGuid = guid;
    cursor += 16;
  }
  const wideName = type !== DVAR.nameId8Size8;
  const wideSize = type === DVAR.nameId16Size16;
  const fieldsEnd = cursor + (wideName ? 2 : 1) + (wideSize ? 2 : 1);
  if (fieldsEnd > storeEnd) return { entry: undefined, known: true };
  const nameId = wideName
    ? 0xffff - (reader.uint16(cursor) ?? 0xffff)
    : 0xff - (reader.uint8(cursor) ?? 0xff);
  cursor += wideName ? 2 : 1;
  const size = wideSize
    ? 0xffff - (reader.uint16(cursor) ?? 0xffff)
    : 0xff - (reader.uint8(cursor) ?? 0xff);
  cursor += wideSize ? 2 : 1;
  if (cursor + size > storeEnd) return { entry: undefined, known: true };
  return {
    entry: {
      offset,
      state,
      flags,
      type,
      attributes: 0xff - (raw[3] ?? 0),
      namespaceId: 0xff - (raw[4] ?? 0),
      namespaceGuid,
      nameId,
      dataStart: cursor,
      end: cursor + size,
    },
    known: true,
  };
}

/**
 * Every namespace a run of entries declares, by its id. The first declaration of
 * an id holds, as in the reference.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.namespaces
 */
export function dvarNamespaces(
  entries: readonly UEFINode[],
  reader: ImageReader
): Map<number, EFIGUID> {
  const map = new Map<number, EFIGUID>();
  for (const node of entries) {
    if (node.kind !== "dvarEntry") continue;
    const raw = reader.bytesAt(node.header.start, DVAR.entryHeaderSize);
    if (raw === undefined || 0xff - (raw[1] ?? 0) !== (DVAR.flagNameId | DVAR.flagNamespaceGuid)) {
      continue;
    }
    const guid = reader.guid(node.header.start + DVAR.entryHeaderSize);
    if (guid === undefined) continue;
    const id = 0xff - (raw[4] ?? 0);
    if (!map.has(id)) map.set(id, guid);
  }
  return map;
}

/**
 * One entry as a copy of a variable: the variable — its name id, in hex, and its
 * namespace's GUID — and whether this copy is the one in force. That is the
 * entry's own state, stored, for a namespace's declaration too: the tree shows a
 * declaration as valid whatever its state, since the declaration stands, but the
 * value it carries is replaced like any other.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.Copy
 */
export interface DvarCopy {
  readonly node: UEFINode;
  readonly name: string;
  readonly guid: EFIGUID | undefined;
  readonly isCurrent: boolean;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.copies */
export function dvarCopies(store: UEFINode, reader: ImageReader): DvarCopy[] {
  const entries = store.children.filter((child) => child.kind === "dvarEntry");
  const namespaces = dvarNamespaces(entries, reader);
  const storeEnd = Math.max(store.header.end, store.body.end, store.tail.end);
  const copies: DvarCopy[] = [];
  for (const node of entries) {
    const read = readDvarEntry(node.header.start, storeEnd, reader).entry;
    if (read === undefined) continue;
    copies.push({
      node,
      name: dvarName(read.nameId),
      guid: read.namespaceGuid ?? namespaces.get(read.namespaceId),
      isCurrent: read.state === DVAR.stored,
    });
  }
  return copies;
}

/**
 * The name a variable's entry carries: its name id, in hex, as the reference shows
 * it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#DVAR.name
 */
export const dvarName = (nameId: number): string => nameId.toString(16).toUpperCase();

/**
 * The DVAR store at `offset`, or nothing when the bytes there are not one: a size
 * that does not fit what is left, or entries that run past it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DvarParser.swift#Parser.parseDvarStore
 */
export function parseDvarStore(
  parser: Parser,
  offset: number,
  limit: number,
  emptyByte: number
): UEFINode | undefined {
  const reader = parser.reader;
  if (offset + DVAR.headerSize > limit || reader.uint32(offset) !== DVAR.signature) {
    return undefined;
  }
  const sizeC = reader.uint32(offset + 4);
  if (sizeC === undefined) return undefined;
  const size = 0xffff_ffff - sizeC;
  if (size < DVAR.headerSize || offset + size > limit) return undefined;
  const end = offset + size;

  const parsed: DvarEntry[] = [];
  const notes: {
    readonly kind: "unknownDvarEntry" | "dvarNamespaceMissing";
    readonly at: number;
  }[] = [];
  let cursor = offset + DVAR.headerSize;
  let tail: UEFINode[] = [];
  while (cursor < end) {
    // An entry that opens on the erase byte is the end of them.
    if (reader.uint8(cursor) === 0xff) {
      tail = dvarRest(parser, cursor, end, emptyByte);
      break;
    }
    const { entry, known } = readDvarEntry(cursor, end, reader);
    if (!known) {
      // Nothing after an entry of an unknown shape can be trusted to be where it
      // seems; the reference stops here too.
      notes.push({ kind: "unknownDvarEntry", at: cursor });
      tail = [
        makeSpan({
          kind: "padding",
          name: "Padding",
          range: { start: cursor, end },
          isErased: reader.isFilled({ start: cursor, end }, emptyByte),
        }),
      ];
      break;
    }
    // Fields that run past the store: not a store after all.
    if (entry === undefined) return undefined;
    parsed.push(entry);
    cursor = entry.end;
  }

  // A variable named by a number takes its namespace's GUID, from wherever in
  // the store the namespace is declared.
  const namespaces = new Map<number, EFIGUID>();
  for (const entry of parsed) {
    if (
      declaresNamespace(entry) &&
      entry.namespaceGuid !== undefined &&
      !namespaces.has(entry.namespaceId)
    ) {
      namespaces.set(entry.namespaceId, entry.namespaceGuid);
    }
  }
  const entries = parsed.map((entry) => {
    const invalid = !declaresNamespace(entry) && entry.state !== DVAR.stored;
    const subtype = invalid
      ? Sub.invalidDvarEntry
      : declaresNamespace(entry)
        ? Sub.namespaceGuidDvarEntry
        : Sub.nameIdDvarEntry;
    let name = invalid ? "Invalid" : dvarName(entry.nameId);
    let guid = entry.namespaceGuid;
    if (subtype === Sub.nameIdDvarEntry) {
      guid = namespaces.get(entry.namespaceId);
      if (guid === undefined) {
        name = "Invalid";
        notes.push({ kind: "dvarNamespaceMissing", at: entry.offset });
      }
    }
    return makeNode({
      kind: "dvarEntry",
      subtype,
      name,
      ...(guid === undefined ? {} : { guid }),
      header: { start: entry.offset, end: entry.dataStart },
      body: { start: entry.dataStart, end: entry.end },
      isFixed: true,
    });
  });
  for (const one of notes) parser.note({ kind: one.kind }, one.at);

  return makeNode({
    kind: "dvarStore",
    name: "DVAR store",
    header: { start: offset, end: offset + DVAR.headerSize },
    body: { start: offset + DVAR.headerSize, end },
    isFixed: true,
    children: [...entries, ...tail],
  });
}

/** What follows the last entry: free space when erased, padding when not. */
function dvarRest(parser: Parser, start: number, end: number, emptyByte: number): UEFINode[] {
  if (start >= end) return [];
  const range = { start, end };
  if (parser.reader.isFilled(range, emptyByte)) {
    return [makeSpan({ kind: "freeSpace", name: "Free space", range, isErased: true })];
  }
  return [makeSpan({ kind: "padding", name: "Padding", range })];
}
