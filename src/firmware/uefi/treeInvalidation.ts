import type { ImageRange } from "@/firmware/imageReader";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * What an edit does to a tree that has already been read.
 *
 * A tree is read once and then stands, and almost none of it is *about* the
 * bytes that changed: a byte typed inside one file says nothing about the
 * volume three levels down the panel has open, and re-reading the whole image
 * would throw away every branch the user had opened to answer a question nobody
 * asked. So an edit drops only the memoized structure it made stale, and the
 * containers it dropped are read again — from the current bytes — the next time
 * something asks to see inside one.
 *
 * Which structure that is depends on whether the edit moved anything. An
 * overwrite leaves every offset where it was, so only the containers the range
 * actually lands in have to be read again. An insert or a delete moves
 * everything after it, so every container whose range reaches the edit point
 * does. Either way the narrowing matters as much as the dropping: an edit
 * inside one volume must leave its sibling volume's files standing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.invalidate
 * @upstream-differs the collapse alone: upstream's `invalidate` is a method on a tree that holds a live byte source, its own caches and a list of callers to answer, and each of those lives in this port where its subject does — the generation counter is a job number, the byte source is the change's own snapshot, and the callers are the panel's own state
 */
export function invalidating(nodes: UEFINode[], range: ImageRange, sizeDelta: number): UEFINode[] {
  return sizeDelta === 0 ? collapsingOverlapping(nodes, range) : collapsingFrom(nodes, range.start);
}

/**
 * True for what this tree ever leaves collapsed: a volume, and a region whose
 * raw area nobody has scanned. Every other kind's children, once computed, stay
 * computed until an ancestor gate point above it is itself collapsed.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.isGatePoint
 * @upstream-differs no section is ever a gate point here: upstream's third case is a compressed section whose children were decompressed into a space of their own, and this port does not decompress — a compressed section is a leaf that names its algorithm
 */
export function isGatePoint(node: UEFINode): boolean {
  return node.kind === "volume" || node.kind === "region";
}

/**
 * A node's range as the file's offsets, or nothing when its offsets are not the
 * file's to speak of.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.fileRange
 * @upstream-differs always the node's own range: a node is in the file's space unless it came out of a decompressor, and this port has none
 */
function fileRange(node: UEFINode): ImageRange | undefined {
  return nodeRange(node);
}

/** @upstream The standard library's own `Range.overlaps`, which has no declaration to anchor to. */
function overlaps(one: ImageRange, other: ImageRange): boolean {
  return one.start < other.end && other.start < one.end;
}

/**
 * Collapses the narrowest already-materialized gate point(s) overlapping
 * `range` — never an ancestor gate point whose *other* children do not overlap.
 * Each node tries narrowing into its own children first; only when nothing
 * below it changed does it collapse itself, which is what keeps a region's
 * other, untouched volumes materialized when the edit landed inside just one of
 * them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.collapsingOverlapping
 * @upstream-differs the nodes are changed where they stand rather than copied into a new array: this port's nodes are mutable objects, and the tree a worker holds is the only one there is
 */
export function collapsingOverlapping(nodes: UEFINode[], range: ImageRange): UEFINode[] {
  for (const node of nodes) collapseOneOverlapping(node, range);
  return nodes;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.collapseOneOverlapping */
function collapseOneOverlapping(node: UEFINode, range: ImageRange): boolean {
  const own = fileRange(node);
  // An edit is a range of the file. A node inside a compressed section is not,
  // and goes with the section that holds it.
  if (own === undefined || !overlaps(own, range) || node.children.length === 0) return false;
  // Narrowing into a child is sound only while the edit is that child's alone:
  // wholly inside it, and clear of its header, where its size is. An edit that
  // runs from one child into the next, or rewrites a size, may have moved every
  // child after it — a compressed section put back shorter moves the files
  // behind it up — and then this node's own layout is what went stale. Narrowed
  // anyway, the section was read again while the moved file stayed at its old
  // offset, over the erased bytes it left behind.
  const inFile = node.children.filter((child) => {
    const childRange = fileRange(child);
    return childRange !== undefined && overlaps(childRange, range);
  });
  const ownedByOneChild =
    inFile.length <= 1 &&
    inFile.every((child) => {
      const childRange = nodeRange(child);
      return (
        childRange.start <= range.start &&
        range.end <= childRange.end &&
        !overlaps(child.header, range)
      );
    });
  // Every child is asked, not only up to the first that changed: what a caller
  // is told below is whether *anything* narrower went, since that is what says
  // this node's own layout is still the file's.
  let changed = false;
  if (ownedByOneChild) {
    for (const child of node.children) {
      if (collapseOneOverlapping(child, range)) changed = true;
    }
  }
  if (changed) return true;
  if (isGatePoint(node)) {
    collapse(node);
    return true;
  }
  // Overlapping, has children, not a gate point (a file/section, never gated on
  // its own) — nothing narrower to collapse.
  return false;
}

/**
 * Same narrowing as {@link collapsingOverlapping}, but for a size-changing
 * edit: everything at or after `offset` may have shifted, so the trigger is
 * "ends after the edit point" rather than "overlaps a range".
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.collapsingFrom
 */
export function collapsingFrom(nodes: UEFINode[], offset: number): UEFINode[] {
  for (const node of nodes) collapseOneFrom(node, offset);
  return nodes;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.collapseOneFrom */
function collapseOneFrom(node: UEFINode, offset: number): boolean {
  const own = fileRange(node);
  if (own === undefined || own.end <= offset || node.children.length === 0) return false;
  // Every child at or after the edit point goes, not the first one found: each
  // of them may have shifted, and one having collapsed says nothing about the
  // next.
  let changed = false;
  for (const child of node.children) {
    if (collapseOneFrom(child, offset)) changed = true;
  }
  if (changed) return true;
  if (isGatePoint(node)) {
    collapse(node);
    return true;
  }
  return false;
}

/**
 * Back to the state a gate point was left in before anything asked to see
 * inside it: no children, and the disclosure triangle that says they could be
 * read again.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.collapseOneOverlapping
 */
function collapse(node: UEFINode): void {
  node.children = [];
  node.isExpandable = true;
}
