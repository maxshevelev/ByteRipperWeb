import { L } from "@/core/localization/localization";
import type { ImageRange } from "@/firmware/imageReader";
import type { LDBGLog } from "@/firmware/lenovoDmi/ldbgLog";
import { LenovoDMIArea } from "@/firmware/lenovoDmi/lenovoDmiArea";
import { LenovoDMIFormat, startsWith } from "@/firmware/lenovoDmi/lenovoDmiFormat";
import { entryName } from "@/firmware/lenovoDmi/lenovoDmiValue";
import { entryDataRange, LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, makeSpan, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The store Lenovo's InsydeH2O firmware keeps a machine's identity in
 * (`UEFI_IMAGE_FORMAT.md` §9, `LenovoDMI`): the `LDBG` change log and the two
 * `LENV` blocks after it, back to back, 16 KiB in all. The Insyde flash device map
 * declares the three as regions of type "Unknown"; on a dump without the map they
 * lie in padding. Either way they are read here as one row with the log and the
 * blocks under it, and each block's entries under the block — the format itself is
 * `src/firmware/lenovoDmi`'s, so the tree and anything else that reads the store
 * read it one way.
 *
 * The entries' bytes are XORed with the block's key in the file; the rows are
 * ranges of the file, as every row is, and what they hold decoded is the panel's to
 * show.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIStore.swift#Parser
 */

/**
 * The store, or a block on its own, starts on a 4 KiB boundary of the file on every
 * dump examined.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIStore.swift#Parser.lenovoDMIAlignment
 */
export const LENOVO_DMI_ALIGNMENT = 0x1000;

/**
 * `nodes` with every Lenovo DMI store read out as a row: in place of the map regions
 * that cover exactly its three parts, or out of the padding it lies in. A `LENV`
 * block on its own — a block opened out of a dump — is read out of padding the same
 * way.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIStore.swift#Parser.readingLenovoDMIStores
 */
export function readingLenovoDMIStores(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  const result: UEFINode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index] as UEFINode;
    const covered = mapRegionsCoveringStore(parser, index, nodes);
    if (covered !== undefined) {
      result.push(covered.store);
      index += covered.count;
      continue;
    }
    index += 1;
    if (node.kind !== "padding" && node.kind !== "flashDeviceMapRegion") {
      result.push(node);
      continue;
    }
    if (node.children.length > 0) {
      result.push({ ...node, children: readingLenovoDMIStores(parser, node.children, emptyByte) });
      continue;
    }
    const rows = node.isErased ? undefined : lenovoDMIRows(parser, node.body, emptyByte);
    result.push(rows === undefined ? node : { ...node, children: rows });
  }
  return result;
}

/**
 * The store whose log the map region at `index` starts with, when that region and
 * the ones after it cover the store exactly — the log, then each block, as the
 * Insyde map declares them — and how many regions that is.
 */
function mapRegionsCoveringStore(
  parser: Parser,
  index: number,
  nodes: readonly UEFINode[]
): { readonly store: UEFINode; readonly count: number } | undefined {
  const first = nodes[index];
  if (first === undefined || first.kind !== "flashDeviceMapRegion" || first.children.length > 0) {
    return undefined;
  }
  const area = lenovoDMIArea(parser, nodeRange(first).start);
  if (area === undefined) return undefined;
  let end = nodeRange(first).end;
  let count = 1;
  while (end < area.range[1] && index + count < nodes.length) {
    const next = nodes[index + count] as UEFINode;
    if (
      next.kind !== "flashDeviceMapRegion" ||
      next.children.length > 0 ||
      nodeRange(next).start !== end
    ) {
      return undefined;
    }
    end = nodeRange(next).end;
    count += 1;
  }
  if (end !== area.range[1]) return undefined;
  return { store: lenovoDMIStoreNode(area), count };
}

