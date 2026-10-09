import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AGENT_FORMATS, shownBytes } from "@/core/agent/agentBytes";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { ImageReader } from "@/firmware/imageReader";
import type { ByteSpace } from "@/firmware/uefi/byteSpace";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { nodeIdText, type UEFINode } from "@/firmware/uefi/uefiNode";
import { hexText } from "@/tools/uefi/agent/uefiAgentQueries";
import {
  type AgentTree,
  expanded,
  nodeAtPath,
  parseNodeId,
  reachable,
  unknownNode,
} from "@/tools/uefi/agent/uefiAgentTree";
import { type CompressedSectionNode, decompressedBody } from "@/tools/uefi/uefiPresenter";

/**
 * A node's own bytes for an agent, wherever the node lives — in the file, or in what a compressed
 * section decompressed to, where it has no file address and `read` cannot reach it.
 *
 * The bytes are the tree's: a node in the file is read from the document as it is now, unsaved edits
 * included; one inside a compressed section from the buffer the tree already decompressed it into,
 * never decompressed again.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData
 */

/**
 * Which of a node's bytes. `decompressed` is what a compressed section decompresses to — the whole
 * buffer its children are read from.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.Part
 */
export const NODE_PARTS = ["body", "header", "all", "decompressed"] as const;
export type NodeDataPart = (typeof NODE_PARTS)[number];

/**
 * A node's bytes: where they are read from and which they are.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.Bytes
 */
export interface NodeBytes {
  readonly node: UEFINode;
  readonly reader: ImageReader;
  /** The part, in `space`. */
  readonly range: { readonly start: number; readonly end: number };
  /** Where the part is: the file, or a buffer — the node's own, or for `decompressed` the one the section opens to. */
  readonly space: ByteSpace;
  readonly tree: AgentTree;
}

/** The node as the presenter reads a compressed section: its ranges as pairs. */
export const compressedView = (node: UEFINode): CompressedSectionNode => ({
  kind: node.kind,
  name: node.name,
  header: [node.header.start, node.header.end],
  body: [node.body.start, node.body.end],
  tail: [node.tail.start, node.tail.end],
  space: node.space,
  compression: node.compression,
  isExpandable: node.isExpandable,
  children: node.children,
});

/** The part's bytes as file addresses; nothing inside a compressed section. */
export const fileRangeOfBytes = (found: NodeBytes) =>
  isFileSpace(found.space) ? found.range : undefined;

/** The node `text` names and the bytes of its `part`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.bytes */
export function nodeBytes(tree: AgentTree, text: string, part: NodeDataPart): NodeBytes {
  const id = parseNodeId(text);
  if (id.length === 0)
    throw new AgentToolError("The top of the tree is not a node; call `uefi_tree`.");
  reachable(tree, id);
  const node = nodeAtPath(tree, id);
  if (node === undefined) throw unknownNode(id);
  if (part === "decompressed") {
    const body = decompressedBody(compressedView(node));
    if (body === undefined) {
      throw new AgentToolError(
        `Node ${nodeIdText(id)} is not a compressed section; part "decompressed" is a compressed section's.`
      );
    }
    expanded(tree, id);
    const reader = tree.spaceReaders.readerFor(body.space);
    if (reader === undefined || reader.count === 0) {
      throw new AgentToolError(`Section ${nodeIdText(id)} could not be decompressed.`);
    }
    return { node, reader, range: { start: 0, end: reader.count }, space: body.space, tree };
  }
  const range =
    part === "body"
      ? node.body
      : part === "header"
        ? node.header
        : {
            start: node.header.start,
            end: Math.max(node.header.end, node.body.end, node.tail.end),
          };
  if (range.end <= range.start) {
    throw new AgentToolError(
      part === "all"
        ? `Node ${nodeIdText(id)} holds no bytes.`
        : `Node ${nodeIdText(id)} has no ${part}; ask for part "all"${part === "header" ? ' or "body"' : ' or "header"'}.`
    );
  }
  const reader = tree.spaceReaders.readerFor(node.space);
  if (reader === undefined) {
    throw new AgentToolError(
      `Node ${nodeIdText(id)} is inside a compressed section whose contents could not be read.`
    );
  }
  return { node, reader, range, space: node.space, tree };
}

/**
 * The compressed section a node's bytes came out of: the outermost one, the section in the file, and
 * how many more it is nested in. Nothing for a node of the file.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.source
 */
