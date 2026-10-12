import { parseNvarStore } from "@/firmware/uefi/nvarParser";
import { walkStores } from "@/firmware/uefi/nvramParser";
import { DEFAULT_EMPTY_BYTE, type Parser } from "@/firmware/uefi/parserState";
import { parseTopLevel, scanRawArea } from "@/firmware/uefi/rawScan";
import type { KnownNode } from "@/firmware/uefi/rootLayout";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The whole source as the one node `known` was in the parent's tree (`UEFIRootLayout.node`).
 *
 * The bytes are read first as they would be on their own — the NVAR walk for a variable, the
 * image scan for anything else — and a node of the same kind spanning all of them is the answer:
 * an Acer DMI store or a GPNV store announces itself, and is read out of the padding the scan
 * leaves. What the bytes do not announce — a descriptor's region, a range the flash device map
 * names, a structure the FIT points at — is the node the parent knew, standing over whatever the
 * bytes hold. A scan alone made every one of those a single padding row.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PartRoot.swift#Parser.root
 */
export function rootAs(parser: Parser, known: KnownNode): UEFINode {
  const all = parser.reader.all;
  const empty = DEFAULT_EMPTY_BYTE;
  const read =
    known.kind === "nvarEntry"
      ? (parseNvarStore(parser, all, { emptyByte: empty, probe: true, depth: 0 }) ?? [])
      : parseTopLevel(parser, all, 0);
  const own = first(read, (node) => {
    const range = nodeRange(node);
    return node.kind === known.kind && range.start === all.start && range.end === all.end;
  });
  if (own !== undefined) {
    // The name and the GUID as the parent had them: an NVAR entry takes both from the entry
    // linking to it, and a GUID from the table at the store's end — neither of which is in the
    // part.
    return { ...own, name: known.name, guid: known.guid ?? own.guid };
  }

  const count = parser.reader.count;
  const headerEnd = Math.min(known.headerLength, count);
  const body = { start: headerEnd, end: count };
  let children = known.isLeaf ? [] : contentsOf(read);
  if (known.isLeaf) {
    // As the parent had it: nothing under it.
  } else if (body.start !== all.start || body.end !== all.end || !children.some(isClaimed)) {
    const scanned = contentsOf(scanRawArea(parser, body, empty, 1));
    children = scanned.some(isClaimed) ? scanned : [];
  }
  if (children.length === 0 && !known.isLeaf) {
    // The defaults a flash map's region keeps are NVRAM stores, which no scan looks for.
    const stores = walkStores(parser, body, empty, 1);
    if (stores.some(isClaimed)) children = stores;
  }
  return makeNode({
    kind: known.kind,
    subtype: known.subtype,
    name: known.name,
    guid: known.guid,
    header: { start: 0, end: headerEnd },
    body,
    isFixed: known.isFixed,
    isErased: children.length === 0 && parser.reader.isFilled(all, empty),
    children,
  });
}

/** Something a reader recognised, rather than bytes nobody claimed. */
function isClaimed(node: UEFINode): boolean {
  return node.kind !== "padding" && node.kind !== "freeSpace";
}

/**
 * What a reading of the bytes holds, without the rows that only wrap it: the image node a scan
 * groups several finds under, and the one padding row a find inside padding is read out of.
 */
function contentsOf(nodes: UEFINode[]): UEFINode[] {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (
    only === undefined ||
    !(only.kind === "uefiImage" || (only.kind === "padding" && only.children.length > 0))
  ) {
    return nodes;
  }
  return only.children;
}

function first(
  nodes: readonly UEFINode[],
  matches: (node: UEFINode) => boolean
): UEFINode | undefined {
  for (const node of nodes) {
    if (matches(node)) return node;
    const found = first(node.children, matches);
    if (found !== undefined) return found;
  }
  return undefined;
}
