import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import {
  HP_DMI,
  type HPDMIArea,
  hpCTNumber,
  hpFindings,
  hpFindingText,
  hpProductFamily,
  hpProductName,
  hpSerialNumber,
  hpSKU,
  hpUUIDText,
  readHPDMIArea,
} from "@/firmware/uefi/hpDmiArea";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { type DetailField, type DetailTable, field } from "@/tools/toolDetail";

/**
 * What the details say of HP's identity (`hpDmiArea.ts`), on the `HP_MUD` entry it is read
 * from: the fields BCU reports — the serial number, the SKU, the family, the CT number, the
 * product name, the UUID — then the build ID, the feature byte and the asset tracking number
 * from the variables beside it, and what a technician should know before trusting them.
 *
 * A row keeps only its place, so the store's entries are read again from the file on each
 * selection: a few hundred headers, read in microseconds.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail
 */

/**
 * The store `node` is an entry of, when it is a VSS one.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.store
 */
export function hpStoreOf(node: UEFINode, image: UEFIImage): UEFINode | undefined {
  if (node.kind !== "vssEntry" || !isFileSpace(node.space) || node.id.length === 0) {
    return undefined;
  }
  const store = image.node(node.id.slice(0, -1));
  return store?.kind === "vssStore" || store?.kind === "vss2Store" ? store : undefined;
}

/**
 * The area `node` is the `HP_MUD` entry of — with the store already in hand, as a tree row has
 * its parent; nothing for any other node.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.area
 */
export function hpDMIAreaOf(
  node: UEFINode,
  store: UEFINode | undefined,
  reader: ImageReader
): HPDMIArea | undefined {
  if (node.kind !== "vssEntry" || node.guid === undefined) return undefined;
  if (!guidEquals(node.guid, HP_DMI.factoryGuid)) return undefined;
  if (store === undefined || (store.kind !== "vssStore" && store.kind !== "vss2Store")) {
    return undefined;
  }
  const area = readHPDMIArea(store, reader);
  const range = nodeRange(node);
  return area !== undefined && area.entry.start === range.start && area.entry.end === range.end
    ? area
    : undefined;
}

/**
 * The fields, in the order BCU lists them, then the notes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.build
 */
export function hpDMIDetail(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): { fields: DetailField[]; tables: DetailTable[] } {
  const area = hpDMIAreaOf(node, hpStoreOf(node, image), reader);
  if (area === undefined) return { fields: [], tables: [] };
  const shown = (text: string | undefined) =>
    text === undefined || text.length === 0 ? "—" : text;
  const fields: DetailField[] = [
    field(L("Serial number"), shown(hpSerialNumber(area))),
    field(L("SKU"), shown(hpSKU(area))),
    field(L("Product family"), shown(hpProductFamily(area))),
    field(L("CT number"), shown(hpCTNumber(area))),
    field(L("Product name"), shown(hpProductName(area))),
    field(L("UUID"), hpUUIDText(area)),
    field(L("Build ID"), shown(area.buildID)),
    field(L("Feature byte"), shown(area.featureByte)),
    field(L("Asset tracking number"), shown(area.assetTag)),
  ];
  for (const finding of hpFindings(area)) fields.push(field(L("Note"), hpFindingText(finding)));
  return { fields, tables: [] };
}

/**
 * `HP_MUD · 5CD4432P9B`: the variable's name and the serial number it holds — on a copy the
 * store marks deleted too, which UEFITool would call Invalid; the rest is in the detail.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.row
 * @upstream-differs the panel holds no bytes, so the worker reads the text
 */
export function hpDMIRowText(
  node: UEFINode,
  store: UEFINode | undefined,
  reader: ImageReader
): string | undefined {
  const area = hpDMIAreaOf(node, store, reader);
  return area === undefined ? undefined : L("%1$@ · %2$@", HP_DMI.mudName, hpSerialNumber(area));
}
