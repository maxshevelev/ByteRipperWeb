import type { ZoneMap } from "@/tools/zone";

/**
 * The zones a selected node publishes. Ported from upstream's
 * `UEFIPresenter.zones(for:)`.
 *
 * The node itself, and — when it has a header of its own — its body as a zone
 * inside it, which is the focus. Two zones, not three: "where does the header
 * end" is the question a bench opens a dump to answer, and the body's own start
 * answers it; a third zone over the header would draw a boundary the other two
 * already show. The node's zone stays because it says how far the structure
 * reaches, and it is what the tail of an FFSv1 file falls inside.
 *
 * Only this node, never its children: a parse is thousands of nodes, and
 * outlining a store's two hundred variables at once is how the dump stops being
 * readable.
 *
 * One divergence: upstream publishes the enclosing section for a node inside a
 * compressed one. This port does not open compressed sections yet.
 */

/** The fields of a node a zone is made from — a wire node has them. */
export interface ZonedNode {
  readonly id: readonly number[];
  readonly name: string;
  readonly header: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
}

/** What separates a part of a node from the node in a zone id. */
const PART_SEPARATOR = "#";

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.zones
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.zoneID
 * @upstream-differs the zone id is built inline from the node's path
 */
export function uefiZones(node: ZonedNode | undefined): ZoneMap {
  if (node === undefined) return { zones: [], focus: undefined };
  // The node's path, `1.2.0` — the same key the tree's rows use, and stable
  // across a re-parse of the same image.
  const id = node.id.join(".");
  const whole = {
    id,
    name: node.name,
    start: node.header[0],
    end: Math.max(node.header[1], node.body[1], node.tail[1]),
  };

  // A node with no header of its own — padding, free space, data nobody claimed
  // — is all body, and a node with no body has none to draw. Either way the
  // body's zone would be the node's own drawn twice.
  const hasHeader = node.header[1] > node.header[0];
  const hasBody = node.body[1] > node.body[0];
  if (!hasHeader || !hasBody) return { zones: [whole], focus: whole.id };

  const body = {
    id: `${id}${PART_SEPARATOR}body`,
    name: node.name.length === 0 ? "Body" : `${node.name} body`,
    start: node.body[0],
    end: node.body[1],
  };
  // Outermost first, the order the dump draws. The body is the focus: it is
  // what the node holds, and what is in front of it is the header.
  return { zones: [whole, body], focus: body.id };
}

/**
 * The trip back: the user picked a zone in the dump and the panel has to expand
 * to the node it came from. Undefined for an id this tool did not make.
 *
 * A part's zone leads to the same node as the whole of it — the reader picked
 * "MyDriver body" in the dump and the row they want is MyDriver.
 *
 * The path is digits and dots, so the `#` separator can never be confused with
 * anything in one; a field that is not a number is a refusal rather than a zero,
 * which is what keeps an id from anywhere else out of the tree.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.nodeID
 */
export function nodeIDOfZone(id: string): readonly number[] | undefined {
  // `split` on a string that does not contain the separator answers one empty
  // field, which the emptiness guard below turns into a refusal — the same as
  // upstream's `split(omittingEmptySubsequences: false)[0]`.
  const path = id.split(PART_SEPARATOR)[0] ?? "";
  if (path.length === 0) return undefined;
  const fields = path.split(".");
  // `Number` alone would read `1e3` and `0x10` as numbers, where Swift's
  // `Int(_:)` reads only an optionally signed run of digits; a field it refuses
  // is a refusal for the whole id.
  const numbers = fields.filter((field) => /^[+-]?\d+$/.test(field)).map(Number);
  if (numbers.length !== fields.length) return undefined;
  return numbers;
}
