import { type FindEncoding, fromWire, previewJson, type WirePattern } from "@/core/agent/agentFind";
import type { Json } from "@/core/agent/json";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import type { ImageReader } from "@/firmware/imageReader";
import { nodeIdText, ROOT_ID } from "@/firmware/uefi/uefiNode";
import { hexText, nodeLabel, nodeSummary } from "@/tools/uefi/agent/uefiAgentQueries";
import { isSecret } from "@/tools/uefi/agent/uefiAgentRegions";
import { type AgentTree, nodeAtPath, parseNodeId } from "@/tools/uefi/agent/uefiAgentTree";
import {
  type ContentMatch,
  matchFileRange,
  runContentSearch,
} from "@/tools/uefi/uefiContentSearch";

/**
 * `find_bytes` with a node: the tree's Contents search, run where the tree is.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.find
 * @upstream-differs the tree is in the worker, so the search runs there
 */

/**
 * A buffer the tree holds as the storage the search engine reads.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage.reader
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage.size
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage.read
 */
export class ReaderStorage implements ByteStorage {
  private readonly reader: ImageReader;

  constructor(reader: ImageReader) {
    this.reader = reader;
  }

  get size(): number {
    return this.reader.count;
  }

  async read(at: number, length: number): Promise<Bytes> {
    return this.peek(at, length) ?? new Uint8Array(0);
  }

  peek(at: number, length: number): Bytes | undefined {
    if (at >= this.size || length <= 0) return new Uint8Array(0);
    const bytes = this.reader.bytes({ start: at, end: Math.min(this.size, at + length) });
    return bytes === undefined ? undefined : bytes.slice();
  }

  async prefetch(): Promise<void> {}
}

export interface FindInNodeParams {
  readonly node: string;
  readonly patterns: readonly WirePattern[];
  readonly overlapping: boolean;
  readonly context: number;
  readonly first: number;
  readonly limit: number;
}

/**
 * `find_bytes` with `node`: what the UEFI tree holds at and under it, decompressed and decoded
 * (`runContentSearch`, the UEFI panel's Contents search), each match placed at its node and in its
 * volume.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.findInTree
 * @upstream-differs runs in the worker that holds the tree, so the envelope and the page are made
 * there and handed back to the tool
 */
export async function findInNode(
  tree: AgentTree,
  params: FindInNodeParams,
  generation: number
): Promise<Json> {
  const start = params.node === "root" ? ROOT_ID : parseNodeId(params.node);
  const wanted = params.patterns.map(fromWire);
  const result = await runContentSearch(
    wanted.map((one) => one.pattern),
    start,
    tree,
    {
      generation,
      overlapping: params.overlapping,
      keep: params.first + params.limit,
      padding: params.context,
    }
  );
  const envelope: { [key: string]: Json } = {
    total: result.total,
    searched: hexText(result.searchedBytes),
    buffers: result.buffers,
  };
  const top = start.length === 0 ? undefined : nodeAtPath(tree, start);
  envelope.node = top === undefined ? "root" : nodeSummary(tree, top);
  if (result.unreadSections.length > 0) envelope.unread = result.unreadSections.map(nodeIdText);
  if (result.matches.length < Math.min(result.total, params.first + params.limit)) {
    envelope.note =
      "Too many matches to place them all in tree order; these are the first " +
      `${result.matches.length}. Search from a deeper \`node\` to narrow it.`;
  }
  const items: Json[] = result.matches
    .slice(params.first, params.first + params.limit)
    .map((match) => {
      const encoding: FindEncoding = wanted[match.pattern]?.encoding ?? "hex";
      const members = contentMatchEntry(match, encoding, tree);
      if (params.context <= 0) return members;
      // An area the flash map names for a secret gives its matches but not the bytes around them.
      const node = match.node === undefined ? undefined : nodeAtPath(tree, match.node);
      if (node !== undefined && isSecret(node, tree)) return { ...members, redacted: true };
      return {
        ...members,
        preview: previewJson(match.excerpt, encoding, match.excerptMatch.start),
      };
    });
  return { envelope, total: result.total, items };
}

/**
 * One match as an agent reads it: `node` (as `uefi_tree` gives it) and `node_offset`, `volume` and
 * `volume_offset`, `start`/`end` in the file — or `in_compressed`, `buffer_start`/`buffer_end` and
 * the `section` whose decompressed bytes hold it — and `decoded` for a LENV block decoded.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentContentSearch.swift#UEFIAgentContentSearch.entry
 */
export function contentMatchEntry(
  match: ContentMatch,
  encoding: FindEncoding,
  tree: AgentTree
): { [key: string]: Json } {
  const members: { [key: string]: Json } = { encoding };
  const node = match.node === undefined ? undefined : nodeAtPath(tree, match.node);
  if (node !== undefined) members.node = nodeSummary(tree, node);
  if (match.nodeOffset !== undefined) members.node_offset = hexText(match.nodeOffset);
  const volume = match.volume === undefined ? undefined : nodeAtPath(tree, match.volume);
  if (volume !== undefined) {
    members.volume = { id: nodeIdText(volume.id), label: nodeLabel(volume, tree) };
  }
  if (match.volumeOffset !== undefined) members.volume_offset = hexText(match.volumeOffset);
  const range = matchFileRange(match);
  if (range !== undefined) {
    members.start = hexText(range.start);
    members.end = hexText(range.end);
  } else {
    members.in_compressed = true;
    members.buffer_start = hexText(match.range.start);
    members.buffer_end = hexText(match.range.end);
  }
  if (match.section !== undefined) members.section = nodeIdText(match.section);
  if (match.decodedXORKey !== undefined) {
    members.decoded = `XOR ${match.decodedXORKey.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return members;
}