export function sectionSource(
  tree: AgentTree,
  node: UEFINode,
  including = false
): { [key: string]: Json } | undefined {
  if (isFileSpace(node.space) && !including) return undefined;
  let outer: UEFINode | undefined;
  let depth = 0;
  const ids = including ? node.id : node.id.slice(0, -1);
  for (let length = 1; length <= ids.length; length++) {
    const ancestor = nodeAtPath(tree, ids.slice(0, length));
    if (ancestor === undefined || ancestor.compression === undefined) continue;
    if (outer === undefined && isFileSpace(ancestor.space)) outer = ancestor;
    depth += 1;
  }
  if (outer === undefined) return undefined;
  const members: { [key: string]: Json } = {
    section: nodeIdText(outer.id),
    start: hexText(outer.header.start),
    end: hexText(Math.max(outer.header.end, outer.body.end, outer.tail.end)),
  };
  if (outer.compression?.algorithm !== undefined) members.algorithm = outer.compression.algorithm;
  if (depth > 1) members.nested = depth - 1;
  return members;
}

/**
 * The deepest node under `node` whose bytes hold `range` whole — in the node's own space, opening
 * containers on the way down.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.deepest
 */
export function deepestCovering(
  tree: AgentTree,
  range: { readonly start: number; readonly end: number },
  space: ByteSpace,
  under: UEFINode
): UEFINode {
  let current = under;
  for (;;) {
    const children =
      current.isExpandable || current.children.length > 0 ? expanded(tree, current.id) : [];
    const child = children.find((one) => {
      const own = {
        start: one.header.start,
        end: Math.max(one.header.end, one.body.end, one.tail.end),
      };
      return (
        sameSpaceAs(one.space, space) &&
        own.start <= range.start &&
        range.end <= own.end &&
        own.end > own.start
      );
    });
    if (child === undefined) return current;
    current = child;
  }
}

const sameSpaceAs = (one: ByteSpace, two: ByteSpace): boolean =>
  one.length === two.length && one.every((part, index) => part === two[index]);

export const UEFI_NODE_DATA = {
  name: "uefi_node_data",
  title: "UEFI node bytes",
  description:
    "Reads a node's bytes as `read` reads a document's — rows of 16 with their address, text, or " +
    "integers — at addresses inside the node's `part` (`body` by default, `header`, or `all`), " +
    "from 0. Works for a node inside a compressed section too, which has no file address and " +
    "which `read` cannot reach: its bytes are what the tree decompressed it to, and `source` says " +
    "which compressed section in the file they came out of. For a compressed section itself, " +
    "part `decompressed` is what it decompresses to — the buffer its children are in. `size` is the whole part's, to read " +
    "on by `offset`; at most 4096 bytes at a time. A node of the file gives `file_start` as well: " +
    "its bytes are the document's at that address, unsaved edits included, and `read`, `reveal` " +
    "and `write` work there. `find_bytes` with `node` searches the same bytes.",
  properties: {
    node: AgentSchema.string('The node\'s id, e.g. "0.2.5.0.0.1.0.530.2".'),
    part: AgentSchema.choice(NODE_PARTS, 'Which bytes of the node. Default "body".'),
    offset: AgentSchema.offset("Where to start inside the part. Default 0x0."),
    length: AgentSchema.offset("How many bytes. Default 256, at most 4096."),
    format: AgentSchema.choice(AGENT_FORMATS, 'How to show them. Default "hex".'),
    endian: AgentSchema.choice(["little", "big"], 'For u16, u32 and u64. Default "little".'),
  },
  required: ["node"],
} as const;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.data */
export function uefiNodeData(tree: AgentTree, args: AgentArguments): Json {
  const part = args.choice("part", NODE_PARTS, "body");
  const offset = args.optionalOffset("offset") ?? 0;
  const asked = args.optionalOffset("length") ?? 256;
  const format = args.choice("format", AGENT_FORMATS, "hex");
  const bigEndian = args.choice("endian", ["little", "big"] as const, "little") === "big";
  if (asked <= 0) throw new AgentToolError("Argument `length` must be at least 1.");
  if (asked > 4096) throw new AgentToolError("Argument `length`: at most 4096 bytes in one read.");
  const found = nodeBytes(tree, args.string("node"), part);
  const size = found.range.end - found.range.start;
  if (offset >= size) {
    throw new AgentToolError(
      `Offset ${hexText(offset)} is past the end of the ${part}, which is ${hexText(size)} bytes long.`
    );
  }
  const length = Math.min(asked, size - offset);
  const start = found.range.start + offset;
  const read = found.reader.bytes({ start, end: start + length });
  if (read === undefined || read.length !== length) {
    throw new AgentToolError(`Those bytes of node ${nodeIdText(found.node.id)} could not be read.`);
  }
  const answer: { [key: string]: Json } = {
    ...shownBytes(read, offset, format, bigEndian),
    node: nodeIdText(found.node.id),
    part,
    offset: hexText(offset),
    length: hexText(length),
    size: hexText(size),
    in_compressed: !isFileSpace(found.space),
  };
  const fileRange = fileRangeOfBytes(found);
  if (fileRange !== undefined) answer.file_start = hexText(fileRange.start);
  const source = sectionSource(tree, found.node, part === "decompressed");
  if (source !== undefined) answer.source = source;
  if (length < asked) answer.cut_at_end_of_part = true;
  return answer;
}
