import { type MaskedPattern, scanPatterns } from "@/core/search/maskedSearch";
import { type ByteRange, SearchCancelled } from "@/core/search/searchEngine";
import { LenovoDMIDecodedBlock } from "@/firmware/lenovoDmi/lenovoDmiValue";
import type { LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";
import { type ByteSpace, FILE_SPACE, isFileSpace, sameSpace } from "@/firmware/uefi/byteSpace";
import { FLASH_REGIONS } from "@/firmware/uefi/descriptorParser";
import {
  type NodeID,
  nodeFileRange,
  nodeRange,
  ROOT_ID,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import { compressedView } from "@/tools/uefi/agent/uefiAgentNodeData";
import {
  type AgentTree,
  expanded,
  nodeAtPath,
  reachable,
  unknownNode,
} from "@/tools/uefi/agent/uefiAgentTree";
import { decodableBlock } from "@/tools/uefi/uefiLenovoDMIDetail";
import { decompressedBody } from "@/tools/uefi/uefiPresenter";

/**
 * A search through what a firmware's tree holds, not through the file as it is stored
 * (`Design/UEFI_STRUCTURE_TOOL.md`, "Searching the contents").
 *
 * The file keeps a driver inside a compressed section, and its text is not in the file's bytes for
 * a search of the dump to find. This search opens every container under the node it starts from,
 * reads every compressed section's decompressed bytes — and a BIOS Guard update's assembled region,
 * and a Lenovo LENV block stored XOR-encoded, decoded — and looks for the pattern in each, as well
 * as in the node's own bytes. Each match is placed in the tree: the deepest node that holds it
 * whole, and the volume that node is in. Bytes as they are stored behind a codec — a compressed
 * section's body, an encoded LENV block — are not searched: only what they decompress or decode
 * to. An ME region is left out altogether, its bytes and what is under it: it is another structure,
 * read by the ME tools.
 *
 * Not a step-by-step search: it runs to the end and hands back the list. The same search asked
 * again of the same bytes — the same tree, no edit since, the same node, the same patterns — is
 * answered with the last result, not run again.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch
 * @upstream-differs runs where the tree is, in the firmware worker: asynchronous so that a stop
 * can reach it between steps, and the tree's version is the content version the caller gives
 */

/**
 * One occurrence.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.init
 */
export interface ContentMatch {
  /** Which of the patterns matched. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.pattern */
  readonly pattern: number;
  /**
   * The bytes it is in: the file, or what a compressed section decompressed to.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.space
   */
  readonly space: ByteSpace;
  /** Where, in `space`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.range */
  readonly range: ByteRange;
  /**
   * The key, when the match is in a LENV block's decoded bytes — the file holds them XOR-encoded at
   * the same addresses.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.decodedXORKey
   */
  readonly decodedXORKey?: number | undefined;
  /**
   * The deepest node holding the match whole; nothing between the nodes of the top level.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.node
   */
  readonly node?: NodeID | undefined;
  /** The volume `node` is in, or is. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.volume */
  readonly volume?: NodeID | undefined;
  /**
   * From the volume's first byte, when the volume is in the same bytes as the match.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.volumeOffset
   */
  readonly volumeOffset?: number | undefined;
  /** From `node`'s first byte. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.nodeOffset */
  readonly nodeOffset?: number | undefined;
  /**
   * The innermost compressed section whose decompressed bytes hold the match; nothing for a match
   * in the file.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.section
   */
  readonly section?: NodeID | undefined;
  /**
   * The bytes around the match — `padding` either side where the bytes searched go that far — as
   * they were searched: decoded for a LENV block, decompressed in a compressed section.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.excerpt
   */
  readonly excerpt: Uint8Array;
  /** Where the match is in `excerpt`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.excerptMatch */
  readonly excerptMatch: ByteRange;
}

/**
 * The match as file addresses; nothing inside a compressed section.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Match.fileRange
 */
export const matchFileRange = (match: ContentMatch): ByteRange | undefined =>
  isFileSpace(match.space) ? match.range : undefined;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Result */
export interface ContentSearchResult {
  /** The first matches, in tree order. */
  readonly matches: readonly ContentMatch[];
  /** Every match, kept or not. */
  readonly total: number;
  /** How many bytes were searched, the decompressed ones included. */
  readonly searchedBytes: number;
  /** How many decompressed or decoded buffers were searched besides the node's own bytes. */
  readonly buffers: number;
  /** Compressed sections whose contents could not be read, and so were not searched. */
  readonly unreadSections: readonly NodeID[];
}

/**
 * What one pass of the scan reads: a stretch of one space, or of a LENV block decoded.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Scope
 */
interface Scope {
  readonly space: ByteSpace;
  readonly range: ByteRange;
  /** Decoded bytes standing in for the space's at `range`. */
  readonly decoded?: Uint8Array;
  readonly xorKey?: number;
  /** The node to place matches under; nothing for the top of the tree. */
  readonly base: NodeID | undefined;
  readonly section: NodeID | undefined;
  /** A stretch of the start's own bytes, not a buffer under it. */
  readonly isOwn: boolean;
}

/**
 * How many bytes an excerpt shows either side of a match by default.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.excerptPadding
 */
export const EXCERPT_PADDING = 8;

/** The most matches a search keeps; it goes on counting past them. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.defaultKeep */
export const DEFAULT_KEEP = 10_000;

/** How a search is asked: everything but the tree and the patterns. */
export interface ContentSearchOptions {
  /** The tree's version: an edit gives a new one, and a remembered answer is for one version only. */
  readonly generation: number;
  readonly overlapping?: boolean;
  readonly keep?: number;
  readonly padding?: number;
  /** How far the search is, from 0 to 1. */
  readonly progress?: (fraction: number) => void;
  /** Asked between steps; true stops the search with `SearchCancelled`. */
  readonly shouldCancel?: () => boolean;
  /** Gives the worker's loop a turn, so a stop sent while the search runs reaches it. */
  readonly pause?: () => Promise<void>;
}

/** What the last search was asked, and what it answered. @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Asked */
interface Asked {
  readonly tree: WeakRef<AgentTree>;
  readonly generation: number;
  readonly start: string;
  readonly patterns: string;
  readonly overlapping: boolean;
  readonly keep: number;
  readonly padding: number;
  readonly result: ContentSearchResult;
}

let last: Asked | undefined;

const patternsKey = (patterns: readonly MaskedPattern[]): string => JSON.stringify(patterns);

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.Asked.answers */
function answers(
  asked: Asked | undefined,
  tree: AgentTree,
  start: NodeID,
  patterns: readonly MaskedPattern[],
  options: ContentSearchOptions
): asked is Asked {
  return (
    asked !== undefined &&
    asked.tree.deref() === tree &&
    asked.generation === options.generation &&
    asked.start === start.join(".") &&
    asked.patterns === patternsKey(patterns) &&
    asked.overlapping === (options.overlapping ?? false) &&
    asked.keep >= (options.keep ?? DEFAULT_KEEP) &&
    asked.padding === (options.padding ?? EXCERPT_PADDING)
  );
}

/**
 * Whether a search of these is answered from the last one, without reading anything — for a test.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.isRemembered
 */
export function isRemembered(
  patterns: readonly MaskedPattern[],
  start: NodeID,
  tree: AgentTree,
  options: ContentSearchOptions
): boolean {
  return answers(last, tree, start, patterns, options);
}

const ME_REGION = FLASH_REGIONS.indexOf("me");

/**
 * Whether `node` is an ME region, which the search leaves out.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.isMERegion
 */
export const isMERegion = (node: UEFINode): boolean =>
  node.kind === "region" && node.subtype === ME_REGION;

/**
 * Searches `start` — the whole image for the root — for `patterns`. `progress` hears how far the
 * search is, from 0 to 1: the first half while the branches are opened, by where in the bytes the
 * branch being opened is; the second by the share of the bytes searched. Throws `SearchCancelled`
 * when `shouldCancel` says so.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.run
 */
export async function runContentSearch(
  patterns: readonly MaskedPattern[],
  start: NodeID,
  tree: AgentTree,
  options: ContentSearchOptions
): Promise<ContentSearchResult> {
  const keep = options.keep ?? DEFAULT_KEEP;
  const padding = options.padding ?? EXCERPT_PADDING;
  const overlapping = options.overlapping ?? false;
  const progress = options.progress ?? (() => undefined);
  const cancelled = () => options.shouldCancel?.() === true;
  const pause = options.pause ?? (async () => undefined);
  if (answers(last, tree, start, patterns, options)) {
    progress(1);
    return { ...last.result, matches: last.result.matches.slice(0, keep) };
  }
  let top: UEFINode | undefined;
  if (start.length > 0) {
    reachable(tree, start);
    top = nodeAtPath(tree, start);
    if (top === undefined) throw unknownNode(start);
  }
  let reached = 0;
  await openEverythingUnder(top, tree, {
    progress: (share) => {
      if (share <= reached) return;
      reached = share;
      progress(share / 2);
    },
    shouldCancel: cancelled,
    pause,
  });
  if (cancelled()) throw new SearchCancelled();
  const { scopes, unread } = scopesFrom(top, tree);

  const total = scopes.reduce((sum, one) => sum + (one.range.end - one.range.start), 0);
  const found: {
    scope: number;
    pattern: number;
    range: ByteRange;
    excerpt: Uint8Array;
    at: ByteRange;
  }[] = [];
  let count = 0;
  let done = 0;
  for (const [index, scope] of scopes.entries()) {
    await pause();
    if (cancelled()) throw new SearchCancelled();
    let read: (offset: number, length: number) => Uint8Array;
    if (scope.decoded !== undefined) {
      const decoded = scope.decoded;
      const base = scope.range.start;
      read = (offset, length) =>
        decoded.subarray(offset - base, Math.min(decoded.length, offset - base + length));
    } else {
      const reader = tree.spaceReaders.readerFor(scope.space);
      if (reader === undefined) continue;
      read = (offset, length) =>
        reader.bytes({ start: offset, end: Math.min(reader.count, offset + length) }) ??
        new Uint8Array(0);
    }
    scanPatterns(
      patterns,
      scope.range.end,
      read,
      (range, pattern) => {
        count += 1;
        // Gathered past `keep` while the order is not yet known: the tree's order is decided once
        // every buffer is in.
        if (found.length < Math.max(keep * 4, 250_000)) {
          const from = Math.max(
            scope.range.start,
            range.start >= padding ? range.start - padding : 0
          );
          const to = Math.min(scope.range.end, range.end + padding);
          const excerpt = Uint8Array.from(read(from, to - from));
          found.push({
            scope: index,
            pattern,
            range,
            excerpt,
            at: { start: range.start - from, end: range.end - from },
          });
        }
        return true;
      },
      { range: scope.range, overlapping, shouldCancel: cancelled }
    );
    done += scope.range.end - scope.range.start;
    if (total > 0) progress(0.5 + done / total / 2);
  }

  const matches = found.map((one) => {
    const scope = scopes[one.scope] as Scope;
    return {
      ...placeMatch(one.range, one.pattern, scope, tree),
      excerpt: one.excerpt,
      excerptMatch: one.at,
    };
  });
  matches.sort(treeOrder);
  const result: ContentSearchResult = {
    matches: matches.slice(0, keep),
    total: count,
    searchedBytes: total,
    buffers: new Set(
      scopes
        .filter((one) => !one.isOwn && one.base !== undefined)
        .map((one) => (one.base as NodeID).join("."))
    ).size,
    unreadSections: unread,
  };
  last = {
    tree: new WeakRef(tree),
    generation: options.generation,
    start: start.join("."),
    patterns: patternsKey(patterns),
    overlapping,
    keep,
    padding,
    result,
  };
  return result;
}

// MARK: - What is searched

/**
 * Opens every closed container at or under `node` — the whole tree for nothing — depth first, so
 * the place in the file of the branch being opened only moves on: `progress` hears it as a share of
 * the node's bytes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.openEverything
 */
export async function openEverythingUnder(
  node: UEFINode | undefined,
  tree: AgentTree,
  options: {
    readonly progress?: (share: number) => void;
    readonly shouldCancel?: () => boolean;
    readonly pause?: () => Promise<void>;
  } = {}
): Promise<void> {
  const span = (node === undefined
    ? undefined
    : (nodeFileRange(node) ?? fileRangeOf(node, tree))) ?? {
    start: 0,
    end: Math.max(1, tree.size),
  };
  const stack = [...(node === undefined ? tree.roots : [node])].reverse();
  let since = Date.now();
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (options.shouldCancel?.() === true) return;
    // A turn for the worker's loop now and then: opening a large image takes seconds.
    if (options.pause !== undefined && Date.now() - since > 50) {
      await options.pause();
      since = Date.now();
    }
    if (isMERegion(next)) continue;
    if (next.isExpandable) {
      const at = fileRangeOf(next, tree)?.start;
      if (at !== undefined && span.end > span.start) {
        const inside = Math.min(Math.max(at, span.start), span.end);
        options.progress?.((inside - span.start) / (span.end - span.start));
      }
    }
    const children = next.isExpandable ? expanded(tree, next.id) : next.children;
    stack.push(...[...children].reverse());
  }
  options.progress?.(1);
}

/**
 * Where `node`'s bytes are in the file: its own range, or for a node in decompressed bytes the
 * compressed section's they came out of.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.fileRange
 */
export function fileRangeOf(node: UEFINode | undefined, tree: AgentTree): ByteRange | undefined {
  if (node === undefined) return undefined;
  const own = nodeFileRange(node);
  if (own !== undefined) return own;
  const path = [...node.id];
  while (path.length > 0) {
    path.pop();
    const above = nodeAtPath(tree, path);
    const range = above === undefined ? undefined : nodeFileRange(above);
    if (range !== undefined) return range;
  }
  return undefined;
}

/**
 * The stretches to scan: the start's own bytes, then every buffer under it in tree order — and the
 * compressed sections that would not open.
 *
 * Bytes nothing can be found in as they are stored are cut out of every stretch: a compressed
 * section's body, which is searched in what it decompresses to; a LENV block stored encoded,
 * searched decoded; and an ME region, left out altogether.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.scopes
 */
function scopesFrom(
  top: UEFINode | undefined,
  tree: AgentTree
): { scopes: Scope[]; unread: NodeID[] } {
  const scopes: Scope[] = [];
  const unread: NodeID[] = [];
  const fileReader = tree.spaceReaders.readerFor(FILE_SPACE);
  const image = tree.image();

  const encodedBlock = (node: UEFINode): LENVBlock | undefined => {
    if (node.kind !== "lenvBlock" || fileReader === undefined) return undefined;
    const found = decodableBlock(node, image, fileReader);
    return found?.block.encoding === "encoded" ? found.block : undefined;
  };
  const bodyOf = (node: UEFINode) => decompressedBody(compressedView(node));
  /** The bytes of `node` not to scan as they are stored. */
  const opaque = (node: UEFINode): ByteRange | undefined => {
    if (isMERegion(node)) return nodeRange(node);
    if (bodyOf(node) !== undefined) return node.body;
    if (encodedBlock(node) !== undefined) return nodeRange(node);
    return undefined;
  };
  /** `range` of `space`, less what the nodes in it keep opaque. */
  const stretches = (
    range: ByteRange,
    space: ByteSpace,
    under: readonly UEFINode[]
  ): ByteRange[] => {
    const cuts: ByteRange[] = [];
    const gather = (nodes: readonly UEFINode[]) => {
      for (const node of nodes) {
        if (!sameSpace(node.space, space)) continue;
        const cut = opaque(node);
        if (cut !== undefined) cuts.push(cut);
        else gather(node.children);
      }
    };
    gather(under);
    cuts.sort((a, b) => a.start - b.start);
    const result: ByteRange[] = [];
    let from = range.start;
    for (const cut of [...cuts, { start: range.end, end: range.end }]) {
      const to = Math.min(Math.max(cut.start, from), range.end);
      if (to > from) result.push({ start: from, end: to });
      from = Math.max(from, Math.min(cut.end, range.end));
    }
    return result;
  };

  if (top !== undefined && isMERegion(top)) return { scopes: [], unread: [] };
  const space = top?.space ?? FILE_SPACE;
  const section = top === undefined ? undefined : enclosingSection(top, tree);
  const whole = top === undefined ? { start: 0, end: tree.reader.count } : nodeRange(top);
  for (const stretch of stretches(whole, space, top === undefined ? tree.roots : [top])) {
    scopes.push({ space, range: stretch, base: top?.id, section, isOwn: true });
  }
  const visit = (node: UEFINode) => {
    if (isMERegion(node)) return;
    const body = bodyOf(node);
    if (body !== undefined) {
      const reader = tree.spaceReaders.readerFor(body.space);
      if (reader !== undefined && reader.count > 0) {
        const inside = node.children.filter((child) => sameSpace(child.space, body.space));
        for (const stretch of stretches({ start: 0, end: reader.count }, body.space, inside)) {
          scopes.push({
            space: body.space,
            range: stretch,
            base: node.id,
            section: node.id,
            isOwn: false,
          });
        }
      } else {
        unread.push(node.id);
      }
    }
    const block = encodedBlock(node);
    if (block !== undefined) {
      scopes.push({
        space: FILE_SPACE,
        range: nodeRange(node),
        decoded: LenovoDMIDecodedBlock.decode(block),
        xorKey: block.xorKey,
        base: node.id,
        section: undefined,
        isOwn: false,
      });
    }
    for (const child of node.children) visit(child);
  };
  if (top !== undefined) visit(top);
  else for (const root of tree.roots) visit(root);
  return { scopes, unread };
}

/**
 * The innermost compressed section above `node`, for a node whose bytes are decompressed ones.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.enclosingSection
 */
export function enclosingSection(node: UEFINode, tree: AgentTree): NodeID | undefined {
  if (isFileSpace(node.space)) return undefined;
  const path = [...node.id];
  while (path.length > 0) {
    path.pop();
    const above = nodeAtPath(tree, path);
    const body = above === undefined ? undefined : decompressedBody(compressedView(above));
    if (above !== undefined && body !== undefined && sameSpace(body.space, node.space)) {
      return above.id;
    }
  }
  return undefined;
}

// MARK: - Where a match is

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.place */
function placeMatch(
  range: ByteRange,
  pattern: number,
  scope: Scope,
  tree: AgentTree
): Omit<ContentMatch, "excerpt" | "excerptMatch"> {
  const match: {
    pattern: number;
    space: ByteSpace;
    range: ByteRange;
    decodedXORKey?: number;
    node?: NodeID;
    volume?: NodeID;
    volumeOffset?: number;
    nodeOffset?: number;
    section?: NodeID;
  } = { pattern, space: scope.space, range };
  if (scope.xorKey !== undefined) match.decodedXORKey = scope.xorKey;
  if (scope.section !== undefined) match.section = scope.section;
  // Down from the scope's node through the children in the match's bytes — for a compressed
  // section, the children its buffer holds.
  let current = scope.base === undefined ? undefined : nodeAtPath(tree, scope.base);
  let children: readonly UEFINode[] = current?.children ?? tree.roots;
  for (;;) {
    const child = children.find((one) => {
      const own = nodeRange(one);
      return (
        sameSpace(one.space, scope.space) &&
        own.end > own.start &&
        own.start <= range.start &&
        range.end <= own.end
      );
    });
    if (child === undefined) break;
    current = child;
    children = child.children;
  }
  if (current === undefined) return match;
  match.node = current.id;
  if (sameSpace(current.space, scope.space))
    match.nodeOffset = range.start - nodeRange(current).start;
  const path = [...current.id];
  while (path.length > 0) {
    const above = nodeAtPath(tree, path);
    if (above?.kind === "volume") {
      match.volume = above.id;
      const own = nodeRange(above);
      if (sameSpace(above.space, scope.space) && own.start <= range.start) {
        match.volumeOffset = range.start - own.start;
      }
      break;
    }
    path.pop();
  }
  return match;
}

/**
 * The tree's order: by the node, outermost index first, and in one node by where the match is.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.treeOrder
 */
export function treeOrder(a: ContentMatch, b: ContentMatch): number {
  const left = a.node ?? ROOT_ID;
  const right = b.node ?? ROOT_ID;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.length !== right.length) return left.length - right.length;
  if (a.range.start !== b.range.start) return a.range.start - b.range.start;
  return a.pattern - b.pattern;
}
