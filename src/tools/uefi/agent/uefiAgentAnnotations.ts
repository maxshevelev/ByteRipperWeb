import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { type ByteSpace, isFileSpace, sameSpace } from "@/firmware/uefi/byteSpace";
import {
  type NodeID,
  nodeFileRange,
  nodeIdText,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import { compressedView, nodeBytes } from "@/tools/uefi/agent/uefiAgentNodeData";
import { hexText } from "@/tools/uefi/agent/uefiAgentQueries";
import { type AgentTree, nodeAtPath, parseNodeId } from "@/tools/uefi/agent/uefiAgentTree";
import { decodableBlock } from "@/tools/uefi/uefiLenovoDMIDetail";
import { decompressedBody } from "@/tools/uefi/uefiPresenter";
import { ownName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Where an annotation's place is, read off the file's tree where the tree is — the firmware worker:
 * a node's bytes in the file, or in the decompressed or decoded bytes it lives in, with the codecs
 * they came through; what the place is called on screen; and a place of the file inside a LENV
 * block stored encoded, read decoded.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools
 * @upstream-differs the tree is the worker's, so the parts of the annotation that read it are
 * questions asked of it here
 */

/**
 * A place in bytes that are not the file's own, as a fragment panel opens them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded
 */
export interface WireDecoded {
  /** The node the panel is opened from: the compressed section, or the LENV block. */
  readonly holder: string;
  /** What the panel is linked to in the file. */
  readonly source: readonly [number, number];
  /** The buffer the panel shows; nothing for a LENV block, whose bytes are the block's own. */
  readonly space: ByteSpace | undefined;
  /** In the panel's own addresses. */
  readonly range: readonly [number, number];
  /** The codecs' badges, outermost first: `LZMA`, `XOR C0`. Nothing for the generic word. */
  readonly codecs: readonly (string | undefined)[];
  readonly xorKey: number | undefined;
}

/** What the place is called on screen: the node after its parent, and its id. */
export interface WireSite {
  readonly label: string;
  readonly node: string;
}

/** Names that say what a node is rather than which one. */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "unused",
  "unknown",
  "padding",
  "empty padding",
  "free space",
  "non-uefi data",
  "raw",
]);

/**
 * The node after its parent — `VSS store: SetupMode` — unless the parent is called only by a word
 * for the bytes it covers.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.nameAfterParent
 * @upstream-differs the parser's names, the GUID catalogue being the page's
 */
export function nameAfterParent(tree: AgentTree, id: NodeID): string | undefined {
  const node = nodeAtPath(tree, id);
  if (node === undefined) return undefined;
  const own = ownName(node) ?? node.name;
  if (id.length < 2) return own;
  const parent = nodeAtPath(tree, id.slice(0, -1));
  if (parent === undefined) return own;
  const above = ownName(parent) ?? parent.name;
  return PLACEHOLDERS.has(above.toLowerCase()) ? own : `${above}: ${own}`;
}

const opensIntoBuffer = (node: UEFINode): boolean =>
  decompressedBody(compressedView(node)) !== undefined;

/**
 * The node whose decompressed body the buffer `space` is — the innermost compressed section on its
 * chain. Nothing for the file.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.holder
 */
export function holderOf(space: ByteSpace, tree: AgentTree): UEFINode | undefined {
  const last = space[space.length - 1];
  if (last === undefined) return undefined;
  const parent = space.slice(0, -1);
  return tree
    .image()
    .allNodes.find(
      (node) => sameSpace(node.space, parent) && node.header.start === last && opensIntoBuffer(node)
    );
}

/**
 * The codecs the bytes of `space` came through, outermost first: each compressed section's
 * algorithm, "BIOS Guard" for an assembled region, nothing where the section says none.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.codecTexts
 */
export function codecsOf(space: ByteSpace, tree: AgentTree): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  for (let length = 1; length <= space.length; length++) {
    const holder = holderOf(space.slice(0, length), tree);
    names.push(holder?.kind === "biosGuardUpdate" ? "BIOS Guard" : holder?.compression?.algorithm);
  }
  return names;
}

/**
 * Where a node's bytes are held in the file: its own range, or the outermost section's.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.fileSource
 */
function fileSourceOf(node: UEFINode, tree: AgentTree): readonly [number, number] | undefined {
  const own = nodeFileRange(node);
  if (own !== undefined) return [own.start, own.end];
  const outermost = node.space[0];
  if (outermost === undefined) return undefined;
  const section = tree
    .image()
    .allNodes.find((one) => isFileSpace(one.space) && one.header.start === outermost);
  const range = section === undefined ? undefined : nodeFileRange(section);
  return range === undefined ? undefined : [range.start, range.end];
}

const xorBadge = (key: number) => `XOR ${key.toString(16).toUpperCase().padStart(2, "0")}`;

