import {
  type FITEntry,
  fitTypeName,
  isHeaderEntry,
  sizeInBytes,
  versionText,
} from "@/firmware/fit/fitEntry";
import { effectiveSize, type FITRow } from "@/firmware/fit/fitTable";
import { checksumText } from "@/firmware/uefi/checksums";
import { microcodeFields } from "@/firmware/uefi/microcodeParser";
import { fitHex as hex } from "@/tools/fit/fitText";

/**
 * What the panel says about the selected row: the row's own sixteen bytes, and
 * what its address leads to, read rather than assumed.
 *
 * Built here rather than in the component, and unit-tested, so the panel lays
 * out what this says rather than deciding anything.
 *
 * Ported from `Modules/FITTool/FITDetail.swift`.
 */

/** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetailField */
export interface FITDetailField {
  /** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetailField.label */
  readonly label: string;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetailField.value */
  readonly value: string;
  /**
   * A value that reads as a problem — a checksum that does not check out. The
   * panel colours just this row's value; everything else stays as it is, the
   * same way the UEFI detail marks its own.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetailField.isProblem
   */
  readonly isProblem: boolean;
}

/** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITRowDetail */
export interface FITRowDetail {
  /**
   * The row's place and type, named the way the zones name it.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITRowDetail.title
   */
  readonly title: string;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITRowDetail.fields */
  readonly fields: readonly FITDetailField[];
}

/** @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITRowDetail.empty */
export const EMPTY_DETAIL: FITRowDetail = { title: "", fields: [] };

/**
 * Reads a row and says what it is, field by field.
 *
 * The entry's own sixteen bytes come straight off the model, and what the row
 * points at was already read when the table was — a microcode header, an
 * Index/IO descriptor, a named region — so this reads nothing new: it only puts
 * what was found into the shape the panel draws.
 *
 * `checksumShouldBe` is the validator's word on the table's own checksum — the
 * one thing about the header row that cannot be read off the row, and the value
 * the header's Checksum field is coloured by and quotes when it reads wrong.
 * Nothing when the checksum checks out, or is not checked: the byte is valid
 * then, not a problem.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetail
 * @upstream Modules/FITTool/Sources/FITTool/FITDetail.swift#FITDetail.build
 */
export function buildDetail(
  row: FITRow,
  checksumShouldBe?: number | undefined,
  inBackup = false
): FITRowDetail {
  return {
    // The number the panel shows for the row, counting from one the way the
    // table and the zones do — not the header's zero, which is its place, not
    // its number.
    title: `${inBackup ? "Backup " : ""}#${row.entry.index + 1} ${fitTypeName(row.entry.type)}`,
    fields: [...entryFields(row.entry, checksumShouldBe), ...targetFields(row)],
  };
}

// MARK: - The sixteen bytes of the row itself

function entryFields(entry: FITEntry, checksumShouldBe: number | undefined): FITDetailField[] {
  // The type leads: it is what the row is, and the title already says it, so
  // the fields open with it rather than with where it sits.
  const fields: FITDetailField[] = [
    {
      label: "Type",
      value: `${fitTypeName(entry.type)} · ${hex(entry.type, 2)}`,
      isProblem: false,
    },
    { label: "Offset", value: hex(entry.offset, 8), isProblem: false },
    {
      label: "Address",
      value: isHeaderEntry(entry) ? "_FIT_" : hex(entry.address, 8),
      isProblem: false,
    },
    { label: "Size", value: sizeText(entry), isProblem: false },
    { label: "Revision", value: versionText(entry), isProblem: false },
  ];
  // The checksum byte is the header's, so it is shown on the header row and on
  // no other — a row that is not the header does not carry it.
  if (!isHeaderEntry(entry)) return fields;

  if (!entry.checksumValid) {
    // A header that says its checksum does not count says so in as many words:
    // the byte is not wrong, it is not looked at, and nothing about it is a
    // problem.
    fields.push({
      label: "Checksum",
      value: `${hex(entry.checksum, 2)} (Not checked)`,
      isProblem: false,
    });
    return fields;
  }
  // Valid means the byte counts *and* checks out — the same thing "Valid" means
  // everywhere else a checksum is read, so the word can be trusted. A wrong
  // byte says what it should be, which is the value a fix would write back.
  fields.push({
    label: "Checksum",
    value: checksumText({
      value: entry.checksum,
      valid: checksumShouldBe === undefined,
      expected: checksumShouldBe,
    }),
    isProblem: checksumShouldBe !== undefined,
  });
  return fields;
}

function sizeText(entry: FITEntry): string {
  // The header's `Size` counts entries, not bytes — the field everyone reads
  // wrong. For the rows that use it the field is in 16-byte units; what a
  // reader wants is the byte count.
  if (isHeaderEntry(entry)) return `${entry.size} rows`;
  // A row with no size of its own says so in the same word every empty area
  // does.
  return entry.size === 0 ? "Empty" : size(sizeInBytes(entry));
}

// MARK: - What the row points at

function targetFields(row: FITRow): FITDetailField[] {
  const target = row.target;
  switch (target.kind) {
    case "nothing":
      // The header and an empty slot point nowhere by design; the entry fields
      // above are the whole of what there is to say.
      return [];
    case "indexIORegisters": {
      // The first eight bytes, read as a descriptor of Index/IO registers
      // rather than as the pointer they are shaped like.
      const one = target.descriptor;
      return [
        { label: "Index register", value: hex(one.indexRegister, 4), isProblem: false },
        { label: "Data register", value: hex(one.dataRegister, 4), isProblem: false },
        {
          label: "Access width",
          value: `${one.accessWidth} byte${one.accessWidth === 1 ? "" : "s"}`,
          isProblem: false,
        },
        { label: "Bit position", value: `${one.bitPosition}`, isProblem: false },
        { label: "Index", value: hex(one.index, 4), isProblem: false },
      ];
    }
    case "outsideTheImage":
      return [{ label: "Points at", value: "outside this image", isProblem: false }];
    case "microcode":
      // The same reading the UEFI panel gives a microcode node
      // (`microcodeFields`), so the two say it in the same words.
      return microcodeFields(target.header).map(({ label, value, isProblem }) => ({
        label,
        value,
        isProblem,
      }));
    case "emptyMicrocodeSlot":
      return [
        { label: "Points at", value: "empty slot (FF FF FF FF)", isProblem: false },
        { label: "Component", value: hex(target.offset, 8), isProblem: false },
      ];
    case "bytes": {
      // "Points at" only once something has read there — see `targetText`. The
      // Component row below says where it is either way.
      const fields: FITDetailField[] = [];
      if (target.description !== undefined) {
        fields.push({ label: "Points at", value: target.description, isProblem: false });
      }
      fields.push({ label: "Component", value: hex(target.offset, 8), isProblem: false });
      const length = effectiveSize(row);
      if (length !== undefined)
        fields.push({ label: "Length", value: size(length), isProblem: false });
      return fields;
    }
  }
}

// MARK: - Text

/**
 * A size in bytes, said both ways: hex for the dump, decimal for the mind. Zero
 * is not worth two spellings — the area holds nothing, and the row says so.
 */
function size(bytes: number): string {
  return bytes === 0 ? "Empty" : `${hex(bytes)} (${bytes})`;
}
