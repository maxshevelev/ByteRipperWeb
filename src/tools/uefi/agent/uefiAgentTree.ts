import { AgentToolError } from "@/core/agent/agentTool";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  type ChecksumRepair,
  repairsForAMDDirectory,
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
  volumeAlongPath,
} from "@/firmware/uefi/checksumRepair";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { volumeErasePolarity } from "@/firmware/uefi/fileParser";
import { DEFAULT_LIMITS } from "@/firmware/uefi/parserState";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { childrenOf, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  type NodeID,
  nodeFileRange,
  nodeIdText,
  ROOT_ID,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";

/**
 * The tree an agent's UEFI questions are asked of: the pane's one shared parse, the tree the panel
 * draws, so a question asked with the panel closed opens the same branches the panel will find open.
 *
 * A node is named by its place in the tree, `"0.2.5"`, which is exact for these bytes; a node in
 * another dump is found by what it is (`uefi_find`), since two images do not number their volumes
 * alike.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries
 * @upstream-differs synchronous, over the tree where it stands: the firmware worker holds the parse and
 * answers inside the request that asked, so there is no waiting for a branch to be read
 */
export interface AgentTree {
  /** The top of the tree, as it stands. */
  readonly roots: UEFINode[];
  /** The file's size now. */
  readonly size: number;
  /** The file's reader. */
  readonly reader: ImageReader;
  /** The reader of each space — the file, or what a compressed section decompresses to. */
  readonly spaceReaders: SpaceReaders;
  /** Opens a closed container where it stands, keeping its children. */
  open(node: UEFINode): void;
  /** What the panel's detail would say about `node`, at `path`. */
  detail(node: UEFINode, path: NodeID): NodeDetail;
  /** The image as the tree stands: its nodes and what is known of it. */
  image(): UEFIImage;
  /**
   * The writes that would put a node's checksums right, which is what the panel's red flag and its
   * "should be" are made of. Read from the node's own space, or — for a node of the file — from
   * `file`, a copy of the file with fixes in it.
   */
  repairs(node: UEFINode, path: NodeID, file?: ImageReader): ChecksumRepair[];
}

/** The tree over bytes, with nothing else about it — what a test, or a document no panel has read, uses. */
export function agentTreeOver(bytes: Uint8Array): AgentTree {
  const reader = new ImageReader(sourceOver(bytes));
  const buffers = new DecompressedBuffers();
  const roots = stampIds(rootsOf(reader, DEFAULT_LIMITS).nodes, ROOT_ID);
  const spaceReaders = new SpaceReaders(reader, { limits: DEFAULT_LIMITS, buffers });
  return {
    roots,
    size: reader.count,
    reader,
    spaceReaders,
    open(node) {
      if (!node.isExpandable) return;
      const result = childrenOf(node, reader, DEFAULT_LIMITS, buffers);
      node.children = stampIds(result.nodes, node.id);
      node.isExpandable = false;
    },
    detail(node) {
      return buildNodeDetail(
        node,
        new UEFIImage({ size: reader.count, roots }),
        spaceReaders.readerFor(node.space) ?? reader
      );
    },
    image: () => new UEFIImage({ size: reader.count, roots }),
    repairs(node, path, file) {
      const own = file ?? spaceReaders.readerFor(node.space);
      return own === undefined ? [] : repairsOver(roots, node, path, own);
    },
  };
}

/** The node at `path`, or nothing. @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.node */
export function nodeAtPath(tree: AgentTree, path: NodeID): UEFINode | undefined {
  let nodes: readonly UEFINode[] = tree.roots;
  let found: UEFINode | undefined;
  for (const index of path) {
    const next = nodes[index];
    if (next === undefined) return undefined;
    found = next;
    nodes = next.children;
  }
  return found;
}

/**
 * The children of `path`, reading them first if nobody has yet.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.expanded
 */
export function expanded(tree: AgentTree, path: NodeID): UEFINode[] {
  if (path.length === 0) return tree.roots;
  const node = nodeAtPath(tree, path);
  if (node === undefined) return [];
  tree.open(node);
  return node.children;
}

/**
 * Opens every container on the way down to `path`, so a node an agent was told about in an earlier
 * session — before the branch was read in this one — can still be found by its id.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.reachable
 */
export function reachable(tree: AgentTree, path: NodeID): boolean {
  for (let length = 1; length < path.length; length++) expanded(tree, path.slice(0, length));
  return nodeAtPath(tree, path) !== undefined;
}

/**
 * Opens every closed container in the image, breadth first.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.openEverything
 */
export function openEverything(tree: AgentTree): void {
  const queue: UEFINode[] = [...tree.roots];
  for (let at = 0; at < queue.length; at++) {
    const node = queue[at];
    if (node === undefined) continue;
    if (node.isExpandable) tree.open(node);
    queue.push(...node.children);
  }
}

/** Every node in the tree as it stands, depth first, in tree order. */
export function allNodes(tree: AgentTree): UEFINode[] {
  const result: UEFINode[] = [];
  const walk = (nodes: readonly UEFINode[]) => {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(tree.roots);
  return result;
}

/**
 * A node id from the text an agent gives, `"0.2.5"`; the top for none.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.nodeID
 */
export function parseNodeId(text: string | undefined): NodeID {
  if (text === undefined || text === "" || text === "root") return ROOT_ID;
  const parts = text.split(".").map((part) => (/^[0-9]+$/.test(part) ? Number(part) : -1));
  if (parts.length === 0 || parts.some((part) => part < 0)) {
    throw new AgentToolError(
      `\`${text}\` is not a node id. Ids look like "0.2.5" and come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\`.`
    );
  }
  return parts;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.unknownNode */
export const unknownNode = (id: NodeID): AgentToolError =>
  new AgentToolError(
    `No node ${nodeIdText(id)} in this image. Ids come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\` on the same document.`
  );

/** The file range of a node: nothing inside a compressed section. */
export const fileRangeOf = (node: UEFINode) => nodeFileRange(node);

/**
 * The writes that would put a node's checksums right, read from `reader`: the node's own space,
 * or — to check a copy of the file with fixes in it — the file's.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.repairs
 */
export function repairsOver(
  roots: readonly UEFINode[],
  node: UEFINode,
  path: NodeID,
  reader: ImageReader
): ChecksumRepair[] {
  switch (node.kind) {
    case "volume":
      return repairsForVolume(node, reader);
    case "microcode":
      return repairsForMicrocode(node, reader);
    case "amdDirectory":
      return repairsForAMDDirectory(node, reader);
    case "file": {
      const { volume, revision } = volumeAlongPath(roots, path);
      return repairsForFile(
        node,
        revision,
        reader,
        volume === undefined ? undefined : volumeErasePolarity(volume, reader)
      );
    }
    default:
      return [];
  }
}