/**
 * Where node `text` of the tree is — or the stretch `within` of its bytes, from its first: in the
 * file, or, for a node inside a compressed section, in what the section decompresses to. A node of
 * a LENV block that is stored encoded is in the file and also decoded.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.nodePlace
 */
export function nodePlace(
  tree: AgentTree,
  text: string,
  within: readonly [number, number] | undefined
): { range: readonly [number, number] | undefined; decoded: WireDecoded | undefined } {
  const found = nodeBytes(tree, text, "all");
  let range: readonly [number, number] = [found.range.start, found.range.end];
  if (within !== undefined) {
    const size = found.range.end - found.range.start;
    if (within[1] > size) {
      throw new AgentToolError(
        `${hexText(within[0])}–${hexText(within[1])} runs past the end of node ${text}, which is ${hexText(size)} bytes long.`
      );
    }
    range = [found.range.start + within[0], found.range.start + within[1]];
  }
  if (!isFileSpace(found.space)) {
    const holder = holderOf(found.space, tree);
    const source = holder === undefined ? undefined : fileSourceOf(holder, tree);
    if (holder === undefined || source === undefined) {
      throw new AgentToolError(`Node ${text} has no place in the file to annotate.`);
    }
    return {
      range: undefined,
      decoded: {
        holder: nodeIdText(holder.id),
        source,
        space: found.space,
        range,
        codecs: codecsOf(found.space, tree),
        xorKey: undefined,
      },
    };
  }
  const reader = tree.spaceReaders.readerFor(found.space);
  const block = reader === undefined ? undefined : decodableBlock(found.node, tree.image(), reader);
  if (block === undefined || block.block.encoding !== "encoded")
    return { range, decoded: undefined };
  const source = block.block.range;
  return {
    range,
    decoded: {
      holder: text,
      source,
      space: undefined,
      range: [range[0] - source[0], range[1] - source[0]],
      codecs: [xorBadge(block.block.xorKey)],
      xorKey: block.block.xorKey,
    },
  };
}

/** Opens every closed container at or under `node`. */
function openAllUnder(node: UEFINode | undefined, tree: AgentTree): void {
  const stack = [...(node === undefined ? tree.roots : [node])];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next.isExpandable) tree.open(next);
    stack.push(...next.children);
  }
}

/** The deepest node of the file holding `range` whole, opening the branches on the way. */
function deepestHolding(tree: AgentTree, range: readonly [number, number]): UEFINode[] {
  const chain: UEFINode[] = [];
  let nodes: readonly UEFINode[] = tree.roots;
  for (;;) {
    const next = nodes.find((node) => {
      const own = nodeFileRange(node);
      return (
        own !== undefined && own.start <= range[0] && range[1] <= own.end && own.end > own.start
      );
    });
    if (next === undefined) break;
    chain.push(next);
    if (next.isExpandable && !(next.kind === "section" && opensIntoBuffer(next))) tree.open(next);
    nodes = next.children.filter((child) => isFileSpace(child.space));
  }
  return chain;
}

/**
 * The place `range` of the file is in a LENV block stored encoded: the block decoded, at the
 * deepest node holding the range.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.encodedPlace
 */
export function encodedPlace(
  tree: AgentTree,
  range: readonly [number, number]
): WireDecoded | undefined {
  const reader = tree.spaceReaders.readerFor([]);
  if (reader === undefined) return undefined;
  const chain = deepestHolding(tree, range);
  const deepest = chain[chain.length - 1];
  if (deepest === undefined) return undefined;
  for (const node of [...chain].reverse()) {
    const found = decodableBlock(node, tree.image(), reader);
    if (found === undefined) continue;
    const block = found.block;
    const source = block.range;
    if (block.encoding !== "encoded" || source[0] > range[0] || range[1] > source[1]) {
      return undefined;
    }
    return {
      holder: nodeIdText(deepest.id),
      source,
      space: undefined,
      range: [range[0] - source[0], range[1] - source[0]],
      codecs: [xorBadge(block.xorKey)],
      xorKey: block.xorKey,
    };
  }
  return undefined;
}

/**
 * What the place is called on screen: the node given — or the deepest node holding the place, in
 * the file or in the decompressed bytes it is in — after its parent. Nothing for a file the tree
 * reads as nothing but padding.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.site
 */
