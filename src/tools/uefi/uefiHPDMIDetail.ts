import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import {
  HP_FACTORY_GUID,
  HP_MUD_NAME,
  type HPDMIArea,
  hpFields,
  hpFindings,
  hpFindingText,
  hpSerialNumber,
  readHPDMIArea,
} from "@/firmware/uefi/hpDmiArea";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { DetailField, DetailTable } from "@/tools/toolDetail";
import {
  type DMIEntryRow,
  dmiEntriesTable,
  dmiEntryRows,
  dmiFindings,
} from "@/tools/uefi/uefiDMIEntries";

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

const isVssStore = (node: UEFINode): boolean =>
  node.kind === "vssStore" || node.kind === "vss2Store";

/**
 * The store `node` is an entry of, when it is a VSS one.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.store
 */
export function hpDMIStoreOf(node: UEFINode, image: UEFIImage): UEFINode | undefined {
  if (node.kind !== "vssEntry" || !isFileSpace(node.space) || node.id.length === 0) {
    return undefined;
  }
  const store = image.node(node.id.slice(0, -1));
  return store !== undefined && isVssStore(store) ? store : undefined;
}

/**
 * The area `node` is the `HP_MUD` entry of, with its store in hand — a tree row has its
 * parent; nothing for any other node.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.area
 */
export function hpDMIAreaOf(
  node: UEFINode,
  store: UEFINode | undefined,
  reader: ImageReader,
  read: (store: UEFINode, reader: ImageReader) => HPDMIArea | undefined = readHPDMIArea
): HPDMIArea | undefined {
  if (node.kind !== "vssEntry" || node.guid === undefined) return undefined;
  if (!guidEquals(node.guid, HP_FACTORY_GUID)) return undefined;
  if (store === undefined || !isVssStore(store)) return undefined;
  const area = read(store, reader);
  if (area === undefined) return undefined;
  const range = nodeRange(node);
  return area.entry.start === range.start && area.entry.end === range.end ? area : undefined;
}

/**
 * The same, with the store looked up in `image`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.area
 */
export const hpDMIAreaIn = (
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): HPDMIArea | undefined => hpDMIAreaOf(node, hpDMIStoreOf(node, image), reader);

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
  const store = hpDMIStoreOf(node, image);
  const area = hpDMIAreaOf(node, store, reader);
  if (store === undefined || area === undefined) return { fields: [], tables: [] };
  const fields = dmiFindings(
    hpFindings(area).map((finding) => ({ text: hpFindingText(finding), isProblem: false }))
  );
  const rows: DMIEntryRow[] = [
    ...dmiEntryRows(hpFields(area), reader),
    { name: L("Build ID"), value: area.buildID, source: area.buildIDEntry },
    { name: L("Feature byte"), value: area.featureByte, source: area.featureByteEntry },
    { name: L("Asset tracking number"), value: area.assetTag, source: area.assetTagEntry },
  ];
  return { fields, tables: [dmiEntriesTable(rows, [...node.children, ...store.children])] };
}

/**
 * `HP_MUD · 5CD4432P9B`: the variable's name and the serial number it holds — on a copy the
 * store marks deleted too, which UEFITool would call Invalid; the rest is in the detail.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIHPDMIDetail.swift#UEFIHPDMIDetail.row
 * @upstream-differs the panel holds no bytes, so the worker reads the text and hands it over
 * as the wire node's `valueRow`, with `isHPDMIArea` set
 */
export function hpDMIRowText(
  node: UEFINode,
  store: UEFINode | undefined,
  reader: ImageReader,
  read?: (store: UEFINode, reader: ImageReader) => HPDMIArea | undefined
): string | undefined {
  const area = hpDMIAreaOf(node, store, reader, read);
  return area === undefined ? undefined : L("%1$@ · %2$@", HP_MUD_NAME, hpSerialNumber(area));
}
