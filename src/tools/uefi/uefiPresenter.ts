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
 * A node inside a compressed section is not a range of the file, and its buffer
 * offsets drawn over the dump would outline unrelated bytes. What it publishes
 * is the section that holds it — the bytes that really are it — named after
 * both, and picking that zone brings back the section, which is all the file can
 * say. `roots` is where that section is found; without them such a node
 * publishes nothing.
 */

/** The fields of a node a zone is made from — a wire node has them. */
export interface ZonedNode {
  readonly id: readonly number[];
  readonly name: string;
  readonly header: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
  /** Which bytes the ranges are in; the file, when it is missing. */
  readonly space?: readonly number[] | undefined;
  readonly children?: readonly ZonedNode[] | undefined;
}

/** What separates a part of a node from the node in a zone id. */
const PART_SEPARATOR = "#";

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.zones
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.zoneID
 * @upstream-differs the zone id is built inline from the node's path
 */
export function uefiZones(node: ZonedNode | undefined, roots?: readonly ZonedNode[]): ZoneMap {
  if (node === undefined) return { zones: [], focus: undefined };
  const outermost = node.space?.[0];
  if (outermost !== undefined) {
    const section = sectionAt(roots ?? [], outermost);
    if (section === undefined) return { zones: [], focus: undefined };
    const name = node.name === "" ? "Compressed" : node.name;
    return zonesOf(section, `${name} (in ${section.name})`);
  }
  return zonesOf(node, node.name);
}

/**
 * The file-space node whose header starts at `offset` — the compressed section a
 * space names, found the way upstream finds it: down the chain of nodes covering
 * that byte of the file, and only one of the file's own.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.zones
 */
function sectionAt(roots: readonly ZonedNode[], offset: number): ZonedNode | undefined {
  let nodes = roots;
  let innermost: ZonedNode | undefined;
  for (;;) {
    const found = nodes.find((one) => {
      if ((one.space?.length ?? 0) !== 0) return false;
      const end = Math.max(one.header[1], one.body[1], one.tail[1]);
      return offset >= one.header[0] && offset < end;
    });
    if (found === undefined) break;
    innermost = found;
    nodes = found.children ?? [];
  }
  return innermost?.header[0] === offset ? innermost : undefined;
}

function zonesOf(node: ZonedNode, name: string): ZoneMap {
  // The node's path, `1.2.0` — the same key the tree's rows use, and stable
  // across a re-parse of the same image.
  const id = node.id.join(".");
  const whole = {
    id,
    name,
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
