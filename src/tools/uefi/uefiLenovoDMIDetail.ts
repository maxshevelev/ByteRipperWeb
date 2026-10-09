import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import type { LDBGEntry, LDBGLog } from "@/firmware/lenovoDmi/ldbgLog";
import { findingIsProblem, findingText, LenovoDMIArea } from "@/firmware/lenovoDmi/lenovoDmiArea";
import {
  hexText,
  isSMBIOS,
  keyNamespaceText,
  keyTypeText,
  LenovoDMIFormat,
  type LenovoDMIKey,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";
import {
  entryName,
  LenovoDMIDecodedBlock,
  valueHex,
  valueText,
  WindowsKey,
} from "@/firmware/lenovoDmi/lenovoDmiValue";
import {
  entryKnownType,
  isWriteProtected,
  LENVBlock,
  type LENVEncoding,
  type LENVEntry,
} from "@/firmware/lenovoDmi/lenvBlock";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import type { LenovoDMIFirmwareReaders } from "@/firmware/uefi/lenovoDmiFirmwareReaders";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { cell, type DetailField, type DetailTable, field } from "@/tools/toolDetail";
import type { RowRole } from "@/tools/toolRowMarks";

/**
 * What the details and the tree say of Lenovo's DMI store (`src/firmware/lenovoDmi`):
 * the store's row sums it up — the block the firmware reads, what that block holds,
 * what reads wrong — and each part below it says what it is.
 *
 * A row keeps only its place, so the store is read again from the file on each
 * selection: 16 KiB, decoded in microseconds. The entries' values are XORed in the
 * file, which is why they are read here, in the format's own terms, and never from a
 * row's bytes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail
 */

/**
 * The kinds this reads.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.reads
 */
export function readsLenovoDMI(kind: string): boolean {
  return (
    kind === "lenovoDMIStore" ||
    kind === "ldbgLog" ||
    kind === "ldbgEntry" ||
    kind === "lenvBlock" ||
    kind === "lenvEntry"
  );
}

const hex = (value: number, digits: number): string => hexText(value, digits);

const blocksOf = (bytes: Uint8Array | undefined, offset: number): LENVBlock | undefined =>
  bytes === undefined || bytes.length < LenovoDMIFormat.lenvHeaderSize
    ? undefined
    : new LENVBlock(offset, bytes);

/**
 * `firmwareReaders`, once the image's drivers have been searched, adds to each entry
 * of the store the drivers that ask for it; nothing leaves the line out until then,
 * and for a block on its own for good.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.build
 */
export function lenovoDMIDetail(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader,
  firmwareReaders?: LenovoDMIFirmwareReaders | undefined
): { fields: DetailField[]; tables: DetailTable[] } {
  if (!isFileSpace(node.space) || !readsLenovoDMI(node.kind)) return { fields: [], tables: [] };
  const found = context(node, image, reader);
  const range = nodeRange(node);
  switch (node.kind) {
    case "lenovoDMIStore":
      return found.area === undefined ? { fields: [], tables: [] } : summary(found.area, node);
    case "ldbgLog":
      return { fields: found.area === undefined ? [] : logFields(found.area.log), tables: [] };
    case "ldbgEntry": {
      const entry = found.area?.log.entries.find((one) => one.offset === range.start);
      return { fields: entry === undefined ? [] : logEntryFields(entry), tables: [] };
    }
    case "lenvBlock": {
      const area = found.area;
      const index = area?.blocks.findIndex((block) => block.offset === range.start) ?? -1;
      const inArea = index >= 0 && area !== undefined ? area.blocks[index] : undefined;
      if (inArea !== undefined && area !== undefined) {
        return { fields: blockFields(inArea, liveText(index, area)), tables: [] };
      }
      return {
        fields: found.block === undefined ? [] : blockFields(found.block, undefined),
        tables: [],
      };
    }
    case "lenvEntry": {
      const blocks = found.area?.blocks ?? (found.block === undefined ? [] : [found.block]);
      for (const [index, block] of blocks.entries()) {
        const entry = block.entries.find((one) => one.offset === node.header.start);
        if (entry === undefined) continue;
        const otherBlock = blocks.length === 2 ? blocks[1 - index] : undefined;
        const other =
          otherBlock === undefined ? undefined : { block: otherBlock, number: 2 - index };
        const drivers =
          found.area === undefined ? undefined : firmwareReaders?.driversOf(entry.key);
        return { fields: entryFields(entry, other, drivers), tables: [] };
      }
      return { fields: [], tables: [] };
    }
    default:
      return { fields: [], tables: [] };
  }
}

/**
 * The block Open Decoded Block opens from `node` — the block itself, or the one an
 * entry is in — and the row's name for it; nothing on any other row, and on a block
 * with nothing to decode (`LenovoDMIDecodedBlock`).
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.decodableBlock
 */
export function decodableBlock(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): { readonly block: LENVBlock; readonly name: string } | undefined {
  if (!isFileSpace(node.space)) return undefined;
  let row: UEFINode | undefined;
  if (node.kind === "lenvBlock") row = node;
  else if (node.kind === "lenvEntry") {
    row = node.id.length === 0 ? undefined : image.node(node.id.slice(0, -1));
  } else return undefined;
  if (row === undefined || row.kind !== "lenvBlock") return undefined;
  const range = nodeRange(row);
  const block = blocksOf(reader.bytes(range), range.start);
  if (block === undefined || !LenovoDMIDecodedBlock.canOpen(block)) return undefined;
  return { block, name: row.name };
}

/**
 * The badge a LENV block's row wears: a lock on a block stored encoded, an open one
 * on a block in the clear under a key — a block opened decoded. None on a block with
 * nothing to encode: erased, empty, a key of zero, or one that reads neither way.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.encodingRole
 */
export function encodingRole(node: UEFINode, reader: ImageReader): RowRole | undefined {
  if (node.kind !== "lenvBlock" || !isFileSpace(node.space)) return undefined;
  const range = nodeRange(node);
  const block = blocksOf(reader.bytes(range), range.start);
  if (block === undefined || !block.hasSignature || block.isBlank) return undefined;
  const key = hex(block.xorKey, 2);
  switch (block.encoding) {
    case "encoded":
      return { kind: "encoded", words: L("Encoded with the XOR key %1$@", key), decoded: false };
    case "plain":
      return {
        kind: "encoded",
        words: L("Decoded: the key %1$@ encodes it again on the way back", key),
        decoded: true,
      };
    default:
      return undefined;
  }
}

// MARK: - Finding the store

/** The store `node` is part of, or the block on its own it is or is in. */
function context(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): { area?: LenovoDMIArea | undefined; block?: LENVBlock | undefined } {
  let path = [...node.id];
  let current: UEFINode | undefined = node;
  while (current !== undefined) {
    const range = nodeRange(current);
    if (current.kind === "lenovoDMIStore") {
      const stored = reader.bytes(range);
      if (stored !== undefined) return { area: LenovoDMIArea.read(stored, range.start) };
    }
    if (current.kind === "lenvBlock") {
      const parent = path.length === 0 ? undefined : image.node(path.slice(0, -1));
      if (parent?.kind !== "lenovoDMIStore") {
        const block = blocksOf(reader.bytes(range), range.start);
        if (block !== undefined) return { block };
      }
    }
    if (path.length === 0) break;
    path = path.slice(0, -1);
    current = path.length === 0 ? undefined : image.node(path);
  }
  return {};
}

/**
 * The area a log or a block of the store starts, read from where the store starts —
 * the log's first byte. For the tree's rows, which have their parent but not the
 * image.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.area
 */
export function areaStartingAt(offset: number, reader: ImageReader): LenovoDMIArea | undefined {
  const stored = reader.bytesAt(offset, LenovoDMIFormat.areaSize);
  return stored === undefined ? undefined : LenovoDMIArea.read(stored, offset);
}

// MARK: - The store

/**
 * The store's own row: which block the firmware reads, the values that block holds —
 * each a way to its row — and what reads wrong.
 */
function summary(
  area: LenovoDMIArea,
  store: UEFINode
): { fields: DetailField[]; tables: DetailTable[] } {
  const fields: DetailField[] = [];
  const live = area.liveIndex;
  const liveBlock = live === undefined ? undefined : area.blocks[live];
  if (live !== undefined && liveBlock !== undefined) {
    fields.push(
      field(
        L("Block in use"),
        L("LENV block %1$@, generation %2$@", live + 1, liveBlock.generation)
      )
    );
  } else {
    const empty = area.blocks.every((block) => block.isBlank);
    fields.push(
      field(
        L("Block in use"),
        empty ? L("None: the store is empty") : L("None: no LENV block the firmware would read"),
        !empty
      )
    );
  }
  for (const finding of area.findings) {
    const problem = findingIsProblem(finding);
    fields.push(field(problem ? L("Problem") : L("Note"), findingText(finding), problem));
  }
  if (live === undefined || liveBlock === undefined) return { fields, tables: [] };
  // The rows of the live block's entries, by their place: the store's first child is
  // the log, the blocks follow it.
  const blockRow = store.children[live + 1];
  // What the bench reads the store for — the serial number, the UUID, the model, the
  // Windows key — first, then what nobody has named.
  const all = liveBlock.entries;
  const entries = [
    ...all.filter((entry) => entryKnownType(entry) !== undefined),
    ...all.filter((entry) => entryKnownType(entry) === undefined),
  ];
  const table: DetailTable = {
    title: L("Entries in use"),
    symbol: "person.text.rectangle",
    columns: [L("Entry"), L("Value")],
    rows: entries.map((entry) => [cell(entryName(entry.key)), cell(valueText(entry))]),
    rowTargets: entries.map((entry) => {
      const row = blockRow?.children.find((child) => child.header.start === entry.offset);
      return row === undefined ? undefined : { kind: "node", path: row.id };
    }),
    linkColumn: 0,
  };
  return { fields, tables: [table] };
}

// MARK: - The log

function logFields(log: LDBGLog): DetailField[] {
  const fields: DetailField[] = [];
  if (log.writeOffsetProblem === "erased") {
    fields.push(field(L("State"), L("Erased: nothing has been written since")));
  }
  const misplaced =
    log.writeOffsetProblem === "outOfRange" || log.writeOffsetProblem === "misaligned";
  fields.push(field(L("Write offset"), hex(log.writeOffset, 8), misplaced));
  fields.push(field(L("Entries"), L("%1$@ of %2$@", log.entries.length, log.capacity)));
  fields.push(field(L("XOR key"), log.key === undefined ? "—" : hex(log.key, 2)));
  fields.push(field(L("Unknown"), valueHex(log.unknownHeader)));
  return fields;
}

function logEntryFields(entry: LDBGEntry): DetailField[] {
  return [
    field(L("Time"), entry.timestampText ?? L("Not a date: %1$@", valueHex(entry.timestampBytes))),
    field(L("Operation"), operationName(entry)),
    field(L("Entry"), entryName(entry.key)),
    field(L("Namespace"), namespaceText(entry.key)),
    field(L("Entry type"), keyTypeText(entry.key)),
    field(L("Size"), L("%1$@ bytes", entry.size)),
    field(L("Unknown"), valueHex(entry.unknown)),
  ];
}

/**
 * The tree's word for a write: "Set · Baseboard serial number".
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.logEntryText
 */
export function logEntryText(entry: LDBGEntry): string {
  return L("%1$@ · %2$@", operationName(entry), entryName(entry.key));
}

function operationName(entry: LDBGEntry): string {
  switch (entry.knownOperation) {
    case "setData":
      return entry.size === 0
        ? L("Remove", { context: "log operation" })
        : L("Set", { context: "log operation" });
    case "protect":
      return L("Protect", { context: "log operation" });
    case "unprotect":
      return L("Unprotect", { context: "log operation" });
    case undefined:
      return L("Unknown operation %1$@", hex(entry.operation, 2));
  }
}

// MARK: - A block

/**
 * `live` is whether the firmware reads the block and why — nothing for a block on
 * its own, where there is no other copy to choose from.
 */
function blockFields(block: LENVBlock, live: string | undefined): DetailField[] {
  if (block.isErased) return [field(L("State"), L("Erased: every byte is FF"))];
  const fields: DetailField[] = [];
  if (block.isBlank) fields.push(field(L("State"), L("Empty: wiped or never written")));
  fields.push(
    field(
      L("Signature", { context: "block header" }),
      block.hasSignature ? "LENV" : L("Missing"),
      !block.hasSignature
    )
  );
  fields.push(field(L("Generation"), `${block.generation}`));
  if (live !== undefined) fields.push(field(L("Firmware reads it"), live));
  fields.push(
    field(
      L("Entries"),
      L("%1$@ of %2$@ declared", block.entries.length, block.declaredEntries),
      !block.entriesFit
    )
  );
  fields.push(field(L("XOR key"), hex(block.xorKey, 2)));
  fields.push(field(L("Stored"), encodingText(block.encoding)));
  fields.push(field(L("Checksum"), checksumText(block), !block.isBlank && !block.checksumIsValid));
  fields.push(field(L("Access flag"), hex(block.accessFlag, 2)));
  fields.push(field(L("Write-protected"), (block.accessFlag & 1) !== 0 ? L("Yes") : L("No")));
  return fields;
}

/**
 * The tree's word for a block: its generation, or why it has none.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.blockText
 */
export function blockText(block: LENVBlock): string {
  if (block.isErased) return L("Erased");
  if (!block.hasSignature) return L("No signature");
  if (block.isBlank) return L("Empty");
  return L("Generation %1$@", block.generation);
}

function liveText(index: number, area: LenovoDMIArea): string {
  const block = area.blocks[index] as LENVBlock;
  if (area.liveIndex === index) {
    return block.checksumIsValid
      ? L("Yes — the higher generation")
      : L(
          "Yes — the higher generation, although its checksum does not add up. Whether the firmware then falls back to the other block is not known."
        );
  }
  if (!block.hasSignature) return L("No — no signature");
  if (block.generation === 0) return L("No — generation 0");
  return L("No — the other block's generation is higher");
}

function encodingText(encoding: LENVEncoding): string {
  switch (encoding) {
    case "encoded":
      return L("Encoded");
    case "plain":
      return L("Decoded");
    case "keyIsZero":
      return L("Key is zero");
    case "undetermined":
      return L("Undetermined: the entries do not fit either way");
  }
}

function checksumText(block: LENVBlock): string {
  const stored = hex(block.checksum, 4);
  if (block.checksumIsOfEncodedBody) {
    return L("%1$@ (Valid for the body encoded again)", stored);
  }
  return block.checksumIsValid
    ? L("%1$@ (Valid)", stored)
    : L("%1$@ (Invalid), should be %2$@", stored, hex(block.expectedChecksum, 4));
}

// MARK: - An entry

/**
 * `other` is the store's other block and its number, for a block in a store; nothing
 * for a block on its own. `drivers` are the image's drivers that name the entry's
 * key, once they have been searched.
 */
function entryFields(
  entry: LENVEntry,
  other: { readonly block: LENVBlock; readonly number: number } | undefined,
  drivers: readonly string[] | undefined
): DetailField[] {
  const fields: DetailField[] = [field(L("Value"), valueText(entry))];
  if (drivers !== undefined) {
    fields.push(
      field(
        L("Read by the firmware"),
        drivers.length === 0 ? L("No driver in this image names it") : drivers.join(", ")
      )
    );
  }
  if (entryKnownType(entry) === "windowsKey") fields.push(windowsKeyField(entry));
  if (other !== undefined) {
    const theirs = other.block.entry(entry.key)?.data;
    const same =
      theirs !== undefined &&
      theirs.length === entry.data.length &&
      theirs.every((byte, index) => byte === entry.data[index]);
    const text =
      theirs === undefined
        ? L("Not in LENV block %1$@", other.number)
        : same
          ? L("The same in LENV block %1$@", other.number)
          : L("Different in LENV block %1$@", other.number);
    fields.push(field(L("Other copy"), text));
  }
  fields.push(
    field(L("Bytes"), valueHex(entry.data)),
    field(L("Namespace"), namespaceText(entry.key)),
    field(L("Entry type"), keyTypeText(entry.key)),
    field(L("Size"), L("%1$@ bytes", entry.data.length)),
    field(L("Write-protected"), isWriteProtected(entry) ? L("Yes") : L("No")),
    field(L("Entry flags"), hex(entry.flags, 2)),
    field(L("Unknown"), `${hex(entry.unknown1, 2)} ${hex(entry.unknown2, 4)}`)
  );
  return fields;
}

/** What the MSDM header in front of the Windows key says, or what is wrong with it. */
function windowsKeyField(entry: LENVEntry): DetailField {
  const size = WindowsKey.headerSize;
  const label = L("Key header");
  const problem = WindowsKey.problem(entry.data);
  if (problem === undefined) {
    return field(label, L("MSDM licensing data, %1$@ bytes of key", entry.data.length - size));
  }
  switch (problem.kind) {
    case "tooShort":
      return field(
        label,
        L("%1$@ bytes: shorter than the %2$@-byte header.", problem.length, size),
        true
      );
    case "signature":
      return field(
        label,
        L(
          "The first 16 bytes are %1$@, not the MSDM signature %2$@.",
          valueHex(Uint8Array.from(problem.head)),
          valueHex(Uint8Array.from(WindowsKey.signature))
        ),
        true
      );
    case "length":
      return field(
        label,
        L(
          "The header gives the key as %1$@ bytes, and %2$@ follow it.",
          problem.declared,
          problem.actual
        ),
        true
      );
    case "notText":
      return field(label, L("The key holds bytes that are not printable."), true);
  }
}

const namespaceText = (key: LenovoDMIKey): string =>
  isSMBIOS(key) ? "SMBIOS" : keyNamespaceText(key);

/**
 * `Baseboard serial number = PF0TEST1`, `LENV block 2 · generation 84`,
 * `2022-06-29 20:30:25 · Set · Baseboard serial number`; nothing for a row of anything
 * else, or one whose bytes do not read. `parent` is the row's parent — the block, or the
 * log.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.lenovoDMIRow
 */
export function lenovoDMIRowText(
  node: UEFINode,
  parent: UEFINode | undefined,
  reader: ImageReader
): string | undefined {
  switch (node.kind) {
    case "lenvBlock": {
      const range = nodeRange(node);
      const block = blocksOf(reader.bytes(range), range.start);
      return block === undefined ? undefined : L("%1$@ · %2$@", node.name, blockText(block));
    }
    case "lenvEntry": {
      if (parent === undefined || parent.kind !== "lenvBlock") return undefined;
      const range = nodeRange(parent);
      const entry = blocksOf(reader.bytes(range), range.start)?.entries.find(
        (one) => one.offset === node.header.start
      );
      return entry === undefined ? undefined : L("%1$@ = %2$@", node.name, valueText(entry));
    }
    case "ldbgEntry": {
      if (parent === undefined || parent.kind !== "ldbgLog") return undefined;
      const entry = areaStartingAt(nodeRange(parent).start, reader)?.log.entries.find(
        (one) => one.offset === nodeRange(node).start
      );
      return entry === undefined ? undefined : L("%1$@ · %2$@", node.name, logEntryText(entry));
    }
    default:
      return undefined;
  }
}

/**
 * `decodableBlock`'s answer for the tree, which has a row and its parent but not the
 * image: the block's range in the file and its row's name.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFILenovoDMIDetail.swift#UEFILenovoDMIDetail.decodableBlock
 */
export function decodableBlockOf(
  node: UEFINode,
  parent: UEFINode | undefined,
  reader: ImageReader
): { readonly range: readonly [number, number]; readonly name: string } | undefined {
  if (!isFileSpace(node.space)) return undefined;
  const row = node.kind === "lenvBlock" ? node : node.kind === "lenvEntry" ? parent : undefined;
  if (row === undefined || row.kind !== "lenvBlock") return undefined;
  const range = nodeRange(row);
  const block = blocksOf(reader.bytes(range), range.start);
  if (block === undefined || !LenovoDMIDecodedBlock.canOpen(block)) return undefined;
  return { range: [range.start, range.end], name: row.name };
}
