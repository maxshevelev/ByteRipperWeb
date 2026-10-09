import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";
import {
  isCertificateList,
  type NvramBasis,
  type NvramSignatureList,
  type NvramValue,
  readNvramValue,
} from "@/firmware/uefi/nvramValue";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { readVssEntry } from "@/firmware/uefi/vssVariable";
import { cell, type DetailField, type DetailTable, field } from "@/tools/toolDetail";

// help: panel.uefi.variable-value
/**
 * How a variable's value reads (`NvramValue`): in a tree row, after the variable's
 * name, and in full in the detail list — each as its type. Text as text, in quotes;
 * a number in decimal, with its hex where the two differ; a boot entry by its
 * description; a path in the spec's text form.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText
 */

/**
 * The longest value a row shows before it cuts the rest off.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.rowLimit
 */
export const ROW_LIMIT = 80;
/**
 * The most bytes the detail list spells out of a value it cannot read.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.detailByteLimit
 */
const DETAIL_BYTE_LIMIT = 256;
/**
 * The most bytes a row spells out of a value it cannot read otherwise.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.rowByteLimit
 */
const ROW_BYTE_LIMIT = 8;

/**
 * The row: `BootOrder = 0003, 2001`, `Lang = "eng"`, `WRDD = 00 50 41`,
 * `Setup (1686 bytes)`. Just the name for an empty value.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.row
 */
export function nvramValueRow(name: string, value: NvramValue, bytes: Uint8Array): string {
  if (value.content.kind === "bytes" && bytes.length <= ROW_BYTE_LIMIT) {
    return `${name} = ${hexBytes(bytes)}`;
  }
  const text = shortText(value);
  if (text === undefined) {
    return value.content.kind === "empty" ? name : L("%1$@ (%2$@ bytes)", name, `${bytes.length}`);
  }
  // Counted in characters, not code units, as the row is cut.
  const characters = [...text];
  return `${name} = ${characters.length > ROW_LIMIT ? `${characters.slice(0, ROW_LIMIT).join("")}…` : text}`;
}

/**
 * The value in a row's words; nothing where it is only bytes too many to spell, or
 * nothing at all.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.short
 */
function shortText(value: NvramValue): string | undefined {
  const content = value.content;
  switch (content.kind) {
    case "empty":
    case "bytes":
      return undefined;
    case "number":
      return numberText(content.value);
    case "optionList":
      return content.numbers.map((number) => hex4(number)).join(", ");
    case "optionNumber":
      return `Boot${hex4(content.number)}`;
    case "text":
      // A line break would break the row.
      return `"${[...content.text].map((one) => (one === "\n" || one === "\r" || one === "\t" ? " " : one)).join("")}"`;
    case "devicePath":
      return content.path;
    case "loadOption":
      return content.option.description.length === 0
        ? content.option.devicePath
        : content.option.description;
    case "signatures":
      return signaturesText(content.lists);
    case "hardwareErrorRecord":
      return L("Hardware error record");
  }
}

/**
 * The fields the detail list gives the value: the value whole, what it was read as
 * and by what, and the parts of a load option.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.fields
 */
export function nvramValueFields(value: NvramValue, bytes: Uint8Array): DetailField[] {
  const fields: DetailField[] = [];
  const content = value.content;
  switch (content.kind) {
    case "empty":
      fields.push(field(L("Value"), L("Empty")));
      break;
    case "optionList":
      fields.push(
        field(L("Value"), content.numbers.map((number) => `Boot${hex4(number)}`).join(", "))
      );
      break;
    case "text":
      fields.push(field(L("Value"), content.text));
      break;
    case "loadOption": {
      const option = content.option;
      fields.push(field(L("Value"), option.description));
      fields.push(field("Load option attributes", loadOptionBits(option.attributes)));
      fields.push(field(L("Device path"), option.devicePath ?? L("Not readable")));
      if (option.optionalDataSize > 0) {
        fields.push(field(L("Optional data"), L("%1$@ bytes", `${option.optionalDataSize}`)));
      }
      break;
    }
    case "bytes":
    case "hardwareErrorRecord":
      fields.push(field(L("Value"), hexBytes(bytes)));
      break;
    default:
      fields.push(field(L("Value"), shortText(value) ?? ""));
  }
  fields.push(field(L("Read as"), L("%1$@ — %2$@", kindText(value), basisText(value.basis))));
  return fields;
}

