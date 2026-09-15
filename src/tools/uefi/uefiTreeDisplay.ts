import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";
import { fileTypeName } from "@/firmware/uefi/fileParser";
import type { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { nvramGuidName } from "@/firmware/uefi/nvramGuids";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import type { UEFINode, UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { ItemType, subtypeName, typeName } from "@/firmware/uefi/uefiTypes";

/**
 * What the structure tree says about each node. Ported from upstream's
 * `UEFITreeDisplay.swift`, so the panel lays out text rather than choosing it.
 *
 * The Type and Subtype columns read the node in UEFITool's classification, and
 * the name comes from the GUID catalogue when the node has a GUID. The two
 * column texts need the parsed node — a volume's subtype is its file system, a
 * capsule's is its GUID — so the worker works them out and they cross the wire
 * with the node; the name needs the catalogue, which lives on the main thread,
 * so it is worked out there from the fields that cross.
 */

/**
 * The Type column: the node's item type, in UEFITool's words.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.typeText
 */
export function typeText(node: UEFINode): string {
  return typeName(itemType(node));
}

/**
 * The Subtype column, when there is one. A file and a section are named from
 * the parser's own type tables; every other type reads the generated ones.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.subtypeText
 */
export function subtypeText(node: UEFINode): string {
  const subtype = itemSubtype(node);
  if (subtype === undefined) return "";
  switch (node.kind) {
    case "file":
      return fileTypeName(subtype);
    case "section":
      return sectionTypeName(subtype);
    default:
      return subtypeName(itemType(node), subtype) ?? "";
  }
}

/** The fields the tree's rows and title are read from, parsed or wired. */
export interface DisplayNode<Self> {
  readonly kind: string;
  readonly name: string;
  readonly typeText: string;
  readonly subtypeText: string;
  readonly children: readonly Self[];
}

/**
 * The tree as it is shown: the outline's top level, and the node the title
 * stands for when the tree's root has been taken out of the tree.
 *
 * A wrapper root — an Intel image, the "UEFI image" the parser groups several
 * tops under, a capsule's envelope — does no work as a row: its one job is to
 * say what the whole image is, so it moves up into the title and its children
 * open the outline. A real root stays a row: it is a container the tree opens
 * on demand, and folding it would mean deciding again the moment somebody
 * opened it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.present
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.PresentedImage
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.PresentedImage.title
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.PresentedImage.rows
 * @upstream-differs the presented image is the returned { title, rows }
 */
export function present<T extends DisplayNode<T>>(
  roots: readonly T[]
): { readonly title: T | undefined; readonly rows: readonly T[] } {
  const root = roots[0];
  if (
    roots.length !== 1 ||
    root === undefined ||
    !isWrapper(root.kind) ||
    root.children.length === 0
  ) {
    return { title: undefined, rows: roots };
  }
  return { title: root, rows: root.children };
}

function isWrapper(kind: string): boolean {
  return kind === "intelImage" || kind === "uefiImage" || kind === "capsule";
}

/**
 * Padding nobody wrote to: erased bytes between structures. The tree leaves
 * these out unless the reader asks for them — a dump is full of them, and a row
 * that stands for nothing is a row to scroll past. Padding that holds data
 * stays, and so does free space inside a volume, which says how much room the
 * volume has.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.isEmptyPadding
 */
export function isEmptyPadding(node: {
  readonly kind: string;
  readonly isErased: boolean;
}): boolean {
  return node.kind === "padding" && node.isErased;
}

/**
 * `nodes` as the tree lists them: every one, or all but the empty padding.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.listed
 */
export function listed<T extends { readonly kind: string; readonly isErased: boolean }>(
  nodes: readonly T[],
  showsEmptyPadding: boolean
): readonly T[] {
  return showsEmptyPadding ? nodes : nodes.filter((node) => !isEmptyPadding(node));
}

/**
 * What the title leads with: the type of the top of the tree.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.imageType
 */
export function imageType<T extends DisplayNode<T>>(roots: readonly T[]): string {
  const root = roots[0];
  if (root === undefined) return "";
  return root.subtypeText.length === 0 ? root.typeText : `${root.typeText} · ${root.subtypeText}`;
}

/**
 * What the tree is, in one line. It counts nothing: the tree is materialized
 * branch by branch as it is opened, so a node count would be a count of clicks.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.summary
 */
export function summary<T extends DisplayNode<T>>(roots: readonly T[]): string {
  if (roots.length === 0) return "Nothing here looks like a firmware image.";
  const title = present(roots).title;
  if (title !== undefined && (title.kind === "intelImage" || title.kind === "uefiImage")) {
    return title.name.length === 0 ? imageType(roots) : title.name;
  }
  return imageType(roots);
}

/**
 * The name the tree shows for a node.
 *
 * A node with a GUID is named by the catalogue, by the NVRAM classifier's names
 * while the catalogue has none, and by the GUID itself as the last resort. A VSS
 * variable is the exception: its decoded name — "BootOrder", "PK" — is what a
 * reader looks for, and many variables share one vendor GUID. A node without a
 * GUID keeps the parser's name, falling back to its kind.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.name
 */
export function nodeName(
  node: {
    readonly kind: string;
    readonly subtype?: number | undefined;
    readonly name: string;
    readonly guid?: EFIGUID | undefined;
  },
  catalogue: GuidsCatalogue
): string {
  // A pad file (`EFI_FV_FILETYPE_FFS_PAD`) has a GUID only because every file
  // header does — all ones, as a rule — and it names nothing.
  if (node.kind === "file" && node.subtype === 0xf0) return "Padding file";
  if (node.guid === undefined) {
    return node.name.length === 0 ? kindLabel(node.kind) : node.name;
  }
  if (node.kind === "vssEntry" && node.name.length > 0) return node.name;
  return catalogue.nameOf(node.guid) ?? nvramGuidName(node.guid) ?? guidText(node.guid);
}

const KIND_LABELS: Readonly<Record<UEFINodeKind, string>> = {
  capsule: "Capsule",
  intelImage: "Intel image",
  uefiImage: "UEFI image",
  flashDescriptor: "Flash descriptor",
  region: "Region",
  volume: "Volume",
  file: "FFS file",
  section: "Section",
  microcode: "Microcode",
  // The NVRAM stores and entries read as their item-type word, so the fallback
  // name and the Type column can never drift apart.
  vssStore: typeName(ItemType.vssStore),
  vss2Store: typeName(ItemType.vss2Store),
  ftwStore: typeName(ItemType.ftwStore),
  fdcStore: typeName(ItemType.fdcStore),
  sysFStore: typeName(ItemType.sysFStore),
  flashMapStore: typeName(ItemType.phoenixFlashMapStore),
  evsaStore: typeName(ItemType.evsaStore),
  cmdbStore: typeName(ItemType.cmdbStore),
  slicData: typeName(ItemType.slicData),
  vssEntry: typeName(ItemType.vssEntry),
  sysFEntry: typeName(ItemType.sysFEntry),
  evsaEntry: typeName(ItemType.evsaEntry),
  flashMapEntry: typeName(ItemType.phoenixFlashMapEntry),
  padding: "Padding",
  freeSpace: "Free space",
  nonUEFIData: "Non-UEFI data",
};

/** The word for a node's kind. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as UEFINodeKind] ?? kind;
}
