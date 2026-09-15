import { FIT, isHeaderEntry } from "@/firmware/fit/fitEntry";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import { checksumIsCorrect, type FITRow, type FITTable } from "@/firmware/fit/fitTable";

/**
 * The invariants of the specification, each one checked and each one named.
 *
 * They are worth having as a list rather than as scattered conditions, because
 * the list *is* the deliverable: a bench opens this panel to be told what a
 * hand edit broke, and "types out of order at entry 5" is the whole answer.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITValidator.swift#FITValidator
 * @upstream Modules/FITTool/Sources/FITTool/FITValidator.swift#FITValidator.problems
 */
export function problemsIn(table: FITTable): FITProblem[] {
  const problems: FITProblem[] = [];

  // The first entry is the header.
  const first = table.rows[0]?.entry;
  if (first !== undefined && !isHeaderEntry(first)) {
    problems.push({
      detail: { kind: "firstEntryIsNotTheHeader", type: first.type },
      entryIndex: 0,
      offset: first.offset + 0x0e,
    });
  }

  // The checksum, but only when the header says it counts.
  if (table.checksumIsChecked && !checksumIsCorrect(table)) {
    problems.push({
      detail: {
        kind: "checksumMismatch",
        stored: table.storedChecksum,
        computed: table.computedChecksum,
      },
      entryIndex: 0,
      offset: table.range.start + 0x0f,
    });
  }

  let previousType: number | undefined;
  for (const row of table.rows.slice(1)) {
    const entry = row.entry;

    // One header only.
    if (isHeaderEntry(entry)) {
      problems.push({
        detail: { kind: "secondHeader" },
        entryIndex: entry.index,
        offset: entry.offset + 0x0e,
      });
    }
    // Types do not decrease.
    if (previousType !== undefined && entry.type < previousType) {
      problems.push({
        detail: { kind: "typesOutOfOrder", previous: previousType, type: entry.type },
        entryIndex: entry.index,
        offset: entry.offset + 0x0e,
      });
    }
    previousType = entry.type;

    // Reserved is zero, except on a CSE SecureBoot entry, where it is the
    // subtype.
    if (entry.reserved !== 0 && entry.type !== FIT.cseSecureBootType) {
      problems.push({
        detail: { kind: "reservedIsNotZero", value: entry.reserved },
        entryIndex: entry.index,
        offset: entry.offset + 0x0b,
      });
    }

    problems.push(...addressProblems(row));
  }

  // At least one microcode entry.
  if (!table.rows.some((row) => row.entry.type === FIT.microcodeType)) {
    problems.push({ detail: { kind: "noMicrocodeEntry" }, offset: table.range.start });
  }
  return problems;
}

/** The three that are about where a row points, and the ones a mistyped address trips. */
function addressProblems(row: FITRow): FITProblem[] {
  const entry = row.entry;
  switch (row.target.kind) {
    case "nothing":
    case "indexIORegisters":
      return [];
    case "outsideTheImage":
      return [
        {
          detail: { kind: "addressOutsideTheImage", address: entry.address },
          entryIndex: entry.index,
          offset: entry.offset,
        },
      ];
    default: {
      const problems: FITProblem[] = [];
      if (entry.address % 16 !== 0) {
        problems.push({
          detail: { kind: "addressNotAligned", address: entry.address },
          entryIndex: entry.index,
          offset: entry.offset,
        });
      }
      if (entry.type === FIT.microcodeType && row.target.kind === "bytes") {
        problems.push({
          detail: { kind: "notMicrocodeAtTheAddress", address: entry.address },
          entryIndex: entry.index,
          offset: entry.offset,
        });
      }
      return problems;
    }
  }
}
