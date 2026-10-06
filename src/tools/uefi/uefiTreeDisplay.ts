import { L, localized } from "@/core/localization/localization";
import {
  type DellSetupCatalogue,
  type DellSetupSetting,
  settingName,
  settingOption,
} from "@/firmware/uefi/dellSetupForms";
import { EC_COPY_SUBTYPE } from "@/firmware/uefi/ecFirmware";
import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";
import { fileTypeName } from "@/firmware/uefi/fileParser";
import { regionTypeName } from "@/firmware/uefi/flashDeviceMapFormat";
import type { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { nvramGuidName } from "@/firmware/uefi/nvramGuids";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import type { UEFINode, UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub, subtypeName, typeName } from "@/firmware/uefi/uefiTypes";
import { topSwapName } from "@/tools/uefi/uefiTopSwap";

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
    // Padding to UEFITool; what the column can say of a record is whether it is the one in
    // force.
    case "gpnvRecord":
      return node.subtype === 1 ? L("Current") : L("Superseded");
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
 * volume has. So does erased padding with rows read inside it — an Insyde map's
 * region nobody has written yet — since hiding it would hide them.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.isEmptyPadding
 */
export function isEmptyPadding(node: {
  readonly kind: string;
  readonly isErased: boolean;
  readonly children?: readonly unknown[] | undefined;
}): boolean {
  return node.kind === "padding" && node.isErased && (node.children?.length ?? 0) === 0;
}

/**
 * A row that stands for room rather than for content: every row the Subtype column
 * calls "Empty (FFh)", free space, and a pad file with an erased body. The tree draws
 * it grey, the way the ME tree draws a section that holds nothing — a place in the
 * layout, not something to go and look at. A row with rows read inside it is not one,
 * nor is a pad file that holds data: what was read there is content.
 *
 * "Empty (FFh)" is asked of the column's own classification rather than of the node's
 * kind: plain padding is not the only row it names — an Insyde map's region nobody has
 * written (Unused, a password slot, an MSDM table) is one too, and a rule that listed
 * kinds left those rows black under a column that said they were empty.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.isEmptySpace
 */
export function isEmptySpace(node: UEFINode): boolean {
  if (node.children.length > 0) return false;
  switch (node.kind) {
    case "freeSpace":
      return true;
    case "file":
      return node.subtype === 0xf0;
    default:
      return itemType(node) === ItemType.padding && itemSubtype(node) === Sub.onePadding;
  }
}

/**
 * Whether the row of `node` says a value, and so needs the bytes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.showsValue
 */
export function showsValue(node: { readonly kind: string }): boolean {
  return (
    node.kind === "dvarEntry" ||
    node.kind === "vssEntry" ||
    node.kind === "nvarEntry" ||
    node.kind === "gpnvRecord"
  );
}

/**
 * `nodes` as the tree lists them: every one, or all but the empty padding — and all
 * but the copies of variables `hiding` names, by their ids as text, which a store's
 * later entries replaced (`supersededCopies`).
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.listed
 */
export function listed<
  T extends { readonly kind: string; readonly isErased: boolean; readonly id?: readonly number[] },
>(nodes: readonly T[], showsEmptyPadding: boolean, hiding?: ReadonlySet<string>): readonly T[] {
  if (showsEmptyPadding && (hiding === undefined || hiding.size === 0)) return nodes;
  return nodes.filter(
    (node) =>
      (showsEmptyPadding || !isEmptyPadding(node)) &&
      !(hiding !== undefined && node.id !== undefined && hiding.has(node.id.join(".")))
  );
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
export function summary<T extends DisplayNode<T>>(
  roots: readonly T[],
  protectedRangeCount = 0
): string {
  if (roots.length === 0) return L("Nothing here looks like a firmware image.");
  const lead = titleLead(roots);
  // The image names protected ranges at all: the one thing about it that says
  // some edits are not free.
  if (protectedRangeCount === 0) return lead;
  return `${lead} · ${protectedRangeCount} protected range${protectedRangeCount === 1 ? "" : "s"}`;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.titleLead */
function titleLead<T extends DisplayNode<T>>(roots: readonly T[]): string {
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
 * or NVAR variable is the exception: its decoded name — "BootOrder", "PK" — is what a
 * reader looks for, and many variables share one vendor GUID. A node without a
 * GUID keeps the parser's name, falling back to its kind.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.name
 */
export function nodeName(node: NamedNode, catalogue: GuidsCatalogue): string {
  return topSwapName(baseName(node, catalogue), node.topSwap);
}

/**
 * What a file's name is looked for in: its sections, as far as they have been opened.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.ownName
 */
export interface OwnNameNode {
  readonly kind: string;
  readonly subtype?: number | undefined;
  readonly name?: string | undefined;
  readonly isErased?: boolean | undefined;
  readonly children?: readonly OwnNameNode[] | undefined;
}

/**
 * A Name section: its text is its file's name.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.isNameSection
 */
export const isNameSection = (node: {
  readonly kind: string;
  readonly subtype?: number | undefined;
}) => node.kind === "section" && node.subtype === 0x15;

/**
 * The name a file gives itself in its Name section (`EFI_SECTION_USER_INTERFACE`), looked
 * for through the sections opened so far; nothing for anything else, and for a file with
 * none.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.ownName
 */
export function ownName(node: {
  readonly kind: string;
  readonly children?: readonly OwnNameNode[] | undefined;
}): string | undefined {
  if (node.kind !== "file") return undefined;
  const search = (sections: readonly OwnNameNode[] | undefined): string | undefined => {
    for (const section of sections ?? []) {
      if (section.kind !== "section") continue;
      if (isNameSection(section) && section.name !== undefined && section.name.length > 0) {
        return section.name;
      }
      const nested = search(section.children);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return search(node.children);
}

/**
 * What the name is decided from: the kind, the parser's own name and GUID, and the
 * little the panel knows of the rest.
 */
export interface NamedNode {
  readonly kind: string;
  readonly subtype?: number | undefined;
  readonly name: string;
  readonly guid?: EFIGUID | undefined;
  /**
   * What a pad file is named after, so a row that has them says so; and the sections a
   * file names itself by.
   */
  readonly children?: readonly OwnNameNode[];
  /**
   * How long the one EC image a block is named after is (`namedImageLength`).
   */
  readonly namedImageLength?: number | undefined;
  /**
   * How long the node is, for the rows that are named by their size (an EC image's).
   */
  readonly length?: number | undefined;
  /**
   * Whether the row is outermost in a Top Swap block, which the copy's rows say
   * in their name (`UEFITopSwap`).
   */
  readonly topSwap?: "copy" | "original" | undefined;
  /**
   * For a DVAR entry, how long its value is and, up to eight bytes, what it is as a
   * little-endian number: the row says its value after its name.
   *
   * @upstream-differs the panel holds no bytes, so the worker reads the value
   */
  readonly dvarValue?: DvarValue | undefined;
  /**
   * For a live VSS or NVAR variable: its row with the value after the name, read as its
   * type. Absent for any other node, and where the value is not read.
   *
   * @upstream-differs the panel holds no bytes, so the worker reads the value
   */
  readonly valueRow?: string | undefined;
  /** What Dell's Setup says the DVAR variables are, once the forms have been read. */
  readonly dvarSettings?: DellSetupCatalogue | undefined;
}

/** A DVAR entry's value as the panel holds it: its length, and its number when it fits. */
export interface DvarValue {
  readonly length: number;
  readonly number: bigint | undefined;
}

const kibibytes = (length: number): number => Math.floor((length + 0x3ff) / 0x400);

/** How long a node as the panel holds it is: header through tail. */
export const wireLength = (node: {
  readonly header: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
}): number => Math.max(node.header[1], node.body[1], node.tail[1]) - node.header[0];

function baseName(node: NamedNode, catalogue: GuidsCatalogue): string {
  // An EC image is named by what it carries and how large it is, in KiB — the
  // bench sizes EC firmware by it (128, 192, 256) — and a copy of an earlier one
  // in the same block says so.
  if (node.kind === "ecImage") {
    const sized = L("%1$@, %2$@ KB", node.name, kibibytes(node.length ?? 0));
    return node.subtype === EC_COPY_SUBTYPE ? L("%1$@ (copy)", sized) : sized;
  }
  // A block named after the one image it holds gives that image's size inside the
  // parentheses: "EC Firmware (ITE EC-V13.6, 128 KB)".
  if (node.namedImageLength !== undefined && node.name.endsWith(")")) {
    return `${L("%1$@, %2$@ KB", node.name.slice(0, -1), kibibytes(node.namedImageLength))})`;
  }
  // A pad file (`EFI_FV_FILETYPE_FFS_PAD`) has a GUID only because every file
  // header does — all ones, as a rule — and it names nothing.
  if (node.kind === "file" && node.subtype === 0xf0) {
    // What its body turned out to hold, the way UEFITool renames it.
    const children = node.children ?? [];
    if (children.some((child) => child.kind === "startupApData")) {
      return L("Startup AP data padding file");
    }
    if (children.some((child) => child.kind === "padding" && child.isErased !== true)) {
      return L("Non-empty padding file");
    }
    return L("Padding file");
  }
  // A Dell variable is a number in a namespace. The row says what Setup calls it,
  // where a Setup page asks about it, and its Name ID where none does — the
  // namespace is in the detail, and on a Dell dump it is one GUID on almost every
  // row. Then the value, as Setup words it where it can: "SecureBoot = Not ticked
  // (0x0)"; a value too long to read as a number, by its size: "0x2 (16 bytes)".
  if (node.kind === "dvarEntry" && node.guid !== undefined) {
    const setting = node.dvarSettings?.settingFor(node);
    const name = setting === undefined ? `0x${node.name}` : settingName(setting);
    const value = node.dvarValue;
    if (value === undefined) return name;
    const text = dvarValueText(value, setting);
    if (text === undefined)
      return value.length > 8 ? L("%1$@ (%2$@ bytes)", name, `${value.length}`) : name;
    return `${name} = ${text}`;
  }
  // A GPNV record says what it holds: the Windows key, or the text in its data — serial
  // numbers, the model — as far as a row has room.
  if (node.kind === "gpnvRecord") return node.valueRow ?? node.name;
  if (node.guid === undefined) {
    return node.name.length === 0 ? kindLabel(node.kind) : node.name;
  }
  // A file that names itself is called what it says: the firmware's own word for this
  // image beats the catalogue's for the GUID, which a vendor can have given to another
  // module (the catalogue's name, when it differs, is in the detail).
  const own = ownName(node);
  if (own !== undefined) return own;
  // A live VSS variable's value follows its name, as its type reads: `BootOrder =
  // 0003, 2001`, `Lang = "eng"`. So does an NVAR variable's, on the entry that holds it
  // now. The store says where the value is.
  if ((node.kind === "vssEntry" || node.kind === "nvarEntry") && node.name.length > 0) {
    return node.valueRow ?? node.name;
  }
  // A flash device map entry's GUID is a region *type*, and UEFITool names the
  // row by what the type is: "Variable Defaults", "Password".
  if (node.kind === "flashDeviceMapEntry") {
    const type = regionTypeName(node.guid);
    if (type !== undefined) return type;
  }
  // The region the entry names is called the same — by the parser, which adds
  // what it read inside, such as the EC firmware's identification.
  if (
    node.kind === "flashDeviceMapRegion" &&
    regionTypeName(node.guid) !== undefined &&
    node.name.length > 0
  ) {
    return node.name;
  }
  return catalogue.nameOf(node.guid) ?? nvramGuidName(node.guid) ?? guidText(node.guid);
}

/**
 * A DVAR value up to eight bytes long, little-endian, as a number — with what Setup
 * calls it in front, where it says.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.dvarValue
 */
function dvarValueText(
  value: DvarValue,
  setting: DellSetupSetting | undefined
): string | undefined {
  if (value.length === 0 || value.length > 8 || value.number === undefined) return undefined;
  const hex = `0x${value.number.toString(16).toUpperCase()}`;
  const meaning = setting === undefined ? undefined : dvarMeaning(value.number, setting);
  return meaning === undefined ? hex : `${meaning} (${hex})`;
}

/**
 * What `number` means to the Setup question: ticked or not, the option of a list, a
 * number as a number. Nothing where Setup does not say.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.dvarMeaning
 */
export function dvarMeaning(number: bigint, setting: DellSetupSetting): string | undefined {
  switch (setting.kind) {
    case "checkbox":
      return number === 0n ? L("Not ticked") : number === 1n ? L("Ticked") : undefined;
    case "oneOf": {
      const text = settingOption(setting, number);
      return text === undefined || text === "" ? undefined : text;
    }
    case "numeric":
      return `${number}`;
    case "string":
    case "other":
      return undefined;
  }
}

const KIND_LABELS: () => Readonly<Record<UEFINodeKind, string>> = localized(() => ({
  capsule: "Capsule",
  intelImage: "Intel image",
  uefiImage: "UEFI image",
  flashDescriptor: "Flash descriptor",
  region: L("Region"),
  volume: "Volume",
  file: "FFS file",
  section: "Section",
  microcode: "Microcode",
  amdMicrocode: "AMD microcode",
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
  nvarEntry: typeName(ItemType.nvarEntry),
  nvarGuidStore: typeName(ItemType.nvarGuidStore),
  dvarStore: typeName(ItemType.dellDvarStore),
  dvarEntry: typeName(ItemType.dellDvarEntry),
  startupApData: typeName(ItemType.startupApDataEntry),
  flashDeviceMapRegion: L("Flash device map region"),
  ecImage: L("EC firmware image"),
  fitComponent: L("FIT component"),
  hpSignatureBlock: L("HP signature block"),
  gpnvStore: L("GPNV store"),
  gpnvRecord: L("GPNV record"),
  picture: L("Picture"),
  sound: L("Sound"),
  flashDeviceMapStore: typeName(ItemType.insydeFlashDeviceMapStore),
  flashDeviceMapEntry: typeName(ItemType.insydeFlashDeviceMapEntry),
  padding: L("Padding"),
  freeSpace: L("Free space"),
  nonUEFIData: L("Non-UEFI data"),
}));

/** The word for a node's kind. */
export function kindLabel(kind: string): string {
  return KIND_LABELS()[kind as UEFINodeKind] ?? kind;
}