export function siteOf(
  tree: AgentTree,
  place: {
    readonly node?: string | undefined;
    readonly range?: readonly [number, number] | undefined;
    readonly decoded?: WireDecoded | undefined;
  }
): WireSite | undefined {
  if (!tree.roots.some((root) => root.kind !== "padding")) return undefined;
  let id: NodeID | undefined;
  if (place.node !== undefined) {
    id = parseNodeId(place.node);
  } else if (place.decoded?.space !== undefined) {
    const decoded = place.decoded;
    const space = decoded.space as ByteSpace;
    const holder = nodeAtPath(tree, parseNodeId(decoded.holder));
    openAllUnder(holder, tree);
    let best: UEFINode | undefined;
    for (const node of tree.image().allNodes) {
      if (!sameSpace(node.space, space)) continue;
      const own = nodeRange(node);
      if (own.start <= decoded.range[0] && decoded.range[1] <= own.end) {
        if (best === undefined || node.id.length > best.id.length) best = node;
      }
    }
    id = best?.id;
  } else if (place.range !== undefined) {
    id = deepestHolding(tree, place.range).at(-1)?.id;
  }
  if (id === undefined) return undefined;
  const label = nameAfterParent(tree, id);
  return label === undefined ? undefined : { label, node: nodeIdText(id) };
}

/**
 * The place `range` of a part is in its own bytes, when the part is a compressed section's body
 * opened from the file — the holder and the codecs of `space`.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.partPlace
 */
export function spacePlace(
  tree: AgentTree,
  space: ByteSpace
): { holder: string; codecs: (string | undefined)[] } | undefined {
  const holder = holderOf(space, tree);
  if (holder === undefined) return undefined;
  return { holder: nodeIdText(holder.id), codecs: codecsOf(space, tree) };
}

/** The LENV block's node at `source` of the file, for a part that is the block decoded. */
export function blockAt(tree: AgentTree, source: readonly [number, number]): string | undefined {
  const chain = deepestHolding(tree, source);
  const block = [...chain].reverse().find((node) => {
    const own = nodeFileRange(node);
    return own !== undefined && own.start === source[0] && own.end === source[1];
  });
  return block === undefined ? undefined : nodeIdText(block.id);
}

/**
 * The questions the annotations ask of the tree, as one worker query: `nodePlace`, `encodedPlace`,
 * `site`, `spacePlace`, `blockAt`.
 */
export function annotationQuery(tree: AgentTree, values: { readonly [key: string]: Json }): Json {
  const ask = values.ask;
  const pair = (value: Json | undefined): readonly [number, number] | undefined =>
    Array.isArray(value) ? [Number(value[0]), Number(value[1])] : undefined;
  switch (ask) {
    case "nodePlace": {
      const found = nodePlace(tree, String(values.node), pair(values.within));
      const site = siteOf(tree, { node: String(values.node) });
      return { ...wire(found), site: site === undefined ? null : { ...site } };
    }
    case "encodedPlace": {
      const range = pair(values.range);
      const found = range === undefined ? undefined : encodedPlace(tree, range);
      return found === undefined ? null : wireDecoded(found);
    }
    case "site": {
      const decoded = values.decoded as unknown as WireDecoded | null | undefined;
      const site = siteOf(tree, {
        node: typeof values.node === "string" ? values.node : undefined,
        range: pair(values.range),
        decoded: decoded ?? undefined,
      });
      return site === undefined ? null : { ...site };
    }
    case "spacePlace": {
      const found = spacePlace(tree, (values.space as number[] | undefined) ?? []);
      return found === undefined
        ? null
        : { holder: found.holder, codecs: found.codecs.map((one) => one ?? null) };
    }
    case "blockAt": {
      const source = pair(values.source);
      return source === undefined ? null : (blockAt(tree, source) ?? null);
    }
    default:
      throw new AgentToolError(`No annotation question ${String(ask)}.`);
  }
}

function wireDecoded(decoded: WireDecoded): Json {
  return {
    holder: decoded.holder,
    source: [...decoded.source],
    space: decoded.space === undefined ? null : [...decoded.space],
    range: [...decoded.range],
    codecs: decoded.codecs.map((one) => one ?? null),
    xorKey: decoded.xorKey ?? null,
  };
}

function wire(found: {
  range: readonly [number, number] | undefined;
  decoded: WireDecoded | undefined;
}): { [key: string]: Json } {
  return {
    range: found.range === undefined ? null : [...found.range],
    decoded: found.decoded === undefined ? null : wireDecoded(found.decoded),
  };
}

/** A decoded place as it comes back over the wire. */
export function decodedFromWire(json: Json): WireDecoded | undefined {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return undefined;
  const value = json as { [key: string]: Json };
  const pair = (one: Json | undefined): readonly [number, number] =>
    Array.isArray(one) ? [Number(one[0]), Number(one[1])] : [0, 0];
  return {
    holder: String(value.holder),
    source: pair(value.source),
    space: Array.isArray(value.space) ? value.space.map(Number) : undefined,
    range: pair(value.range),
    codecs: Array.isArray(value.codecs)
      ? value.codecs.map((one) => (typeof one === "string" ? one : undefined))
      : [],
    xorKey: typeof value.xorKey === "number" ? value.xorKey : undefined,
  };
}
