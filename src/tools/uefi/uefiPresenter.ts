import type { RebuildTarget } from "@/firmware/uefi/uefiRebuild";
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
  /**
   * What the node is, where the caller has it — a wire node does. It decides
   * one thing here: whether the node is a structure the image can be laid out
   * again around.
   */
  readonly kind?: string | undefined;
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
 * The fields an export is decided from. A wire node has them, and so does a
 * parsed one once its ranges are written as pairs.
 */
export interface CompressedSectionNode {
  readonly kind: string;
  readonly name: string;
  readonly header: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
  readonly space: readonly number[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.compression */
  readonly compression?: { readonly algorithm: string; readonly decodes: boolean } | undefined;
  readonly isExpandable: boolean;
  readonly children?: readonly { readonly space: readonly number[] }[] | undefined;
}

/**
 * What a node has that is worth taking out decompressed: which buffer it is
 * in, which bytes of it, and what the two commands offering it are called.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport
 */
export interface DecompressedExport {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.space */
  readonly space: readonly number[];
  /**
   * The bytes in that space, or nothing for the whole of it — which is what a
   * section's own body is.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.range
   */
  readonly range?: readonly [number, number] | undefined;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.suggestedName */
  readonly suggestedName: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.menuTitle */
  readonly menuTitle: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.openTitle */
  readonly openTitle: string;
}

/**
 * A compressed section exports everything it decompresses to — one that opened,
 * and one still closed that would: the row already says it is compressed, and
 * the buffer is decoded when the export reads it. A node inside one exports its
 * own bytes from that buffer. Nothing else has anything decompressed to save —
 * its bytes are the file's, and the dump already exports those.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.decompressedExport
 */
export function decompressedExport(node: CompressedSectionNode): DecompressedExport | undefined {
  // What came *out* of a section says so in its name. Without it the section
  // opened as a node and the same section's decompressed body arrive under one
  // name — `bios_LZMA Section.bin` twice — and the two hold entirely different
  // bytes. A node with no name is already called `decompressed`, so it says it
  // once.
  const base = Array.from(node.name.length === 0 ? "decompressed" : node.name)
    .map((character) => ("/:".includes(character) ? "_" : character))
    .join("");
  const marked = node.name.length === 0 ? base : `${base} decompressed`;
  const children = node.children ?? [];
  const opened = children.some((child) => !sameSpace(child.space, node.space));
  const closed = node.compression?.decodes === true && node.isExpandable && children.length === 0;
  if (node.kind === "section" && (opened || closed)) {
    return {
      // The buffer this section opens to: its own space with the section's
      // header offset on the end.
      // @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace.inside
      space: [...node.space, node.header[0]],
      range: undefined,
      suggestedName: `${marked}.bin`,
      menuTitle: "Export Decompressed Body…",
      openTitle: "Open Decompressed Body",
    };
  }
  if (node.space.length !== 0) {
    return {
      space: node.space,
      range: [node.header[0], Math.max(node.header[1], node.body[1], node.tail[1])],
      suggestedName: `${marked}.bin`,
      menuTitle: "Export Decompressed Bytes…",
      openTitle: "Open Decompressed Bytes",
    };
  }
  return undefined;
}

/**
 * The part's name: the dump it came out of, then what it is —
 * `bios_LZMA compressed section decompressed.bin`, the way a zone's is named.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.DecompressedExport.tabName
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.partName
 */
export function partName(suggestedName: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot <= 0 ? fileName : fileName.slice(0, dot);
  return stem.length === 0 ? suggestedName : `${stem}_${suggestedName}`;
}

/**
 * A file name made out of a node's own name: the characters a path is built
 * from become underscores, so a section called `a/b:c` cannot arrive as a
 * directory nobody asked for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.nodeOpen
 */
const fileNameOf = (name: string, fallback: string): string =>
  Array.from(name.length === 0 ? fallback : name)
    .map((character) => ("/:".includes(character) ? "_" : character))
    .join("");

/**
 * What opening a node — or its body alone — as a panel of its own means
 * (`Design/FRAGMENT_PANELS_PLAN.md`).
 *
 * Every node can be opened: a volume, a file, a section, and a node inside a
 * compressed section as much as one in the file. The way to study a part of an
 * image is often to read it as a file — its own offsets from zero, its own
 * search, its own tree — and the tree is where the reader is already pointing
 * at the part they mean.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen
 * @upstream-differs no `layout`: what a UEFI panel opened on the part should
 * read the bytes as is the tree's answer, and the tree is in the worker —
 * `askFirmwarePart` asks it at the moment the part is opened
 */
export interface NodeOpen {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.space */
  readonly space: readonly number[];
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.range */
  readonly range: readonly [number, number];
  /**
   * The file bytes the part links back to: the node's own where they are the
   * file's, and the compressed section they came out of where they are not.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.source
   */
  readonly source: readonly [number, number];
  /**
   * Where the bytes go back to through the rebuild planner, when the part is
   * something the image's structure can be laid out again around
   * (`Design/UEFI/UPDATE_IN_PARENT.md` §6).
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.rebuild
   */
  readonly rebuild?: RebuildTarget | undefined;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.suggestedName */
  readonly suggestedName: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.NodeOpen.menuTitle */
  readonly menuTitle: string;
}

/**
 * What the tree's menu calls opening `node`, or nothing where there is nothing
 * there to open: an empty range, or a body that is the whole node anyway.
 *
 * The title alone, for a menu built where the image is not at hand; `nodeOpen`
 * answers the rest.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.nodeOpenTitle
 */
export function nodeOpenTitle(node: ZonedNode, body: boolean): string | undefined {
  const whole = wholeRange(node);
  const range = body ? node.body : whole;
  if (range[1] <= range[0]) return undefined;
  if (body && range[0] === whole[0] && range[1] === whole[1]) return undefined;
  if (node.name.length === 0) return body ? "Open Node Body" : "Open Node";
  return body ? `Open Body of “${node.name}”` : `Open “${node.name}”`;
}

/**
 * What opening `node` would do, or nothing when there is nothing there to open:
 * an empty range, a body that is the whole node, or a part of a buffer whose
 * compressed section cannot be traced back to the file.
 *
 * `roots` is where that section is found, exactly as it is for a node's zones;
 * without them a node inside a buffer cannot be opened, because nothing can say
 * which bytes of the file it really is.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.nodeOpen
 */
export function nodeOpen(
  node: ZonedNode,
  body: boolean,
  roots?: readonly ZonedNode[]
): NodeOpen | undefined {
  const title = nodeOpenTitle(node, body);
  if (title === undefined) return undefined;
  const space = node.space ?? [];
  // Where it links back to: a node of the file is its own source, one in a
  // buffer is the compressed section holding it — and a section nothing can
  // find is a part with no way home, which upstream refuses to open at all.
  const range: readonly [number, number] = body ? [node.body[0], node.body[1]] : wholeRange(node);
  const source = space.length === 0 ? range : fileSourceOf(node, roots ?? []);
  if (source === undefined) return undefined;
  const suffix = body ? " body" : "";
  // A whole node of the file is a structure the image can be laid out again
  // around; a body, or a slice of a buffer, is bytes going back where they
  // were, through the section they came out of.
  const own: RebuildTarget = { space, range: { start: range[0], end: range[1] } };
  const rebuild =
    space.length === 0 && !body ? (LAID_OUT_AGAIN.has(node.kind ?? "") ? own : undefined) : own;
  return {
    space,
    range,
    source,
    ...(rebuild === undefined ? {} : { rebuild }),
    suggestedName: `${fileNameOf(node.name, "node")}${suffix}.bin`,
    menuTitle: title,
  };
}

/**
 * The kinds a rebuild can lay the image out again around.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.target
 * @upstream-differs read off the node in hand rather than by looking for a node
 * of the image with that exact range: the node the reader asked about is that
 * node, and the tree here is the panel's wire copy
 */
const LAID_OUT_AGAIN = new Set(["volume", "file", "section"]);

/**
 * Where a node's bytes are held in the file: its own range, or — for a node
 * inside a compressed section — the outermost section's.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.fileSource
 */
export function fileSourceOf(
  node: ZonedNode,
  roots: readonly ZonedNode[]
): readonly [number, number] | undefined {
  const outermost = node.space?.[0];
  if (outermost === undefined) return wholeRange(node);
  const section = sectionAt(roots, outermost);
  return section === undefined ? undefined : wholeRange(section);
}

/**
 * Everything a node covers, header through tail.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.range
 */
const wholeRange = (node: ZonedNode): readonly [number, number] => [
  node.header[0],
  Math.max(node.header[0], node.header[1], node.body[1], node.tail[1]),
];

/** Two spaces are the same buffer when they are the same chain of sections. */
const sameSpace = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((offset, index) => offset === right[index]);

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
