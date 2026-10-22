import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { checksumText, sum8Of } from "@/firmware/uefi/checksums";
import {
  type PanasonicDMIArea,
  panasonicDirectoryChecksum,
  panasonicDirectoryChecksumIsValid,
  panasonicFields,
  panasonicModel,
  panasonicRecordChecksumIsValid,
  panasonicRecordHeader,
  panasonicRecordIdText,
  panasonicRecordMeaning,
  panasonicSerial,
  readPanasonicDMIArea,
} from "@/firmware/uefi/panasonicDmiStore";
import { displayName, flattened, type UEFINode } from "@/firmware/uefi/uefiNode";
import { cell, type DetailField, type DetailTable, field } from "@/tools/toolDetail";
import { dmiEntriesTable, dmiEntryRows } from "@/tools/uefi/uefiDMIEntries";

/**
 * What the details say of Panasonic's DMI area (`panasonicDmiStore.ts`): which of its checksums
 * fail, the identity fields it holds — the model, the asset tag, the serial, the Windows product
 * key — each a way to its row, then its directory: the records it lists, each a way to its row
 * too, with whether its checksum holds. What most records hold is not known, and the table says
 * so rather than guessing.
 *
 * A row keeps only its place, so the area is read again from the file on each selection: its
 * header and its records, summed.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail
 */

/**
 * The kinds this reads.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.reads
 */
export const readsPanasonicDMI = (kind: string): boolean => kind === "panasonicDMIStore";

/**
 * The area `node` is, read from the file.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.area
 */
const areaOf = (node: UEFINode, reader: ImageReader): PanasonicDMIArea | undefined =>
  readPanasonicDMIArea(node.body.start, node.body.end, reader);

/** What a record of `id` holds, in words; "Unknown" where nobody knows. */
const holds = (id: number | undefined): string =>
  (id === undefined ? undefined : panasonicRecordMeaning(id))?.text ?? L("Unknown");

/**
 * Which sums fail, the identity fields, and the directory.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.build
 */
export function panasonicDMIDetail(
  node: UEFINode,
  reader: ImageReader
): { fields: DetailField[]; tables: DetailTable[] } {
  if (!isFileSpace(node.space) || !readsPanasonicDMI(node.kind)) return { fields: [], tables: [] };
  const area = areaOf(node, reader);
  if (area === undefined) return { fields: [], tables: [] };
  const all = flattened(node);
  const fields: DetailField[] = [];
  if (!area.headerChecksumIsValid) {
    fields.push(field(L("Problem"), L("The header's first 0x80 bytes do not sum to 0."), true));
  }
  const directoryValid = panasonicDirectoryChecksumIsValid(area);
  fields.push(
    field(
      L("Directory checksum"),
      checksumText({
        value: panasonicDirectoryChecksum(area),
        valid: directoryValid,
        expected: directoryValid ? undefined : area.expectedDirectoryChecksum,
      }),
      !directoryValid
    )
  );
  const failing = area.records.filter((record) => !panasonicRecordChecksumIsValid(record)).length;
  if (failing > 0) {
    fields.push(
      field(L("Problem"), L("%1$@ of the records fail their checksum.", `${failing}`), true)
    );
  }
  const entries = dmiEntriesTable(
    dmiEntryRows(
      panasonicFields(area).map((one) => one.field),
      reader
    ),
    all
  );
  const records: DetailTable = {
    title: L("Directory"),
    symbol: "list.bullet.rectangle",
    columns: [L("ID"), L("Address"), L("Length"), L("Checksum"), L("Holds")],
    rows: area.records.map((record) => {
      const valid = panasonicRecordChecksumIsValid(record);
      return [
        cell(panasonicRecordIdText(record.id)),
        cell(`0x${record.address.toString(16).toUpperCase().padStart(8, "0")}`),
        cell(`0x${(record.range.end - record.range.start).toString(16).toUpperCase()}`),
        cell(valid ? L("OK") : L("Invalid"), valid ? "yes" : "no"),
        cell(holds(record.id)),
      ];
    }),
    rowTargets: area.records.map((record) => {
      const row = all.find(
        (one) =>
          one.kind === "panasonicDMIRecord" &&
          one.header.start === record.range.start &&
          one.body.end === record.range.end
      );
      return row === undefined ? undefined : { kind: "node", path: row.id };
    }),
    linkColumn: 0,
  };
  return { fields, tables: [entries, records] };
}

/**
 * A record's header: its ID, its length and its checksum — whether the record's bytes sum to 0
 * with it, and the byte that would make them — and what the record holds.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.recordFields
 */
export function panasonicDMIRecordFields(node: UEFINode, reader: ImageReader): DetailField[] {
  if (node.kind !== "panasonicDMIRecord") return [];
  const bytes = reader.bytes(node.header);
  const header = bytes === undefined ? undefined : panasonicRecordHeader(bytes);
  const sum = sum8Of({ start: node.header.start, end: node.body.end }, reader);
  if (header === undefined || sum === undefined) return [];
  const fields: DetailField[] = [];
  if (node.subtype !== undefined) fields.push(field(L("ID"), panasonicRecordIdText(node.subtype)));
  fields.push(field(L("Length"), `0x${header.length.toString(16).toUpperCase()}`));
  const valid = sum === 0;
  fields.push(
    field(
      L("Checksum"),
      checksumText({
        value: header.checksum,
        valid,
        expected: valid ? undefined : (header.checksum - sum) & 0xff,
      }),
      !valid
    )
  );
  fields.push(field(L("Holds"), holds(node.subtype)));
  return fields;
}

/**
 * `Panasonic DMI · FZ55-2 · 1613…`: the area's name, the model and the serial it holds; the rest
 * is in the detail.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.row
 * @upstream-differs the panel holds no bytes, so the worker reads the text
 */
export function panasonicDMIRowText(node: UEFINode, reader: ImageReader): string {
  const area = areaOf(node, reader);
  if (area === undefined) return displayName(node);
  return [panasonicModel(area), panasonicSerial(area) ?? ""]
    .filter((part) => part.length > 0)
    .reduce((row, part) => L("%1$@ · %2$@", row, part), displayName(node));
}

/**
 * `Record 0x16 · Windows product key`: a record's name and what it holds, where that is known.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPanasonicDMIDetail.swift#UEFIPanasonicDMIDetail.recordRow
 */
export function panasonicDMIRecordRow(
  node: Pick<UEFINode, "subtype" | "name" | "nameText">
): string {
  const meaning = node.subtype === undefined ? undefined : panasonicRecordMeaning(node.subtype);
  const name = displayName(node);
  return meaning === undefined ? name : L("%1$@ · %2$@", name, meaning.text);
}