/**
 * The signatures of a database one row each — a certificate by its subject — except
 * hashes, which are counted per list: a `dbx` holds hundreds, and none of them reads
 * as anything.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.signaturesTable
 */
export function nvramSignaturesTable(value: NvramValue): DetailTable | undefined {
  if (value.content.kind !== "signatures") return undefined;
  const rows: ReturnType<typeof cell>[][] = [];
  for (const list of value.content.lists) {
    const type = list.typeName ?? guidTextOf(list);
    if (isCertificateList(list)) {
      for (const signature of list.signatures) {
        rows.push([
          cell(type),
          cell(signature.subject ?? L("No name")),
          cell(ownerText(signature.owner)),
        ]);
      }
    } else {
      const owners = new Set(list.signatures.map((one) => ownerText(one.owner)));
      const only = owners.size === 1 ? [...owners][0] : undefined;
      rows.push([
        cell(type),
        cell(L("Entries: %1$@", `${list.signatures.length}`)),
        cell(only ?? L("Several")),
      ]);
    }
  }
  return {
    title: L("Signatures"),
    symbol: "checkmark.seal",
    columns: [L("Type"), L("Subject"), L("Owner")],
    rows,
  };
}

// MARK: - Words

/**
 * A number in decimal, and in hex as well where the two read differently: `1`,
 * `300 (0x12C)`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.numberText
 */
export function numberText(number: bigint): string {
  return number < 10n ? `${number}` : `${number} (0x${number.toString(16).toUpperCase()})`;
}

/**
 * One certificate by its subject; anything more counted by type, in the order the
 * database lists them: `X.509: 3, SHA-256: 371`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.signaturesText
 */
function signaturesText(lists: readonly NvramSignatureList[]): string {
  const all = lists.flatMap((list) => list.signatures);
  const first = lists.find((list) => list.signatures.length > 0);
  if (all.length === 1 && first !== undefined && isCertificateList(first)) {
    const subject = all[0]?.subject;
    if (subject !== undefined) return subject;
  }
  const counts: [string, number][] = [];
  for (const list of lists) {
    const type = list.typeName ?? guidTextOf(list);
    const found = counts.find((one) => one[0] === type);
    if (found === undefined) counts.push([type, list.signatures.length]);
    else found[1] += list.signatures.length;
  }
  return counts.map(([type, count]) => `${type}: ${count}`).join(", ");
}

/** @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.kindText */
function kindText(value: NvramValue): string {
  const content = value.content;
  switch (content.kind) {
    case "empty":
      return L("No value");
    case "number":
      return L("%1$@-bit number", `${content.size * 8}`);
    case "optionList":
      return L("List of boot entries");
    case "optionNumber":
      return L("Boot entry number");
    case "text":
      return content.encoding === "ascii" ? L("ASCII text") : L("UCS-2 text");
    case "devicePath":
      return L("Device path");
    case "loadOption":
      return L("Boot entry");
    case "signatures":
      return L("Signature database");
    case "hardwareErrorRecord":
      return L("Hardware error record");
    case "bytes":
      return L("Bytes");
  }
}

/** @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.basisText */
function basisText(basis: NvramBasis): string {
  switch (basis) {
    case "specification":
      return L("as the UEFI specification defines the variable");
    case "name":
      return L("by its name, which the UEFI specification defines; the GUID is a vendor's");
    case "attributes":
      return L("by its attributes");
    case "content":
      return L("guessed from the bytes");
  }
}

