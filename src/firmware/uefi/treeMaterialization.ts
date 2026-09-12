import type { ImageReader } from "@/firmware/imageReader";
import type { UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { walkNvramVolumeBody } from "@/firmware/uefi/nvramParser";
import {
  DEFAULT_EMPTY_BYTE,
  type Limits,
  Parser,
  type ProgressSink,
} from "@/firmware/uefi/parserState";
import { parseTopLevel, scanRawArea } from "@/firmware/uefi/rawScan";
import { childId, type NodeID, ROOT_ID, type UEFINode } from "@/firmware/uefi/uefiNode";
import { readVolumeHeader, volumeChildren } from "@/firmware/uefi/volumeParser";

/**
 * The one place a collapsed node's children are computed from the bytes.
 *
 * The parser never opens the two containers that cost a scan — a raw-area
 * region and a volume's body — so what it returns is always a tree with holes
 * in it. Filling one is this module's whole job, and both drivers go through
 * it: the lazy tree, which fills one node at a time as something asks for it,
 * and the all-at-once parse, which fills every one of them in a row.
 *
 * Free of state of its own — every function takes the reader and gives back
 * what it computed — so a worker can call it without carrying an object across
 * a boundary.
 */

export interface Materialized {
  readonly nodes: UEFINode[];
  readonly diagnostics: UEFIDiagnostic[];
}

/**
 * The top level, and nothing below it that can be deferred: a capsule's
 * envelope, an Intel image's regions, or — for an image with no descriptor —
 * the raw-area scan that decides what the top level even is.
 *
 * That last one is the one case where "the top level" costs a walk of the whole
 * file: nothing announces the structures in a plain chip dump but the
 * signatures inside it, so they have to be looked for before there is anything
 * to show. It is why a caller builds this off the main thread.
 */
export function rootsOf(
  reader: ImageReader,
  limits: Limits,
  progress?: ProgressSink
): Materialized {
  const parser = new Parser(reader, limits, progress);
  const nodes = reader.count === 0 ? [] : parseTopLevel(parser, reader.all, 0);
  return { nodes, diagnostics: parser.diagnostics };
}

/**
 * One collapsed node's children, parsed at the depth the node itself recorded
 * when it was left closed — so a node expanded now lands exactly where an
 * all-at-once parse would have put it, recursion limit included.
 */
export function childrenOf(
  node: UEFINode,
  reader: ImageReader,
  limits: Limits,
  progress?: ProgressSink
): Materialized {
  if (!node.isExpandable) return { nodes: [], diagnostics: [] };
  const parser = new Parser(reader, limits, progress);
  switch (node.kind) {
    case "volume": {
      const header = readVolumeHeader(parser, node.header.start);
      if (header === undefined) return { nodes: [], diagnostics: parser.diagnostics };
      return {
        nodes: volumeChildren(parser, header, node.body, node.childDepth, (body, empty, depth) =>
          walkNvramVolumeBody(parser, header.fileSystem, body, empty, depth)
        ),
        diagnostics: parser.diagnostics,
      };
    }
    case "region":
      return {
        nodes: scanRawArea(parser, node.body, DEFAULT_EMPTY_BYTE, node.childDepth),
        diagnostics: parser.diagnostics,
      };
    default:
      // Nothing else is ever left collapsed, so this is unreachable in
      // practice — and answering "no children" is the honest reading of a node
      // the parser did not gate.
      return { nodes: [], diagnostics: [] };
  }
}

/**
 * Fills in `node`'s children in place and marks it materialized.
 *
 * The node keeps its `isExpandable` only while its children are still unknown,
 * so a node that turned out to hold nothing does not go on offering a
 * disclosure triangle for the rest of the session.
 */
export function expand(
  node: UEFINode,
  id: NodeID,
  reader: ImageReader,
  limits: Limits,
  diagnostics: UEFIDiagnostic[],
  progress?: ProgressSink
): void {
  const result = childrenOf(node, reader, limits, progress);
  node.children = stampIds(result.nodes, id);
  node.isExpandable = false;
  diagnostics.push(...result.diagnostics);
}

/**
 * Opens every collapsed node there is, depth first — the whole tree, as the
 * parser would have built it in one pass if it opened everything on the way
 * down.
 */
export function materializeAll(
  nodes: UEFINode[],
  reader: ImageReader,
  limits: Limits,
  diagnostics: UEFIDiagnostic[],
  parent: NodeID = ROOT_ID,
  progress?: ProgressSink
): void {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) continue;
    const id = childId(parent, index);
    if (node.isExpandable) expand(node, id, reader, limits, diagnostics, progress);
    materializeAll(node.children, reader, limits, diagnostics, id, progress);
  }
}

/**
 * Ids are stamped relative to `parent` rather than threaded through the parser:
 * a node's place in the tree is not known until its parent has decided to keep
 * it, and a parser carrying counters is a parser that gets them wrong on the
 * paths where it gives up early.
 */
export function stampIds(nodes: UEFINode[], parent: NodeID): UEFINode[] {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) continue;
    node.id = childId(parent, index);
    stampIds(node.children, node.id);
  }
  return nodes;
}
