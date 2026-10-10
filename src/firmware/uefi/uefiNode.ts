import type { ImageRange } from "@/firmware/imageReader";
import { type ByteSpace, FILE_SPACE, isFileSpace } from "@/firmware/uefi/byteSpace";
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
  /**
   * An AMI NVAR entry (§9). Not under a store node of its own: an NVAR store
   * has no header, and its entries sit straight under the file or raw section
   * whose body it is, the way UEFITool shows them.
   */
  | "nvarEntry"
  /** The table of GUIDs at an NVAR store's end, which entries name by index. */
  | "nvarGuidStore"
  /**
   * A Dell DVAR store, found by the raw-area scan, and one of its entries (§9).
   * An entry's name is its name id in hex and its GUID its namespace's, as the
   * reference shows them.
   */
  | "dvarStore"
  | "dvarEntry"
  /**
   * An Insyde H2O Flash Device Map, found by the raw-area scan, and one of its
   * entries — the ranges it names are protected.
   */
  | "flashDeviceMapStore"
  | "flashDeviceMapEntry"
  /**
   * A range a flash device map names that the raw-area scan had left as padding
   * — the EC firmware, a password, the BIOS version table — named by its region
   * type (`UEFI_IMAGE_FORMAT.md` §9). UEFITool shows these bytes as padding, and
   * so does the Type column: the map, not anything in the bytes, says what they
   * are.
   */
  | "flashDeviceMapRegion"
  /**
   * One embedded controller image among several in a block of EC firmware —
   * padding, a map region, the descriptor's EC region — from its start to its
   * last written byte (`UEFI_IMAGE_FORMAT.md` §9). Like a map region, it
   * classifies as UEFITool's padding.
   */
  | "ecImage"
  /**
   * A structure the FIT names — the table, the Startup ACM, a Boot Guard
   * manifest — read out of padding (`UEFI_IMAGE_FORMAT.md` §9). The subtype is the
   * FIT type that names it (`FITComponentKind`). Padding to UEFITool, as a map
   * region is.
   */
  | "fitComponent"
  /**
   * A picture — JPEG, PNG, GIF or BMP — the raw-area scan found outside every
   * volume, or the body of a raw section opens with (`UEFI_IMAGE_FORMAT.md` §9).
   * The subtype is its `PictureFormat`; it is named by format and size in pixels,
   * and is padding to UEFITool.
   */
  | "picture"
  /**
   * The block HP puts in front of what it signs, read out of padding on a 4 KiB
   * boundary (`UEFI_IMAGE_FORMAT.md` §9). Padding to UEFITool, as a map region is.
   */
  | "hpSignatureBlock"
  /**
   * AMI's GPNV store read out of padding (`GPNVRecord`) — ASUS's record of the machine:
   * serial numbers, model, Windows key — and one record in it. Padding to UEFITool, as an
   * HP signature block is.
   */
  | "gpnvStore"
  | "gpnvRecord"
  /**
   * Lenovo's store of the machine's identity (`LenovoDMIStore`): the `LDBG` change
   * log and its entries, and the two `LENV` blocks — the subtype 1 on the one the
   * firmware reads, 0 on the other — and their entries. Read in place of the map
   * regions that declare them, or out of padding. Padding to UEFITool, as a GPNV
   * store is.
   */
  | "lenovoDMIStore"
  | "ldbgLog"
  | "ldbgEntry"
  | "lenvBlock"
  | "lenvEntry"
  /**
   * The DMI area where Acer's firmware keeps the machine's identity (`AcerDMIArea`): an
   * 8 KiB block of the system serial, the motherboard serial, the UUID, the model. Read out
   * of the padding inside the BIOS region — no PDR, no fixed offset, found by its content.
   * Padding to UEFITool, as a GPNV store is.
   */
  | "acerDMIStore"
  /**
   * The AMD PSP's map read out of padding (`AMDFirmware`): the Embedded Firmware Structure,
   * a directory — the subtype is its `DirectoryKind` — and a blob a directory lists, whose
   * subtype is its type. Padding to UEFITool, as an HP signature block is.
   */
  | "amdEFS"
  | "amdDirectory"
  | "amdFirmwareEntry"
  /**
   * An AMI BIOS Guard update file at the top of the file (`BIOSGuardUpdate`,
   * `UEFI_IMAGE_FORMAT.md` §1.2): its header with the table, and the blocks. Like a
   * compressed section, what it holds is not its bytes but what they make — the BIOS region
   * its blocks' data assembles to — so its children are in that space, one per entry of the
   * table.
   */
  | "biosGuardUpdate"
  /**
   * One entry of that table — `FV_MAIN_WRAPPER`, `NVRAM` — as the stretch of the assembled
   * region it covers, read as a raw area.
   */
  | "biosGuardEntry"
  /**
   * A sound — a WAV file — found where a file's body stops reading as sections
   * (`UEFI_IMAGE_FORMAT.md` §9). Named by its sample rate and channels; padding to
   * UEFITool, as a picture is.
   */
  | "sound"
  /**
   * An AMD microcode patch read out of padding (`UEFI_IMAGE_FORMAT.md` §7.2): no
   * signature, a header whose fields all check out. Its own type to UEFITool, as Intel's
   * is.
   */
  | "amdMicrocode"
  /**
   * The x86 Startup AP data EDK2's GenFv writes into the pad file before the
   * Volume Top File: a far jump the application processors start at. It is code
   * at a fixed address, so it does not move.
   */
  | "startupApData"
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
   * Which bytes `header`, `body` and `tail` are offsets into: the file, or the
   * buffer a compressed section decompresses to. Ranges are only ever compared
   * within one space, and `fileRange` is how a caller that needs bytes of the
   * file says so.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.space
   */
  space: ByteSpace;
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
  /**
   * For a block named after the one EC image at its start (`ECImage`): how long
   * that image is, which the panel puts in the name beside it. Nothing everywhere
   * else.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.namedImageLength
   */
  namedImageLength?: number | undefined;

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
  readonly space?: ByteSpace;
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
    space: options.space ?? FILE_SPACE,
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
 * Lies inside a compressed container, so its absolute address means nothing —
 * the decompressor puts it wherever it likes. Every address check skips these.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.isCompressed
 */
export const isNodeCompressed = (node: UEFINode): boolean => !isFileSpace(node.space);

/**
 * The node's range in the file — nothing for anything inside a compressed
 * section. The name makes a caller that needs file bytes say so.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFINode.swift#UEFINode.fileRange
 */
export function nodeFileRange(node: UEFINode): ImageRange | undefined {
  return isFileSpace(node.space) ? nodeRange(node) : undefined;
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
