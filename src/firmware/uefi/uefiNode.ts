import type { ImageRange } from "@/firmware/imageReader";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";

/**
 * One element of a firmware image: a volume, a file, a section, a stretch of
 * padding.
 *
 * A node is *ranges of the image*, never bytes. Nothing here copies the file: a
 * 32 MB image parses into a few thousand nodes holding three ranges each, and
 * anyone who wants the bytes reads them back through the same reader. That is
 * also what keeps the model honest for an editor — a node says where a
 * structure is, so writing to it is writing to the file rather than to a copy
 * of it that has to be put back.
 *
 * `header` / `body` / `tail` are contiguous and non-overlapping, and the split
 * is the whole shape of this format: almost every level is a header followed by
 * a body that the next level parses. `tail` is used only by FFSv1 files with
 * `FFS_ATTRIB_TAIL_PRESENT` and is empty everywhere else.
 */

/**
 * How a container's body is compressed, and whether this project opens it.
 *
 * The parser knows both at the moment it reads the algorithm byte or the
 * section's GUID, which is the only moment they are cheap to work out — a
 * panel that wants to say "LZMA, and not opened here" would otherwise have to
 * find the byte again through the reader it may no longer have.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#SectionCompression
 */
export interface SectionCompression {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#SectionCompression.algorithm */
  readonly algorithm: string;
  /**
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#SectionCompression.decodes
   * @upstream-differs false for every algorithm: this port decompresses no
   * section at all (G1), so none of them is one it could open — and saying
   * otherwise would put a "did not decompress" caution on every compressed
   * section in the image.
   */
  readonly decodes: boolean;
}

/**
 * What an element *is*.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINodeKind
 */
export type UEFINodeKind =
  | "capsule"
  /**
   * The whole of an Intel flash image: a descriptor and the regions it maps,
   * under one root the way UEFITool shows it. Its body is the whole image and
   * its children are the descriptor and regions laid out in it.
   */
  | "intelImage"
  /**
   * The fallback root of a file that is neither a capsule nor an Intel
   * descriptor image: whatever the scan found, grouped under one Image node the
   * way UEFITool always shows one. The same Image type as `intelImage`, told
   * apart by subtype.
   */
  | "uefiImage"
  | "flashDescriptor"
  | "region"
  | "volume"
  | "file"
  | "section"
  | "microcode"
  // The stores an NVRAM volume body is read as. Each is a distinct kind because
  // the tree's Type column is keyed by kind and no byte on the node says which
  // store it is — the parser matched a signature to know.
  | "vssStore"
  | "vss2Store"
  | "ftwStore"
  | "fdcStore"
  | "sysFStore"
  | "flashMapStore"
  | "evsaStore"
  | "cmdbStore"
  | "slicData"
  // A variable or entry inside one of those stores.
  | "vssEntry"
  | "sysFEntry"
  | "evsaEntry"
  | "flashMapEntry"
  /** Space between elements that belongs to no structure. */
  | "padding"
  /** The unused tail of a volume's body. */
  | "freeSpace"
  /** Bytes inside a volume that are not an FFS file and not free space. */
  | "nonUEFIData";

/**
 * Where a node sits in the tree, as the path of child indices from the root.
 *
 * Not an offset: two parses of the same image give the same paths, a path
 * survives being written down in a zone id, and it reads back as a route —
 * which is what a diagnostic about a node three levels down needs to say.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#NodeID
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#NodeID.path
 */
export type NodeID = readonly number[];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#NodeID.root */
export const ROOT_ID: NodeID = [];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#NodeID.child */
export const childId = (parent: NodeID, index: number): NodeID => [...parent, index];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#NodeID.description */
export const nodeIdText = (id: NodeID): string => (id.length === 0 ? "root" : id.join("."));

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode */
export interface UEFINode {
  /**
   * Stamped once the tree is built, so the parser carries no counter around.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.id
   */
  id: NodeID;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.kind */
  kind: UEFINodeKind;
  /**
   * The format's own type byte, read according to `kind`: an FFS file type for
   * a file, a section type for a section. Untyped on purpose — these are
   * one-byte codes with vendor ranges and unknown values, and turning an
   * unknown code into a case would lose the number worth showing.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.subtype
   */
  subtype?: number | undefined;
  /**
   * What to call it on screen. The parser fills in the best it has: a
   * user-interface section's string, a known GUID's name, or the type.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.name
   */
  name: string;
  /**
   * A volume's file system, a file's name, a section's definition GUID.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.guid
   */
  guid?: EFIGUID | undefined;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.header */
  header: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.body */
  body: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.tail */
  tail: ImageRange;

