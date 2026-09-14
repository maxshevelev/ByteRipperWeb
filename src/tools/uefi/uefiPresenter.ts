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