/**
 * `EFI_LOAD_OPTION`'s attribute bits, in the spec's words.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.bits
 */
function loadOptionBits(attributes: number): string {
  const words: string[] = [];
  if ((attributes & 0x1) !== 0) words.push("Active");
  if ((attributes & 0x2) !== 0) words.push("ForceReconnect");
  if ((attributes & 0x8) !== 0) words.push("Hidden");
  if ((attributes & 0x1f00) === 0x100) words.push("App");
  const text = `0x${attributes.toString(16).toUpperCase()}`;
  return words.length === 0 ? text : `${text} (${words.join(", ")})`;
}

/**
 * Bytes as a dump prints them, up to `detailByteLimit`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/NvramValueText.swift#NvramValueText.hexBytes
 */
export function hexBytes(bytes: Uint8Array): string {
  const shown = [...bytes.subarray(0, DETAIL_BYTE_LIMIT)]
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
  if (bytes.length <= DETAIL_BYTE_LIMIT) return shown;
  return L("%1$@ … (%2$@ bytes in all)", shown, `${bytes.length}`);
}

const hex4 = (number: number): string => number.toString(16).toUpperCase().padStart(4, "0");

/**
 * The longest value a variable's row reads: a signature database is the longest
 * there is to read as a type, and a `dbx` grows to tens of KiB.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.valueRowReadLimit
 */
export const VALUE_ROW_READ_LIMIT = 0x10000;

/**
 * `name = value`, the value read as its type. A value too long to be one of the types
 * a row spells out is not read: a row is drawn on every scroll.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.valueRow
 */
export function variableValueRow(
  name: string,
  guid: EFIGUID | undefined,
  attributes: number,
  range: ImageRange,
  reader: ImageReader
): string {
  const length = range.end - range.start;
  const value = length <= VALUE_ROW_READ_LIMIT ? reader.bytes(range) : undefined;
  if (value === undefined) return L("%1$@ (%2$@ bytes)", name, `${length}`);
  return nvramValueRow(name, readNvramValue(name, guid, attributes, value), value);
}

/**
 * A live VSS variable's row with its value after the name, as its type reads, or an
 * NVAR variable's, on the entry that holds it now: a link of a chain holds a value a
 * later entry replaced. A VSS value lies where its store's format puts it, which is
 * why the store is asked for. Nothing for any other node, and where the value is not
 * read.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.baseName
 */
export function variableRowOf(
  node: UEFINode,
  store: UEFINode | undefined,
  reader: ImageReader | undefined
): string | undefined {
  if (node.name.length === 0 || reader === undefined) return undefined;
  if (node.kind === "vssEntry") {
    if (node.subtype === Sub.invalidVssEntry) return undefined;
    const variable = readVssEntry(node, store?.kind === "vss2Store", reader);
    if (variable === undefined) return undefined;
    return variableValueRow(
      node.name,
      variable.vendorGuid,
      variable.attributes,
      variable.data,
      reader
    );
  }
  if (node.kind !== "nvarEntry") return undefined;
  if (node.subtype !== Sub.fullNvarEntry && node.subtype !== Sub.dataNvarEntry) return undefined;
  return variableValueRow(
    node.name,
    node.guid,
    nvarValueAttributes(node, reader),
    node.body,
    reader
  );
}

/**
 * An NVAR entry's attributes in the VSS bits `NvramValue` reads: its own byte keeps
 * the hardware error record flag at `0x20`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.nvarAttributes
 */
export function nvarValueAttributes(entry: UEFINode, reader: ImageReader): number {
  const attributes = reader.uint8(entry.header.start + 9);
  if (attributes === undefined) return 0;
  return (attributes & 0x20) !== 0 ? 0x8 : 0;
}

const guidTextOf = (list: NvramSignatureList): string => guidText(list.type);
const ownerText = (owner: EFIGUID): string => guidText(owner);
