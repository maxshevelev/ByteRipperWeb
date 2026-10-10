import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import {
  acerAssetTag,
  acerDMIAreaAt,
  acerFindingIsProblem,
  acerFindings,
  acerFindingText,
  acerManufacturingCode,
  acerModel,
  acerMotherboardSerial,
  acerProductName,
  acerSystemSerial,
  acerUUIDText,
} from "@/firmware/uefi/acerDmiStore";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { type DetailField, type DetailTable, field } from "@/tools/toolDetail";

/**
 * What the details say of Acer's DMI area (`acerDmiStore.ts`): the identity fields — the
 * system serial, the motherboard serial, the UUID, the model, product name — read off the
 * 8 KiB block, then what the integrity checks found in them.
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
 * The block's identity fields, in the order the bench asks them, then what the integrity
 * checks found in them — a problem where a factory block would not read that way, a note
 * where only the copy went stale.
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
  const fields: DetailField[] = [
    field(L("System serial"), acerSystemSerial(area)),
    field(L("MB Serial"), acerMotherboardSerial(area)),
    field(L("UUID"), acerUUIDText(area)),
    field(L("Model"), acerModel(area) || "—"),
  ];
  const asset = acerAssetTag(area);
  if (asset !== undefined) fields.push(field(L("Asset tag"), asset));
  fields.push(field(L("Product name"), acerProductName(area) || "—"));
  const code = acerManufacturingCode(area);
  if (code !== undefined) fields.push(field(L("Manufacturing code"), code));
  for (const finding of acerFindings(area)) {
    const problem = acerFindingIsProblem(finding);
    fields.push(field(problem ? L("Problem") : L("Note"), acerFindingText(finding), problem));
  }
  return { fields, tables: [] };
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
  if (area === undefined) return node.name;
  return L("%1$@ · %2$@", node.name, acerSystemSerial(area));
}
