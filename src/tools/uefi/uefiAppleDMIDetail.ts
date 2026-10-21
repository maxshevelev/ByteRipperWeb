import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import {
  type AppleDMIArea,
  appleFindings,
  appleFindingText,
  appleValues,
  readAppleDMIArea,
} from "@/firmware/uefi/appleDmiArea";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { displayName, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { DetailField, DetailTable } from "@/tools/toolDetail";
import { dmiEntriesTable, dmiFindings } from "@/tools/uefi/uefiDMIEntries";

/**
 * What the details say of Apple's identity (`appleDmiArea.ts`), on the SysF store it is read
 * from: the serial number, the configuration code, the sales order number and the board's
 * serial, then what a technician should know before trusting them.
 *
 * A row keeps only its place, so the store's entries are read again from the file on each
 * selection: a few dozen headers, read in microseconds.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAppleDMIDetail.swift#UEFIAppleDMIDetail
 */

/**
 * The area `node` is the SysF store of; nothing for any other node.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAppleDMIDetail.swift#UEFIAppleDMIDetail.area
 */
export function appleDMIAreaOf(node: UEFINode, reader: ImageReader): AppleDMIArea | undefined {
  if (node.kind !== "sysFStore" || !isFileSpace(node.space)) return undefined;
  return readAppleDMIArea(node, reader);
}

/**
 * The fields, in the order a Mac's own tools list them, then the notes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAppleDMIDetail.swift#UEFIAppleDMIDetail.build
 */
export function appleDMIDetail(
  node: UEFINode,
  reader: ImageReader
): { fields: DetailField[]; tables: DetailTable[] } {
  const area = appleDMIAreaOf(node, reader);
  if (area === undefined) return { fields: [], tables: [] };
  const fields = dmiFindings(
    appleFindings(area).map((finding) => ({ text: appleFindingText(finding), isProblem: false }))
  );
  const rows = appleValues(area).map((one) => ({
    name: one.name.text,
    value: one.value,
    source: one.entry,
  }));
  return { fields, tables: [dmiEntriesTable(rows, node.children)] };
}

/**
 * `Apple SysF store · C02QMDJVG940`: the store's name and the serial it holds, or the board's
 * where the store keeps no serial.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAppleDMIDetail.swift#UEFIAppleDMIDetail.row
 * @upstream-differs the panel holds no bytes, so the worker reads the text
 */
export function appleDMIRowText(node: UEFINode, reader: ImageReader): string | undefined {
  const area = appleDMIAreaOf(node, reader);
  const who = area?.serialNumber ?? area?.boardSerial;
  return who === undefined ? undefined : L("%1$@ · %2$@", displayName(node), who);
}
