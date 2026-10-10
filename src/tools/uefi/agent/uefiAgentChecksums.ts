import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { hexText as bytesHex } from "@/core/agent/agentBytes";
import { hexByteText } from "@/core/agent/agentHexBytes";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import type { ChecksumRepair } from "@/firmware/uefi/checksumRepair";
import { type NodeID, nodeFileRange, nodeIdText, type UEFINode } from "@/firmware/uefi/uefiNode";
import {
  hexText,
  nodeSummary,
  pathNames,
  type UefiAgentContext,
} from "@/tools/uefi/agent/uefiAgentQueries";
import {
  type AgentTree,
  allNodes,
  nodeAtPath,
  openEverything,
  parseNodeId,
  reachable,
  unknownNode,
} from "@/tools/uefi/agent/uefiAgentTree";

/**
 * Every checksum of an image checked at once, for an agent: what the panel's red flags say,
 * without opening each branch to see them. The check is the panel's own (`repairsFor`), so a node
 * is wrong here exactly when its row is flagged there.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.all
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.check
 * @upstream-differs plain functions of the worker's tree, where upstream's are queries run on the
 * main actor with the pass moved off it
 */

export const UEFI_CHECKSUMS = {
  name: "uefi_checksums",
  title: "Check the UEFI checksums",
  description:
    "Checks every checksum the UEFI Structure panel checks — a volume's header checksum, a file's " +
    "header and data checksums, a microcode's, an AMD PSP or BIOS directory's — in the whole image or " +
    "under `node`, opening every volume and decompressing every section it can, and lists the nodes " +
    "whose checksums are wrong: which field, what is stored and what it should be. A node inside a " +
    "compressed section is checked against what the section decompresses to; it is marked " +
    "`in_compressed` and cannot be fixed in place. `checked` counts the nodes that carry a checksum, " +
    "`wrong` those listed. `uefi_fix_checksum` puts them right, one node or all at once. Pages: " +
    "`limit` is a ceiling — a page also stops before the answer passes the size bound and then says " +
    '`truncated: "size"`; pass `next` back as `after` until it is null.',
  properties: {
    node: AgentSchema.string('Check only under this node, e.g. "0.2". Default: the whole image.'),
    limit: AgentSchema.limit(50, 200),
    after: AgentSchema.after,
  },
} as const;

/**
 * A checksum a node of a known kind carries, so a caller can say which one of them is wrong
 * without looking at byte offsets.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumField
 */
export type ChecksumField = "volume" | "fileHeader" | "fileBody" | "microcode" | "pspDirectory";

/**
 * The checksum field one repair of `node` stands for: a volume's and a microcode image's every
 * repair is their one checksum; a file's two checksum bytes sit at fixed offsets, so which byte
 * was written tells header from body apart.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.fields
 */
export function checksumFieldOf(node: UEFINode, repair: ChecksumRepair): ChecksumField {
  switch (node.kind) {
    case "microcode":
      return "microcode";
    case "amdDirectory":
      return "pspDirectory";
    case "file":
      return repair.offset === node.header.start + 0x11 ? "fileBody" : "fileHeader";
    default:
      return "volume";
  }
}

/** Whether the node is of a kind that carries a checksum. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.carriesChecksum */
export const carriesChecksum = (node: UEFINode): boolean =>
  node.kind === "volume" ||
  node.kind === "file" ||
  node.kind === "microcode" ||
  node.kind === "amdDirectory";

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.isUnder */
export const isUnder = (id: NodeID, under: NodeID): boolean =>
  under.length === 0 ||
  (id.length >= under.length && under.every((part, index) => id[index] === part));

/**
 * One wrong checksum: which, where — a file address, or an offset in the decompressed buffer for a
 * node inside a compressed section — and the bytes there and the bytes that belong there.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongField
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongField.field
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongField.offset
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongField.stored
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongField.shouldBe
 */
export interface WrongField {
  readonly field: ChecksumField;
  readonly offset: number;
  readonly stored: Uint8Array;
  readonly shouldBe: Uint8Array;
}

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongNode
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongNode.node
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.WrongNode.fields
 */
export interface WrongNode {
  readonly node: UEFINode;
  readonly fields: readonly WrongField[];
}

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.Scan
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.Scan.checked
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.Scan.wrong
 */
export interface Scan {
  /** The nodes that carry a checksum. */
  checked: number;
  /** Those with one wrong, in tree order. */
  wrong: WrongNode[];
}

/**
 * Opens everything, then checks every node under `under` that carries a checksum.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.scan
 */
export function scan(tree: AgentTree, under: NodeID): Scan {
  openEverything(tree);
  const nodes = allNodes(tree).filter((node) => carriesChecksum(node) && isUnder(node.id, under));
  const result: Scan = { checked: nodes.length, wrong: [] };
  for (const node of nodes) {
    const reader = tree.spaceReaders.readerFor(node.space);
    // A section on the way in that no longer decodes has nothing to read.
    if (reader === undefined) continue;
    const repairs = tree.repairs(node, node.id);
    if (repairs.length === 0) continue;
    result.wrong.push({
      node,
      fields: repairs.map((repair) => ({
        field: checksumFieldOf(node, repair),
        offset: repair.offset,
        stored: reader.bytesAt(repair.offset, repair.bytes.length) ?? new Uint8Array(0),
        shouldBe: repair.bytes,
      })),
    });
  }
  return result;
}

