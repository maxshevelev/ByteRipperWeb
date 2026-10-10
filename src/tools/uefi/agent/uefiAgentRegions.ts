import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import type { Json } from "@/core/agent/json";
import { nodeFileRange, nodeIdText, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { hexText, nodeSummary, type UefiAgentContext } from "@/tools/uefi/agent/uefiAgentQueries";
import {
  type AgentTree,
  expanded,
  nodeAtPath,
  parseNodeId,
  reachable,
  unknownNode,
} from "@/tools/uefi/agent/uefiAgentTree";
import { ownName, subtypeText, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * What the nodes the parser cannot name hold (`Design/AGENT_PROTOCOL.md`, `region_scan`):
 * padding, unused and unknown areas, raw files, each judged by its bytes — empty, text, data or
 * code — so the one with the board's data in it is found without reading each by hand.
 *
 * Only a judgement and a few short strings are answered, never the bytes. An area the flash map
 * names a key, a password or an MSDM table gives no strings at all.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.all
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.scan
 * @upstream-differs a plain function of the worker's tree, where upstream's is a query on the main
 * actor
 */

export const REGION_SCAN = {
  name: "region_scan",
  title: "Scan the nameless areas",
  description:
    "Judges by their bytes the nodes the parser cannot name — Padding (the flash map's Unused, " +
    "Unknown and named areas among them) and Raw files and sections — under `node` (default: the " +
    "BIOS region), in address order. A node its children divide is replaced by them; one whose only " +
    "child covers it whole stays, naming the child as `inner`. Each: `node`, `name`, `type`, " +
    "`subtype`, `guid`, `start`, `end`, `size`; `fill` (the share of 0xFF and 0x00 bytes), " +
    "`first_nonfill` and `last_nonfill` (the first and the last other byte); `class` — `empty` (at " +
    "least 99% fill), `text` (most of the other bytes are ASCII or UTF-16LE strings of 4 characters " +
    "or more), `code` (x86-64 instructions, by a heuristic: frequent REX.W moves, calls and " +
    "returns, or a PE image), else `data`; and up to five `strings` with their addresses. The " +
    "bytes themselves are never answered: `read` or `uefi_node_data` read them. An area whose name " +
    "in the flash map says MSDM, Password or Key gives its class and sizes, no strings, and " +
    "`redacted: true`. `kinds` picks the node types (the Type or Subtype column), default Padding " +
    "and Raw; `min_size` leaves out smaller nodes. Pages: `limit`, `after` as in `uefi_find`. With " +
    "`survey`, the same area across a folder of dumps.",
  properties: {
    node: AgentSchema.string(
      'Scan under this node, e.g. "0.2". Default: the BIOS region, or the whole image.'
    ),
    kinds: AgentSchema.strings(
      'Node types to take, as the Type or Subtype column shows them. Default ["Padding", "Raw"].'
    ),
    min_size: AgentSchema.offset("Leave out nodes smaller than this. Default 0x100."),
    limit: AgentSchema.limit(50, 200),
    after: AgentSchema.after,
  },
} as const;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.scan */
export function regionScan(tree: AgentTree, args: AgentArguments, context: UefiAgentContext): Json {
  const kinds = new Set(
    (args.has("kinds") ? args.strings("kinds") : ["Padding", "Raw"]).map((one) => one.toLowerCase())
  );
  const minSize = args.optionalOffset("min_size") ?? 0x100;
  const limit = args.limit(50, 200);
  let under = parseNodeId(args.optionalString("node"));
  if (under.length === 0) {
    const bios = tree.roots.flatMap((root) => [root, ...root.children]).find(isBIOSRegion);
    if (bios !== undefined) under = bios.id;
  }
  let start: UEFINode[];
  if (under.length === 0) {
    start = tree.roots;
  } else {
    reachable(tree, under);
    const node = nodeAtPath(tree, under);
    if (node === undefined) throw unknownNode(under);
    start = [node];
  }
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([
      context.contentVersion,
      nodeIdText(under),
      [...kinds].sort().join(","),
      minSize,
    ])
  );

  const taken: { node: UEFINode; inner: UEFINode | undefined }[] = [];
  for (const node of start) taken.push(...collect(node, kinds, minSize, tree));
  const items: Json[] = [];
  for (const entry of taken.slice(paging.first, paging.first + limit)) {
    const { id, children: _children, ...rest } = nodeSummary(tree, entry.node);
    const members: { [key: string]: Json } = { node: id ?? null, ...rest };
    const range = nodeFileRange(entry.node);
    if (range !== undefined) members.size = hexText(range.end - range.start);
    if (entry.inner !== undefined) {
      members.inner = {
        node: nodeIdText(entry.inner.id),
        name: ownName(entry.inner) ?? entry.inner.name,
      };
    }
    const bytes = range === undefined ? undefined : tree.reader.bytes(range);
    if (range !== undefined && bytes !== undefined) {
      const judgement = judge(bytes, range.start);
      members.class = judgement.kind;
      members.fill = Math.round(judgement.fill * 1000) / 1000;
      if (judgement.firstNonFill !== undefined)
        members.first_nonfill = hexText(judgement.firstNonFill);
      if (judgement.lastNonFill !== undefined)
        members.last_nonfill = hexText(judgement.lastNonFill);
      if (isSecret(entry.node, tree)) {
        members.strings = [];
        members.redacted = true;
      } else {
        members.strings = judgement.strings.map((found) => ({
          at: hexText(found.offset),
          text: found.text,
          encoding: found.utf16 ? "utf16le" : "ascii",
        }));
      }
    }
    items.push(members);
  }
  return paging.answer(
    { total: taken.length, under: nodeIdText(under) },
    "nodes",
    items,
    taken.length,
    args.answerBound
  );
}

// MARK: - Which nodes

/**
 * The nodes of `kinds` under `node`, in the file: a matching node its children divide gives way
 * to the matching ones among them; one whose only child covers it whole is taken itself, the
 * child named.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.collect
 */
export function collect(
  node: UEFINode,
  kinds: ReadonlySet<string>,
  minSize: number,
  tree: AgentTree
): { node: UEFINode; inner: UEFINode | undefined }[] {
  const range = nodeFileRange(node);
  if (range === undefined) return [];
  const children = (
    node.isExpandable || node.children.length > 0 ? expanded(tree, node.id) : []
  ).filter((child) => nodeFileRange(child) !== undefined);
  const below: { node: UEFINode; inner: UEFINode | undefined }[] = [];
  for (const child of children) below.push(...collect(child, kinds, minSize, tree));
  const matches =
    kinds.has(typeText(node).toLowerCase()) || kinds.has(subtypeText(node).toLowerCase());
  if (!matches || range.end - range.start < minSize) return below;
  const only = children.length === 1 ? children[0] : undefined;
  const whole =
    only !== undefined &&
    nodeRange(only).start === range.start &&
    nodeRange(only).end === range.end;
  if (below.length > 0 && !whole) return below;
  return [{ node, inner: whole ? only : undefined }];
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.isBIOSRegion */
export const isBIOSRegion = (node: UEFINode): boolean =>
  typeText(node) === "Region" && subtypeText(node) === "BIOS";

/**
 * Whether the node or an area holding it is named for a secret in the flash map: its strings are
 * never answered.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.isSecret
 */
export function isSecret(node: UEFINode, tree: AgentTree): boolean {
  for (let length = 1; length <= Math.max(1, node.id.length); length++) {
    const holder = nodeAtPath(tree, node.id.slice(0, length));
    if (holder !== undefined && isSecretName(ownName(holder) ?? holder.name)) return true;
  }
  return false;
}

/**
 * MSDM, Password or Key as a word of the name, any case.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.isSecretName
 */
export function isSecretName(name: string): boolean {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  return words.some((word) => ["msdm", "password", "passwords", "key", "keys"].includes(word));
}

// MARK: - Judging the bytes

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Kind */
export type RegionKind = "empty" | "text" | "data" | "code";

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.FoundString
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.FoundString.offset
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.FoundString.text
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.FoundString.utf16
 */
export interface FoundString {
  readonly offset: number;
  readonly text: string;
  readonly utf16: boolean;
}

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement.kind
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement.fill
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement.firstNonFill
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement.lastNonFill
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.Judgement.strings
 */
export interface Judgement {
  kind: RegionKind;
  fill: number;
  firstNonFill: number | undefined;
  lastNonFill: number | undefined;
  strings: FoundString[];
}

/** The share of fill below which an area is `empty`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.emptyFill */
export const EMPTY_FILL = 0.99;
/** The share of the non-fill bytes strings must make up for `text`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.textShare */
export const TEXT_SHARE = 0.5;
/** x86-64 markers per KiB of non-fill bytes from which an area is `code`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.codeMarkersPerKiB */
export const CODE_MARKERS_PER_KIB = 6;

/**
 * Judges `bytes`, which start at file address `base`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.judge
 */
export function judge(bytes: Uint8Array, base: number): Judgement {
  let fillCount = 0;
  let first: number | undefined;
  let last: number | undefined;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (byte === 0xff || byte === 0x00) {
      fillCount += 1;
    } else {
      first ??= index;
      last = index;
    }
  }
  const fill = bytes.length === 0 ? 1 : fillCount / bytes.length;
  const runs = stringsIn(bytes);
  const shown = runs.slice(0, 5).map((one) => ({
    offset: base + one.offset,
    text: one.text.slice(0, 64),
    utf16: one.utf16,
  }));
  const judgement: Judgement = {
    kind: "data",
    fill,
    firstNonFill: first === undefined ? undefined : base + first,
    lastNonFill: last === undefined ? undefined : base + last,
    strings: shown,
  };
  const other = bytes.length - fillCount;
  if (fill >= EMPTY_FILL || other === 0) {
    judgement.kind = "empty";
    return judgement;
  }
  // Text: the characters of the strings against every byte that is not fill. A UTF-16
  // character's zero byte is fill already.
  const inStrings = runs.reduce((sum, one) => sum + one.text.length, 0);
  if (inStrings / other >= TEXT_SHARE) judgement.kind = "text";
  else if (looksLikeCode(bytes, other)) judgement.kind = "code";
  return judgement;
}

/**
 * A PE image's `MZ`, or REX.W moves (48 89, 48 8B), stack adjustments (48 83 EC) and near calls
 * (E8) as often as compiled x86-64 has them — a random byte pair turns up once in 64 KiB, code
 * has dozens per KiB.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.looksLikeCode
 */
export function looksLikeCode(bytes: Uint8Array, nonFill: number): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (bytes.length <= 4 || nonFill < 256) return false;
  let markers = 0;
  for (let index = 0; index < bytes.length - 2; index++) {
    if (bytes[index] !== 0x48) continue;
    const next = bytes[index + 1];
    if (next === 0x89 || next === 0x8b || (next === 0x83 && bytes[index + 2] === 0xec)) {
      markers += 1;
    }
  }
  return markers / (nonFill / 1024) >= CODE_MARKERS_PER_KIB;
}

