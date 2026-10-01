/**
 * Which glossary entry explains the node the reader is looking at.
 *
 * The panel names structures nobody meets outside a firmware bench — a VSS
 * store, a pad file, a flash descriptor — and the `?` beside the detail list
 * answers "what *is* this row" for the node in focus. That mapping is a
 * function of the node's kind and subtype, so it lives here, in pure code a
 * test can read, rather than being decided in a view.
 *
 * Nothing for a node the glossary has nothing to say about beyond what its own
 * row already says. The panel then draws no button, which is the honest answer:
 * a `?` that opens a page saying "a section is a section" is worse than no `?`
 * at all.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHelpTerms.swift#UEFIHelpTerms
 */

import { type HelpTermId, termId } from "@/core/help/helpIds";
import { type EFIGUID, guidEquals, guidFromText } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import type { UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * All the mapping reads of a node: its kind and its subtype.
 *
 * Stated as the two fields rather than as a `UEFINode`, because the panel asks
 * this about a node that has come over the wire from the worker, and that one
 * is the same two facts without the ranges.
 *
 * @upstream-differs upstream takes the `UEFINode` itself, its panel having the
 * parsed tree in the same process
 */
export interface UEFINodeSort {
  readonly kind: UEFINodeKind | string;
  readonly subtype?: number | undefined;
  /**
   * A map region's type is its GUID — as the parsed node has it, or as text
   * where the node has come over the wire from the worker.
   */
  readonly guid?: EFIGUID | string | undefined;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIHelpTerms.swift#UEFIHelpTerms.term */
export function uefiHelpTerm(node: UEFINodeSort): HelpTermId | undefined {
  switch (node.kind) {
    case "capsule":
      return termId("capsule");
    case "intelImage":
    case "uefiImage":
      return termId("dump");
    case "flashDescriptor":
      return termId("flash-descriptor");
    case "region":
      return regionTerm(node.subtype);
    case "volume":
      return termId("volume");
    // A pad file is a file only in the sense that every slot in a volume has a
    // header. Naming it as one would send the reader to the page about files,
    // which is not what they are looking at.
    case "file":
      return node.subtype === 0xf0 ? termId("pad-file") : termId("ffs-file");
    case "section":
      return termId("section");
    case "microcode":
      return termId("microcode");
    // The Startup AP data lives in a pad file and is why that pad file must
    // stay where it is; the page about pad files says so.
    case "startupApData":
      return termId("pad-file");
    case "padding":
      return termId("padding");
    case "freeSpace":
      return termId("free-space");
    case "nonUEFIData":
      return termId("non-uefi-data");
    case "slicData":
      return termId("slic");
    // Every NVRAM store and every entry in one goes to the same entry: what a
    // variable store holds. The formats differ by vendor and the difference is
    // not what a reader on a bench is asking about.
    case "vssStore":
    case "vss2Store":
    case "ftwStore":
    case "fdcStore":
    case "sysFStore":
    case "flashMapStore":
    case "evsaStore":
    case "cmdbStore":
    case "vssEntry":
    case "sysFEntry":
    case "evsaEntry":
    case "flashMapEntry":
      return termId("vss");
    // Insyde's map holds no variables: it lays out the chip.
    case "flashDeviceMapStore":
    case "flashDeviceMapEntry":
      return termId("flash-device-map");
    case "flashDeviceMapRegion":
      return mapRegionTerm(node.guid);
    // AMI's store is the exception, because what a reader asks of it is
    // different: which of a variable's entries holds its value now.
    case "nvarEntry":
    case "nvarGuidStore":
      return termId("nvar");
    default:
      // A kind nobody has written an entry for: no button, which is the honest
      // answer rather than a `?` that opens nothing.
      return undefined;
  }
}

/**
 * A map region whose type has a page of its own goes there — the EC firmware,
 * the default variables — and the rest to the page about the map, which says
 * what its regions are.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHelpTerms.swift#UEFIHelpTerms.mapRegion
 */
function mapRegionTerm(type: EFIGUID | string | undefined): HelpTermId {
  const guid = typeof type === "string" ? guidFromText(type) : type;
  if (guid !== undefined && guidEquals(guid, FlashDeviceMap.ecFirmware)) {
    return termId("ec-firmware");
  }
  if (guid !== undefined && guidEquals(guid, FlashDeviceMap.variableDefaults)) {
    return termId("vss");
  }
  return termId("flash-device-map");
}

/**
 * A region row goes to the page about that particular region where there is one
 * — which region a reader is standing in is the most useful thing the panel can
 * explain — and to the general one otherwise.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHelpTerms.swift#UEFIHelpTerms.region
 */
function regionTerm(subtype: number | undefined): HelpTermId {
  switch (subtype) {
    case Sub.descriptorRegion:
      return termId("flash-descriptor");
    case Sub.biosRegion:
    case Sub.bios2Region:
      return termId("bios-region");
    case Sub.meRegion:
      return termId("me-region");
    case Sub.gbeRegion:
      return termId("gbe-region");
    case Sub.pdrRegion:
      return termId("pdr-region");
    case Sub.ecRegion:
      return termId("ec-region");
    case Sub.microcodeRegion:
      return termId("microcode");
    default:
      return termId("region");
  }
}
