import type { ImageReader } from "@/firmware/imageReader";
import { type ByteSpace, insideSection, isFileSpace } from "@/firmware/uefi/byteSpace";
import { algorithmDisplayName, locateCompressedSection } from "@/firmware/uefi/compressedSection";
import type { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { type DiagnosticKind, locatedIn, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { parseFile } from "@/firmware/uefi/fileParser";
import { walkNvramVolumeBody } from "@/firmware/uefi/nvramParser";
import {
  DEFAULT_EMPTY_BYTE,
  type Limits,
  Parser,
  type ProgressSink,
} from "@/firmware/uefi/parserState";
import { parseTopLevel, scanRawArea } from "@/firmware/uefi/rawScan";
import { IMAGE_LAYOUT, type UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { walkSections } from "@/firmware/uefi/sectionParser";
import { childId, type NodeID, nodeRange, ROOT_ID, type UEFINode } from "@/firmware/uefi/uefiNode";
import { parseVolume, readVolumeHeader, volumeChildren } from "@/firmware/uefi/volumeParser";

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

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.Result
 */
export interface Materialized {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.Result.nodes */
  readonly nodes: UEFINode[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.Result.diagnostics */
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
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.roots
 */
export function rootsOf(
  reader: ImageReader,
  limits: Limits,
  layout: UEFIRootLayout = IMAGE_LAYOUT,
  progress?: ProgressSink
): Materialized {
  if (reader.count === 0) return { nodes: [], diagnostics: [] };
  const parser = new Parser(reader, limits, progress);
  // What the bytes are, where something outside them knows: the body of a
  // compressed section is a run of sections, and a signature scan reads it as
  // padding. A layout the bytes do not bear out is not forced on them — they
  // are read as an image, and the attempt that failed says nothing.
  switch (layout.kind) {
    case "image":
      break;
    case "volume": {
      const volume = parseVolume(parser, { offset: 0, limit: reader.count, depth: 0 });
      if (volume !== undefined) {
        const nodes = [
          volume,
          ...parser.padding(nodeRange(volume).end, reader.count, DEFAULT_EMPTY_BYTE),
        ];
        return { nodes, diagnostics: parser.diagnostics };
      }
      break;
    }
    case "file": {
      const file = parseFile(parser, {
        offset: 0,
        limit: reader.count,
        ffsVersion: layout.ffsVersion,
        volumeRevision: layout.volumeRevision,
        depth: 0,
      });
      if (file !== undefined) {
        const nodes = [file.node, ...parser.padding(file.size, reader.count, DEFAULT_EMPTY_BYTE)];
        return { nodes, diagnostics: parser.diagnostics };
      }
      break;
    }
    case "sections": {
      const nodes = walkSections(parser, reader.all, {
        ffsVersion: layout.ffsVersion,
        emptyByte: DEFAULT_EMPTY_BYTE,
        depth: 0,
      });
      return { nodes, diagnostics: parser.diagnostics };
    }
  }
  // A fresh parser for the fallback, so the failed attempt's complaints are
  // not carried into what the image itself says.
  const asImage = layout.kind === "image" ? parser : new Parser(reader, limits, progress);
  return { nodes: parseTopLevel(asImage, reader.all, 0), diagnostics: asImage.diagnostics };
}

/**
 * One collapsed node's children, parsed at the depth the node itself recorded
 * when it was left closed — so a node expanded now lands exactly where an
 * all-at-once parse would have put it, recursion limit included.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.children
 */
export function childrenOf(
  node: UEFINode,
  reader: ImageReader,
  limits: Limits,
  buffers: DecompressedBuffers,
  progress?: ProgressSink
): Materialized {
  if (!node.isExpandable) return { nodes: [], diagnostics: [] };
  const space = buffers.readerFor(node.space, reader, limits.maxDecompressedSize);
  if (!space.ok) {
    // The section holding this node no longer decodes. The expansion that
    // failed to open it has already said so, at the section.
    return { nodes: [], diagnostics: [] };
  }
  // Progress is a fraction of the file, which a buffer's offsets are not.
  const parser = new Parser(space.reader, limits, isFileSpace(node.space) ? progress : undefined);
  switch (node.kind) {
    case "volume": {
      const header = readVolumeHeader(parser, node.header.start);
      if (header === undefined) return located([], parser.diagnostics, node.space);
      return located(
        volumeChildren(parser, header, node.body, node.childDepth, (body, empty, depth) =>
          walkNvramVolumeBody(parser, header.fileSystem, body, empty, depth)
        ),
        parser.diagnostics,
        node.space
      );
    }
    case "region":
      return located(
        scanRawArea(parser, node.body, DEFAULT_EMPTY_BYTE, node.childDepth),
        parser.diagnostics,
        node.space
      );
    case "section":
      return decompressedChildren(node, space.reader, reader, limits, buffers);
    default:
      // Nothing else is ever left collapsed, so this is unreachable in
      // practice — and answering "no children" is the honest reading of a node
      // the parser did not gate.
      return { nodes: [], diagnostics: [] };
  }
}

/**
 * A compressed section's children: its body decoded, and the decoded bytes
 * walked as the run of sections they are — by the same `walkSections` a file's
 * body goes through, over a reader of the buffer.
 *
 * FFSv3's rules inside: a buffer has no volume of its own to say which revision
 * it follows, and the extended section size is the one thing the two revisions
 * read differently.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.decompressedChildren
 */
function decompressedChildren(
  section: UEFINode,
  parentReader: ImageReader,
  file: ImageReader,
  limits: Limits,
  buffers: DecompressedBuffers
): Materialized {
  const childSpace = insideSection(section.space, section.header.start);
  const read = buffers.readerFor(childSpace, file, limits.maxDecompressedSize);
  if (!read.ok) {
    const { problem } = read;
    const algorithm =
      problem.algorithm === undefined ? "Compressed" : algorithmDisplayName(problem.algorithm);
    const detail: DiagnosticKind =
      problem.failure.kind === "tooLarge"
        ? { kind: "decompressedTooLarge", algorithm, declared: problem.failure.declared }
        : {
            kind: "decompressionFailed",
            algorithm,
            truncated: problem.failure.kind === "truncated",
          };
    return {
      nodes: [],
      diagnostics: [locatedIn({ detail, offset: problem.section }, problem.space)],
    };
  }
  const buffer = read.reader;

  const diagnostics: UEFIDiagnostic[] = [];
  const declared = locateCompressedSection(section.header.start, parentReader)?.declaredLength;
  if (declared !== undefined && declared !== buffer.count) {
    diagnostics.push(
      locatedIn(
        {
          detail: { kind: "decompressedSizeMismatch", stored: declared, computed: buffer.count },
          offset: section.header.start,
        },
        section.space
      )
    );
  }

  const parser = new Parser(buffer, limits);
  const nodes = walkSections(parser, buffer.all, {
    ffsVersion: 3,
    emptyByte: DEFAULT_EMPTY_BYTE,
    depth: section.childDepth,
  });
  diagnostics.push(...parser.diagnostics.map((one) => locatedIn(one, childSpace)));
  return { nodes: stamping(nodes, childSpace), diagnostics };
}

/**
 * Puts `space` on every node a parse over that space's reader built, and locates
 * what that parse complained about. The parser itself never knows which space it
 * is reading: a buffer is one more source to it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.stamping
 */
export function stamping(nodes: UEFINode[], space: ByteSpace): UEFINode[] {
  if (isFileSpace(space)) return nodes;
  for (const node of nodes) {
    node.space = space;
    stamping(node.children, space);
  }
  return nodes;
}

/** The nodes in their space, with the diagnostics of that space placed in the file. */
function located(
  nodes: UEFINode[],
  diagnostics: readonly UEFIDiagnostic[],
  space: ByteSpace
): Materialized {
  return {
    nodes: stamping(nodes, space),
    diagnostics: diagnostics.map((one) => locatedIn(one, space)),
  };
}

/**
 * Fills in `node`'s children in place and marks it materialized.
 *
 * The node keeps its `isExpandable` only while its children are still unknown,
 * so a node that turned out to hold nothing does not go on offering a
 * disclosure triangle for the rest of the session.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.expand
 */
export function expand(
  node: UEFINode,
  id: NodeID,
  reader: ImageReader,
  limits: Limits,
  buffers: DecompressedBuffers,
  diagnostics: UEFIDiagnostic[],
  progress?: ProgressSink
): void {
  const result = childrenOf(node, reader, limits, buffers, progress);
  node.children = stampIds(result.nodes, id);
  node.isExpandable = false;
  diagnostics.push(...result.diagnostics);
}

/**
 * Opens every collapsed node there is, depth first — the whole tree, as the
 * parser would have built it in one pass if it opened everything on the way
 * down.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.materializeAll
 */
export function materializeAll(
  nodes: UEFINode[],
  reader: ImageReader,
  limits: Limits,
  buffers: DecompressedBuffers,
  diagnostics: UEFIDiagnostic[],
  options?: { parent?: NodeID; progress?: ProgressSink; opensCompressed?: boolean }
): void {
  const parent = options?.parent ?? ROOT_ID;
  const opensCompressed = options?.opensCompressed ?? true;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) continue;
    const id = childId(parent, index);
    if (node.isExpandable && (opensCompressed || node.kind !== "section")) {
      expand(node, id, reader, limits, buffers, diagnostics, options?.progress);
    }
    materializeAll(node.children, reader, limits, buffers, diagnostics, {
      parent: id,
      ...(options?.progress === undefined ? {} : { progress: options.progress }),
      opensCompressed,
    });
  }
}

/**
 * Ids are stamped relative to `parent` rather than threaded through the parser:
 * a node's place in the tree is not known until its parent has decided to keep
 * it, and a parser carrying counters is a parser that gets them wrong on the
 * paths where it gives up early.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.stampIDs
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
