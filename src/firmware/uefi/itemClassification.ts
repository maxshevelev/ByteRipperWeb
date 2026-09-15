import { type EFIGUID, guid, guidEquals } from "@/firmware/uefi/efiGuid";
import { ffsVersionOfFileSystem } from "@/firmware/uefi/knownGuids";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub } from "@/firmware/uefi/uefiTypes";

/**
 * The UEFITool classification of a node in this tree: which `Types::ItemTypes`
 * it is, and, when the node has one, which subtype.
 *
 * This is the bridge between the node model — which carries a kind, a one-byte
 * subtype, and a GUID — and UEFITool's classification, which the structure
 * tree's Type and Subtype columns show. The mapping reads what the parser
 * actually stored, so a node and its classification cannot disagree: the same
 * node classifies the same way on every parse.
 */

const ITEM_TYPE_OF_KIND: Readonly<Record<UEFINode["kind"], number>> = {
  capsule: ItemType.capsule,
  intelImage: ItemType.image,
  uefiImage: ItemType.image,
  region: ItemType.region,
  flashDescriptor: ItemType.region,
  volume: ItemType.volume,
  file: ItemType.file,
  section: ItemType.section,
  microcode: ItemType.intelMicrocode,
  vssStore: ItemType.vssStore,
  vss2Store: ItemType.vss2Store,
  ftwStore: ItemType.ftwStore,
  fdcStore: ItemType.fdcStore,
  sysFStore: ItemType.sysFStore,
  flashMapStore: ItemType.phoenixFlashMapStore,
  evsaStore: ItemType.evsaStore,
  cmdbStore: ItemType.cmdbStore,
  slicData: ItemType.slicData,
  vssEntry: ItemType.vssEntry,
  sysFEntry: ItemType.sysFEntry,
  evsaEntry: ItemType.evsaEntry,
  flashMapEntry: ItemType.phoenixFlashMapEntry,
  padding: ItemType.padding,
  freeSpace: ItemType.freeSpace,
  // Data nobody claimed is a run of bytes with a type, not a structure, so it
  // reads as a file the way a raw region does.
  nonUEFIData: ItemType.file,
};

/**
 * The `Types::ItemTypes` code this node is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIItemClassification.swift#UEFINode.uefiItemType
 */
export function itemType(node: UEFINode): number {
  return ITEM_TYPE_OF_KIND[node.kind];
}

/**
 * The subtype code, when the node has one. Nothing where there is nothing to
 * say: free space, and the Intel microcode, which is one kind and no more.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIItemClassification.swift#UEFINode.uefiItemSubtype
 */
export function itemSubtype(node: UEFINode): number | undefined {
  switch (node.kind) {
    case "capsule":
      return node.guid === undefined ? undefined : capsuleSubtype(node.guid);
    case "intelImage":
      return Sub.intelImage;
    case "uefiImage":
      return Sub.uefiImage;
    // The descriptor's region type, the one the parser read off the table.
    case "region":
      return node.subtype;
    case "flashDescriptor":
      return Sub.descriptorRegion;
    case "volume":
      return volumeSubtype(node);
    case "file":
    case "section":
      return node.subtype;
    case "microcode":
      return undefined;
    // A store is one kind and no more: its type byte is the item type, and the
    // entry subtypes live on the children, not on the store.
    case "vssStore":
    case "vss2Store":
    case "ftwStore":
    case "fdcStore":
    case "sysFStore":
    case "flashMapStore":
    case "evsaStore":
    case "cmdbStore":
      return undefined;
    // An entry and a SLIC blob carry the subtype the parser derived — the byte
    // is not on the node, the parser worked it out from the header.
    case "slicData":
    case "vssEntry":
    case "sysFEntry":
    case "evsaEntry":
    case "flashMapEntry":
      return node.subtype;
    case "padding":
      return paddingSubtype(node);
    case "freeSpace":
    case "nonUEFIData":
      return undefined;
  }
}

// MARK: - The subtypes that are not a byte on the node

const APTIO_SIGNED = guid("4A3CA68B-7723-48FB-803D-578CC1FEC44D");
const APTIO_UNSIGNED = guid("14EEBB90-890A-43DB-AED1-5D3C4588A418");
const TOSHIBA = guid("3BE07062-1D51-45D2-832B-F093257ED461");
const NVRAM_STORE = guid("FFF12B8D-7696-4C8B-A985-2747075B4F50");
const NVRAM_ADDITIONAL_STORE = guid("00504624-8A59-4EEB-BD0F-6B36E96128E0");
const APPLE_MICROCODE_FV = guid("153D2197-29BD-44DC-AC59-887F70E41A6B");

/**
 * Which capsule, by its GUID: the Aptio and Toshiba ones are named, the rest
 * read as a plain UEFI capsule.
 */
function capsuleSubtype(candidate: EFIGUID): number {
  if (guidEquals(candidate, APTIO_SIGNED)) return Sub.aptioSignedCapsule;
  if (guidEquals(candidate, APTIO_UNSIGNED)) return Sub.aptioUnsignedCapsule;
  if (guidEquals(candidate, TOSHIBA)) return Sub.toshibaCapsule;
  return Sub.uefiCapsule;
}

/**
 * The file system a volume body is read as, by its file-system GUID.
 *
 * FFSv1 and FFSv2 bodies are read the same way here, so both classify as FFSv2
 * — the version the tree's volume column has always shown.
 */
function volumeSubtype(node: UEFINode): number {
  const candidate = node.guid;
  if (candidate === undefined) return Sub.unknownVolume;
  const version = ffsVersionOfFileSystem(candidate);
  if (version === 1 || version === 2) return Sub.ffs2Volume;
  if (version === 3) return Sub.ffs3Volume;
  if (guidEquals(candidate, NVRAM_STORE) || guidEquals(candidate, NVRAM_ADDITIONAL_STORE)) {
    return Sub.nvramVolume;
  }
  if (guidEquals(candidate, APPLE_MICROCODE_FV)) return Sub.appleMicrocodeVolume;
  return Sub.unknownVolume;
}

/**
 * What a run of padding is filled with.
 *
 * The parser says only whether a run is all the erase byte; which byte that is
 * depends on the polarity in force, and the node does not carry it. So an
 * erased run is shown as the polarity's byte — 0xFF, the default outside a
 * volume — and a live one as data.
 */
function paddingSubtype(node: UEFINode): number {
  return node.isErased ? Sub.onePadding : Sub.dataPadding;
}