/**
 * Printable ASCII runs and UTF-16LE runs of four characters or more, in order of where they start.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentRegions.swift#UEFIAgentRegions.strings
 */
export function stringsIn(bytes: Uint8Array): FoundString[] {
  const printable = (byte: number | undefined): boolean =>
    byte !== undefined && byte >= 0x20 && byte < 0x7f;
  const found: FoundString[] = [];
  let index = 0;
  while (index < bytes.length) {
    // UTF-16LE first: its every other byte is zero, which would cut an ASCII run to one character.
    let units = 0;
    while (
      index + 2 * units + 1 < bytes.length &&
      printable(bytes[index + 2 * units]) &&
      bytes[index + 2 * units + 1] === 0
    ) {
      units += 1;
    }
    if (units >= 4) {
      let text = "";
      for (let unit = 0; unit < units; unit++)
        text += String.fromCharCode(bytes[index + 2 * unit] ?? 0);
      found.push({ offset: index, text, utf16: true });
      index += 2 * units;
      continue;
    }
    let length = 0;
    while (index + length < bytes.length && printable(bytes[index + length])) length += 1;
    if (length >= 4) {
      let text = "";
      for (let at = 0; at < length; at++) text += String.fromCharCode(bytes[index + at] ?? 0);
      found.push({ offset: index, text, utf16: false });
      index += length;
    } else {
      index += Math.max(1, length);
    }
  }
  return found;
}
