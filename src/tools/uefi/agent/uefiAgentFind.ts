import { type FindEncoding, fromWire, previewJson, type WirePattern } from "@/core/agent/agentFind";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { maskedMatches } from "@/core/search/maskedSearch";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import type { ImageReader } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { nodeIdText } from "@/firmware/uefi/uefiNode";
import { placesJson } from "@/tools/uefi/agent/uefiAgentLocator";
import {
  compressedView,
  deepestCovering,
  nodeBytes,
  sectionSource,
} from "@/tools/uefi/agent/uefiAgentNodeData";
import { hexText } from "@/tools/uefi/agent/uefiAgentQueries";
import type { AgentTree } from "@/tools/uefi/agent/uefiAgentTree";
import { decompressedBody } from "@/tools/uefi/uefiPresenter";
import { ownName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * `find_bytes` inside one UEFI node: the node's bytes — in the file, or in the buffer its compressed
 * section opened to — searched where the tree holds them.
 *
 * A compressed section is searched in what it decompresses to: its own bytes are compressed, and
 * nothing in them reads as text.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.find
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage
 * @upstream-differs the node's bytes are in the worker that holds the tree, so the search runs there
 */

/** A buffer the tree holds as the storage the search engine reads. @upstream ByteRipperApp/Agent/AgentFindTools.swift#ReaderStorage */
class ReaderStorage implements ByteStorage {
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
  readonly offset: number | undefined;
  readonly end: number | undefined;
  readonly patterns: readonly WirePattern[];
  readonly overlapping: boolean;
  readonly context: number;
  readonly first: number;
  readonly limit: number;
}

export async function findInNode(tree: AgentTree, params: FindInNodeParams): Promise<Json> {
  // A compressed section is searched in what it decompresses to.
  const whole = nodeBytes(tree, params.node, "all");
  const decompressed = decompressedBody(compressedView(whole.node)) !== undefined;
  const found = decompressed ? nodeBytes(tree, params.node, "decompressed") : whole;
  const inCompressed = !isFileSpace(found.space);
  const storage = new ReaderStorage(found.reader);
  const scope = found.range;
  const size = scope.end - scope.start;
  const envelope: { [key: string]: Json } = {
    node: nodeIdText(found.node.id),
    node_size: hexText(size),
    in_compressed: inCompressed,
  };
  if (decompressed) envelope.decompressed = true;
  const source = sectionSource(tree, found.node, decompressed);
  if (source !== undefined) envelope.source = source;

  // `offset` and `end` count from the node's start.
  const offset = params.offset ?? 0;
  const end = params.end ?? size;
  if (!(offset < end && end <= size)) {
    throw new AgentToolError(
      `The range ${hexText(offset)}–${hexText(end)} is not inside the node, which is ${hexText(size)} bytes long.`
    );
  }
  const range = { start: scope.start + offset, end: scope.start + end };
  const wanted = params.patterns.map(fromWire);
  if (wanted.every((one) => one.pattern.bytes.length > range.end - range.start)) {
    throw new AgentToolError("The pattern is longer than the range searched.");
  }
  let total = 0;
  const page: { start: number; end: number; pattern: number }[] = [];
  await maskedMatches(
    wanted.map((one) => one.pattern),
    storage,
    (match, pattern) => {
      if (total >= params.first && page.length < params.limit) {
        page.push({ start: match.start, end: match.end, pattern });
      }
      total += 1;
      return true;
    },
    { range, overlapping: params.overlapping }
  );

  const items: Json[] = [];
  for (const match of page) {
    const encoding: FindEncoding = wanted[match.pattern]?.encoding ?? "hex";
    const members: { [key: string]: Json } = { encoding };
    if (inCompressed) {
      const deepest = deepestCovering(tree, match, found.space, found.node);
      members.where = placesJson([
        { kind: "uefi", id: nodeIdText(deepest.id), name: ownName(deepest) ?? deepest.name },
      ]);
      members.node_start = hexText(match.start - scope.start);
      members.node_end = hexText(match.end - scope.start);
    } else {
      members.start = hexText(match.start);
      members.end = hexText(match.end);
    }
    if (params.context > 0) {
      const around = {
        start: Math.max(scope.start, match.start - Math.min(params.context, match.start)),
        end: Math.min(scope.end, match.end + params.context),
      };
      const bytes = await storage.read(around.start, around.end - around.start);
      members.preview = previewJson(bytes, encoding, match.start - around.start);
    }
    items.push(members);
  }
  return {
    envelope,
    total,
    range: { start: offset, end },
    items,
    scope_start: scope.start,
  };
}