  /**
   * Cannot be moved when the image is rebuilt: the VTF, whatever FIT points at,
   * anything a Boot Guard range covers, a file marked `FFS_ATTRIB_FIXED`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.isFixed
   */
  isFixed: boolean;
  /**
   * Lies inside a compressed container, so its absolute address means nothing —
   * the decompressor puts it wherever it likes. Every address check skips these.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.isCompressed
   */
  isCompressed: boolean;
  /**
   * The algorithm a container's body is compressed with — nothing for a body
   * that is not compressed, and for one whose algorithm the format does not
   * name. Read by a panel's compressed badge, which says whether this project
   * opens it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.compression
   */
  compression?: SectionCompression | undefined;
  /**
   * Nothing but the erase byte: free space, or padding that was never used.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.isErased
   */
  isErased: boolean;
  /**
   * True when this container's children have not been computed yet but *could
   * be non-empty if they were* — a volume whose files nobody has asked for, a
   * raw-area region nobody has scanned. It is what draws the disclosure
   * triangle, and it goes false the moment the children are materialized,
   * whether or not any turned up.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.isExpandable
   */
  isExpandable: boolean;
  /**
   * The parser's own recursion depth for this node's children, recorded where
   * the node was left closed so that expanding it later lands at the same depth
   * an all-at-once parse would have reached. Meaningless on a node that is not
   * `isExpandable`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.childDepth
   */
  childDepth: number;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.children */
  children: UEFINode[];
}

export interface NodeOptions {
  readonly id?: NodeID;
  readonly kind: UEFINodeKind;
  readonly subtype?: number | undefined;
  readonly name: string;
  readonly guid?: EFIGUID | undefined;
  readonly header: ImageRange;
  readonly body: ImageRange;
  readonly tail?: ImageRange | undefined;
  readonly isFixed?: boolean;
  readonly isCompressed?: boolean;
  readonly compression?: SectionCompression | undefined;
  readonly isErased?: boolean;
  readonly isExpandable?: boolean;
  readonly childDepth?: number;
  readonly children?: UEFINode[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.init */
export function makeNode(options: NodeOptions): UEFINode {
  return {
    id: options.id ?? ROOT_ID,
    kind: options.kind,
    subtype: options.subtype,
    name: options.name,
    guid: options.guid,
    header: options.header,
    body: options.body,
    tail: options.tail ?? { start: options.body.end, end: options.body.end },
    isFixed: options.isFixed ?? false,
    isCompressed: options.isCompressed ?? false,
    compression: options.compression,
    isErased: options.isErased ?? false,
    isExpandable: options.isExpandable ?? false,
    childDepth: options.childDepth ?? 0,
    children: options.children ?? [],
  };
}

/** A node with no header of its own — padding, free space, data nobody claimed. */
export function makeSpan(options: {
  readonly kind: UEFINodeKind;
  readonly name: string;
  readonly range: ImageRange;
  readonly isErased?: boolean;
}): UEFINode {
  return makeNode({
    kind: options.kind,
    name: options.name,
    header: { start: options.range.start, end: options.range.start },
    body: options.range,
    ...(options.isErased === undefined ? {} : { isErased: options.isErased }),
  });
}

/**
 * Everything the node covers, header through tail.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.range
 */
export function nodeRange(node: UEFINode): ImageRange {
  const end = Math.max(node.header.end, node.body.end, node.tail.end);
  return { start: node.header.start, end: Math.max(node.header.start, end) };
}

/**
 * This node and all of its descendants, outermost first — the order a reader
 * meets them in.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.flattened
 */
export function flattened(node: UEFINode): UEFINode[] {
  const all: UEFINode[] = [node];
  for (const child of node.children) all.push(...flattened(child));
  return all;
}