/**
 * The writes that put every checksum under `under` right that can be written in place, and the
 * nodes they fix.
 *
 * A file can hold a volume, and that volume files: fixing an inner file changes the body of the
 * outer one, whose checksum then has to be worked out over the fixed bytes. So the pass is
 * repeated over a copy of the file with each round's fixes in it, until a round finds nothing.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.fixAll
 */
export function fixAll(
  tree: AgentTree,
  under: NodeID
): { writes: { offset: number; bytes: Uint8Array }[]; fixed: UEFINode[] } {
  openEverything(tree);
  const nodes = allNodes(tree).filter(
    (node) => nodeFileRange(node) !== undefined && carriesChecksum(node) && isUnder(node.id, under)
  );
  const whole = tree.reader.bytes(tree.reader.all);
  const changed = new Map<number, number>();
  const fixed = new Set<string>();
  if (whole !== undefined) {
    const copy = Uint8Array.from(whole);
    for (let round = 0; round < 8; round++) {
      const reader = new ImageReader(sourceOver(copy));
      let any = false;
      for (const node of nodes) {
        const repairs = tree.repairs(node, node.id, reader);
        if (repairs.length === 0) continue;
        any = true;
        fixed.add(nodeIdText(node.id));
        for (const repair of repairs) {
          repair.bytes.forEach((byte, index) => {
            copy[repair.offset + index] = byte;
            changed.set(repair.offset + index, byte);
          });
        }
      }
      if (!any) break;
    }
  }
  // Runs of neighbouring bytes, one write each.
  const writes: { offset: number; bytes: Uint8Array }[] = [];
  for (const offset of [...changed.keys()].sort((one, two) => one - two)) {
    const byte = changed.get(offset) as number;
    const last = writes.at(-1);
    if (last !== undefined && last.offset + last.bytes.length === offset) {
      last.bytes = Uint8Array.from([...last.bytes, byte]);
    } else {
      writes.push({ offset, bytes: Uint8Array.of(byte) });
    }
  }
  return { writes, fixed: nodes.filter((node) => fixed.has(nodeIdText(node.id))) };
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentChecksums.swift#UEFIAgentChecksums.check */
export function uefiChecksums(
  tree: AgentTree,
  args: AgentArguments,
  context: UefiAgentContext
): Json {
  const under = parseNodeId(args.optionalString("node"));
  const limit = args.limit(50, 200);
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([context.contentVersion, nodeIdText(under)])
  );
  if (under.length > 0) {
    reachable(tree, under);
    if (nodeAtPath(tree, under) === undefined) throw unknownNode(under);
  }
  const found = scan(tree, under);
  const items: Json[] = [];
  for (const [index, wrong] of found.wrong.entries()) {
    if (index < paging.first || items.length >= limit) continue;
    items.push({
      ...nodeSummary(wrong.node),
      path: pathNames(tree, wrong.node.id),
      checksums: wrong.fields.map((field) => {
        const members: { [key: string]: Json } = {
          field: field.field,
          at: hexText(field.offset),
          stored: bytesHex(field.stored),
          should_be: bytesHex(field.shouldBe),
        };
        if (nodeFileRange(wrong.node) === undefined) members.at_in = "decompressed";
        return members;
      }),
    });
  }
  const fixable = found.wrong.filter((one) => nodeFileRange(one.node) !== undefined).length;
  return paging.answer(
    { checked: found.checked, wrong: found.wrong.length, fixable },
    "nodes",
    items,
    found.wrong.length,
    args.answerBound
  );
}

/**
 * What `uefi_fix_checksum` works out: the writes that put one node's checksums right, or with
 * `all` every wrong checksum in the image (or under `node`) that can be written in place.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentEdits.swift#UEFIAgentEdits.fixChecksum
 */
export function fixChecksumAnswer(tree: AgentTree, args: AgentArguments): Json {
  const id = parseNodeId(args.optionalString("node"));
  if (args.bool("all", false)) {
    if (id.length > 0) {
      reachable(tree, id);
      if (nodeAtPath(tree, id) === undefined) throw unknownNode(id);
    }
    const found = scan(tree, id);
    const compressed = found.wrong.filter((one) => nodeFileRange(one.node) === undefined).length;
    const { writes, fixed } = fixAll(tree, id);
    if (writes.length === 0) {
      throw new AgentToolError(
        compressed === 0
          ? "Every checksum checks out; nothing to write."
          : `The only wrong checksums are inside compressed sections (${compressed}), which cannot be written in place.`
      );
    }
    return {
      writes: writes.map((one) => ({ offset: one.offset, bytes: hexByteText(one.bytes) })),
      fixed: fixed.map((node) => ({
        id: nodeIdText(node.id),
        name: nodeSummary(node).name ?? null,
      })),
      skipped_compressed: compressed,
    };
  }
  if (id.length === 0) {
    throw new AgentToolError("Give `node`, or `all: true` for every wrong checksum.");
  }
  reachable(tree, id);
  const target = nodeAtPath(tree, id);
  if (target === undefined) throw unknownNode(id);
  if (target.space.length > 0) {
    throw new AgentToolError(
      `${nodeIdText(id)} is inside a compressed section, which the file holds compressed; ` +
        "its checksum cannot be written in place."
    );
  }
  const repairs = tree.repairs(target, id);
  if (repairs.length === 0) {
    throw new AgentToolError(
      `The checksums of ${nodeIdText(id)} already check out; nothing to write.`
    );
  }
  return {
    writes: repairs.map((one) => ({ offset: one.offset, bytes: hexByteText(one.bytes) })),
  };
}