/** The stores and lone blocks in `range`, with padding rows between them; nothing when there is none. */
function lenovoDMIRows(
  parser: Parser,
  range: ImageRange,
  emptyByte: number
): UEFINode[] | undefined {
  const step = LENOVO_DMI_ALIGNMENT;
  const found: UEFINode[] = [];
  let at = Math.ceil(range.start / step) * step;
  while (at + LenovoDMIFormat.lenvSize <= range.end) {
    const area = lenovoDMIArea(parser, at, range.end);
    if (area !== undefined) {
      found.push(lenovoDMIStoreNode(area));
      at = area.range[1];
      continue;
    }
    const block = loneLENVBlock(parser, at, range.end);
    if (block !== undefined) {
      found.push(lenvBlockNode(block, L("LENV block"), undefined));
      at = block.range[1];
      continue;
    }
    at += step;
  }
  if (found.length === 0) return undefined;
  const rows: UEFINode[] = [];
  let claimed = range.start;
  for (const node of found) {
    rows.push(...parser.padding(claimed, nodeRange(node).start, emptyByte), node);
    claimed = nodeRange(node).end;
  }
  rows.push(...parser.padding(claimed, range.end, emptyByte));
  return rows;
}

function lenovoDMIArea(parser: Parser, offset: number, limit?: number): LenovoDMIArea | undefined {
  const size = LenovoDMIFormat.areaSize;
  if (offset + size > (limit ?? parser.reader.count)) return undefined;
  const signature = parser.reader.bytesAt(offset, 4);
  if (signature === undefined || !startsWith(signature, LenovoDMIFormat.ldbgSignature)) {
    return undefined;
  }
  const stored = parser.reader.bytesAt(offset, size);
  return stored === undefined ? undefined : LenovoDMIArea.found(stored, offset);
}

function loneLENVBlock(parser: Parser, offset: number, limit: number): LENVBlock | undefined {
  const size = LenovoDMIFormat.lenvSize;
  if (offset + size > limit) return undefined;
  const signature = parser.reader.bytesAt(offset, 4);
  if (signature === undefined || !startsWith(signature, LenovoDMIFormat.lenvSignature)) {
    return undefined;
  }
  const stored = parser.reader.bytesAt(offset, size);
  return stored === undefined ? undefined : LENVBlock.found(stored, offset);
}

/**
 * The store's row: the log, then both blocks, the one the firmware reads marked by
 * its subtype. The firmware finds the store where the map says it is, so none of it
 * moves.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIStore.swift#Parser.lenovoDMIStore
 */
export function lenovoDMIStoreNode(area: LenovoDMIArea): UEFINode {
  const live = area.liveIndex;
  const store = makeSpan({
    kind: "lenovoDMIStore",
    name: L("Lenovo DMI"),
    range: { start: area.range[0], end: area.range[1] },
  });
  store.isFixed = true;
  store.children = [
    ldbgLogNode(area.log),
    ...area.blocks.map((block, index) =>
      lenvBlockNode(
        block,
        L("LENV block %1$@", index + 1),
        live === undefined ? false : live === index
      )
    ),
  ];
  return store;
}

function ldbgLogNode(log: LDBGLog): UEFINode {
  const header = { start: log.offset, end: log.offset + LenovoDMIFormat.ldbgHeaderSize };
  return makeNode({
    kind: "ldbgLog",
    name: L("Change log (LDBG)"),
    header,
    body: { start: header.end, end: log.range[1] },
    isFixed: true,
    children: log.entries.map((entry) =>
      makeNode({
        kind: "ldbgEntry",
        name: entry.timestampText ?? L("No date"),
        header: { start: entry.range[0], end: entry.range[1] },
        body: { start: entry.range[1], end: entry.range[1] },
        isFixed: true,
      })
    ),
  });
}

/**
 * A block's row, its subtype 1 for the block the firmware reads and 0 for the other;
 * none for a block on its own, which has no other to be chosen over. An erased block
 * has no entries to show.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIStore.swift#Parser.lenvBlock
 */
export function lenvBlockNode(
  block: LENVBlock,
  name: string,
  inUse: boolean | undefined
): UEFINode {
  const header = { start: block.offset, end: block.offset + LenovoDMIFormat.lenvHeaderSize };
  return makeNode({
    kind: "lenvBlock",
    subtype: inUse === undefined ? undefined : inUse ? 1 : 0,
    name,
    header,
    body: { start: header.end, end: block.range[1] },
    isFixed: true,
    isErased: block.isErased,
    children: block.hasSignature
      ? block.entries.map((entry) => {
          const data = entryDataRange(entry);
          return makeNode({
            kind: "lenvEntry",
            name: entryName(entry.key),
            header: { start: entry.offset, end: data[0] },
            body: { start: data[0], end: data[1] },
            isFixed: true,
          });
        })
      : [],
  });
}
