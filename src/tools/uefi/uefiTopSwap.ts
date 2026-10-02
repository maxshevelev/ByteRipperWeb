import { L } from "@/core/localization/localization";
import type { ImageRange } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import type { TopSwapCopy } from "@/firmware/uefi/topSwap";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { type NodeID, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { WireNode } from "@/workers/protocol";

/**
 * What the structure panel says about the Top Swap copy of the boot block
 * (`TopSwapCopy`), decided here so it is tested without a window.
 *
 * The copy is the top block again, one block lower: the same volumes, which the
 * tree would otherwise list a second time with nothing to say what they are. The
 * outermost nodes of the copy — those lying wholly inside it whose parent does
 * not — carry that in their name, and both blocks' outermost nodes say in their
 * details where the other copy is and whether the two still agree.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap
 */
export type TopSwapRole =
  /** The node is in the copy; `of` is the top block it copies. */
  | { readonly kind: "copy"; readonly of: ImageRange }
  /** The node is in the top block; `copiedAt` is where its copy is. */
  | { readonly kind: "original"; readonly copiedAt: ImageRange };

const encloses = (block: ImageRange, range: ImageRange): boolean =>
  range.end > range.start && block.start <= range.start && range.end <= block.end;

/** What the role is decided from: where a node is, and whether that is in the file. */
interface Placed {
  readonly range: ImageRange;
  readonly inFile: boolean;
}

/**
 * The node's role, when it is outermost in either block of an image whose Top
 * Swap copy has been found. `parentOf` answers for a node's parent — the image's
 * `node(id)` where the whole tree is at hand, the panel's walk of the tree it
 * holds where it is not.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.role
 */
function roleOf(
  id: NodeID,
  node: Placed,
  copy: TopSwapCopy | undefined,
  parentOf: (id: NodeID) => Placed | undefined
): TopSwapRole | undefined {
  if (!node.inFile || copy === undefined) return undefined;
  if (isOutermost(id, node, copy.backup, parentOf)) return { kind: "copy", of: copy.top };
  if (isOutermost(id, node, copy.top, parentOf)) {
    return { kind: "original", copiedAt: copy.backup };
  }
  return undefined;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.isOutermost */
function isOutermost(
  id: NodeID,
  node: Placed,
  block: ImageRange,
  parentOf: (id: NodeID) => Placed | undefined
): boolean {
  if (!encloses(block, node.range)) return false;
  const parent = id.length === 0 ? undefined : parentOf(id.slice(0, -1));
  if (parent === undefined) return true;
  return !parent.inFile || !encloses(block, parent.range);
}

const placedNode = (node: UEFINode): Placed => ({
  range: nodeRange(node),
  inFile: isFileSpace(node.space),
});

/** The role of a parsed node, over an image whose ranges have been read. */
export function uefiTopSwapRole(node: UEFINode, image: UEFIImage): TopSwapRole | undefined {
  return roleOf(node.id, placedNode(node), image.protectedRanges?.topSwap, (id) => {
    const parent = image.node(id);
    return parent === undefined ? undefined : placedNode(parent);
  });
}

const placedWire = (node: WireNode): Placed => ({
  range: {
    start: node.header[0],
    end: Math.max(node.header[1], node.body[1], node.tail[1]),
  },
  inFile: node.space.length === 0,
});

/**
 * The role of a node as the panel holds it, over the tree it has been sent: the
 * panel names its rows from the copy the worker found with the protected ranges,
 * and a row's parent is a walk of that tree.
 *
 * @upstream-differs upstream asks the image, which is in the same process; the
 * panel holds wire nodes and the copy the ranges' answer carried
 */
export function wireTopSwapRole(
  node: WireNode,
  copy: TopSwapCopy | undefined,
  roots: readonly WireNode[]
): TopSwapRole | undefined {
  return roleOf(node.id, placedWire(node), copy, (id) => {
    let nodes = roots;
    let found: WireNode | undefined;
    for (const index of id) {
      found = nodes[index];
      if (found === undefined) return undefined;
      nodes = found.children;
    }
    return found === undefined ? undefined : placedWire(found);
  });
}

/**
 * Where a node's twin in the other block is: the same bytes one block up or down,
 * and a node of the same kind. Any node of the file lying wholly inside either
 * block has one — a file in the copy, a section in the top block — so a reader
 * can step between the two and see what stands for what.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.Counterpart
 */
export interface TopSwapCounterpart {
  /** The twin's range. */
  readonly range: ImageRange;
  readonly kind: string;
  /** Whether the twin is in the copy, so the step goes down. */
  readonly isInCopy: boolean;
}

/**
 * The menu item that steps there.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.Counterpart.menuTitle
 */
export const counterpartMenuTitle = (counterpart: TopSwapCounterpart): string =>
  counterpart.isInCopy ? L("Go to Top Swap Copy") : L("Go to Original");

function counterpartOf(
  node: Placed & { readonly kind: string },
  copy: TopSwapCopy | undefined
): TopSwapCounterpart | undefined {
  if (!node.inFile || copy === undefined) return undefined;
  const size = copy.top.end - copy.top.start;
  const shifted = (delta: number): ImageRange => ({
    start: node.range.start + delta,
    end: node.range.end + delta,
  });
  if (encloses(copy.top, node.range)) {
    return { range: shifted(-size), kind: node.kind, isInCopy: true };
  }
  if (encloses(copy.backup, node.range)) {
    return { range: shifted(size), kind: node.kind, isInCopy: false };
  }
  return undefined;
}

/**
 * The twin among `chain` — the nodes covering its first byte, outermost first:
 * the one with the same range and kind. Where the copies have drifted apart and
 * no node matches, the innermost node that still holds the whole range, so the
 * step lands as near as the tree allows.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.twin
 */
function twinIn<T extends Placed & { readonly kind: string }>(
  counterpart: TopSwapCounterpart,
  chain: readonly T[]
): T | undefined {
  const same = chain.findLast(
    (node) =>
      node.range.start === counterpart.range.start &&
      node.range.end === counterpart.range.end &&
      node.kind === counterpart.kind
  );
  return same ?? chain.findLast((node) => node.inFile && encloses(node.range, counterpart.range));
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.counterpart */
export function uefiTopSwapCounterpart(
  node: UEFINode,
  image: UEFIImage
): TopSwapCounterpart | undefined {
  return counterpartOf({ ...placedNode(node), kind: node.kind }, image.protectedRanges?.topSwap);
}

/** The twin among parsed nodes. */
export function uefiTopSwapTwin(
  counterpart: TopSwapCounterpart,
  chain: readonly UEFINode[]
): UEFINode | undefined {
  const twin = twinIn(
    counterpart,
    chain.map((node) => ({ ...placedNode(node), kind: node.kind, node }))
  );
  return twin?.node;
}

/** The counterpart of a node as the panel holds it. */
export function wireTopSwapCounterpart(
  node: WireNode,
  copy: TopSwapCopy | undefined
): TopSwapCounterpart | undefined {
  return counterpartOf({ ...placedWire(node), kind: node.kind }, copy);
}

/** The twin among the wire nodes along a path, outermost first. */
export function wireTopSwapTwin(
  counterpart: TopSwapCounterpart,
  chain: readonly WireNode[]
): WireNode | undefined {
  const twin = twinIn(
    counterpart,
    chain.map((node) => ({ ...placedWire(node), kind: node.kind, node }))
  );
  return twin?.node;
}

/**
 * The row's name, with what it is when it is the copy.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.name
 */
export function topSwapName(name: string, role: TopSwapRole["kind"] | undefined): string {
  return role === "copy" ? L("%1$@ (Top Swap copy)", name) : name;
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/**
 * The detail row: where the other copy is, and whether the two agree.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITopSwap.swift#UEFITopSwap.detail
 */
export function topSwapDetail(
  role: TopSwapRole | undefined,
  copiesMatch: boolean
): string | undefined {
  if (role === undefined) return undefined;
  const agreement = copiesMatch ? L("the copies match") : L("the copies differ");
  switch (role.kind) {
    case "copy":
      return L("Copy of %1$@–%2$@; %3$@", hex(role.of.start), hex(role.of.end), agreement);
    case "original":
      return L(
        "Copied at %1$@–%2$@; %3$@",
        hex(role.copiedAt.start),
        hex(role.copiedAt.end),
        agreement
      );
  }
}

/** The role, and the detail text for an image whose ranges have been read. */
export function uefiTopSwapDetail(node: UEFINode, image: UEFIImage): string | undefined {
  const ranges = image.protectedRanges;
  if (ranges === undefined) return undefined;
  return topSwapDetail(uefiTopSwapRole(node, image), ranges.topSwapCopiesMatch === true);
}
