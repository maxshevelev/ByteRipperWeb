import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import {
  acerDMIAreaAt,
  acerFields,
  acerFindingIsProblem,
  acerFindings,
  acerFindingText,
  acerSystemSerial,
} from "@/firmware/uefi/acerDmiStore";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { displayName, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { DetailField, DetailTable } from "@/tools/toolDetail";
import { dmiEntriesTable, dmiEntryRows, dmiFindings } from "@/tools/uefi/uefiDMIEntries";

/**
 * What the details say of Acer's DMI area (`acerDmiStore.ts`): what the integrity checks found
 * in the 8 KiB block, then its fields — the system serial, the motherboard serial, the UUID, the
 * model, the product name — each a way to its row under the block's.
 *
 * A row keeps only its place, so the block is read again from the file on each selection:
 * 8 KiB, read in microseconds.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAcerDMIDetail.swift#UEFIAcerDMIDetail
 */

/**
 * The kinds this reads.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAcerDMIDetail.swift#UEFIAcerDMIDetail.reads
 */
export const readsAcerDMI = (kind: string): boolean => kind === "acerDMIStore";

/**
 * What the integrity checks found — a problem where a factory block would not read that way, a
 * note where only the copy went stale — then the fields, in the order the bench asks them.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAcerDMIDetail.swift#UEFIAcerDMIDetail.build
 */
export function acerDMIDetail(
  node: UEFINode,
  reader: ImageReader
): { fields: DetailField[]; tables: DetailTable[] } {
  if (!isFileSpace(node.space) || !readsAcerDMI(node.kind)) return { fields: [], tables: [] };
  const area = acerDMIAreaAt(reader, node.body.start);
  if (area === undefined) return { fields: [], tables: [] };
  const fields = dmiFindings(
    acerFindings(area).map((finding) => ({
      text: acerFindingText(finding),
      isProblem: acerFindingIsProblem(finding),
    }))
  );
  return {
    fields,
    tables: [dmiEntriesTable(dmiEntryRows(acerFields(area), reader), node.children)],
  };
}

/**
 * `Acer DMI · N51…`: the area's name and the system serial it holds; the tag, the UUID, the
 * model and the product name are in the detail.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.acerDMIRow
 * @upstream-differs the panel holds no bytes, so the worker reads the text
 */
export function acerDMIRowText(node: UEFINode, reader: ImageReader): string {
  const area = acerDMIAreaAt(reader, node.body.start);
  if (area === undefined) return displayName(node);
  return L("%1$@ · %2$@", displayName(node), acerSystemSerial(area));
}
