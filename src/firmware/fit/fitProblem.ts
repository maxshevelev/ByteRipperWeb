/**
 * Something wrong with the table, or with the image around it.
 *
 * Collected and shown, never thrown: a FIT worth opening a tool on is usually
 * one somebody has already edited by hand, and the defects are what the user
 * came to see. Each problem carries the offset to look at, so the panel can
 * send the dump there.
 */

export type FITSeverity =
  /** The table breaks a rule the specification states as one. */
  | "error"
  /** Worth saying, but the table still works. */
  | "warning";

export type FITProblemKind =
  | { readonly kind: "imageHasNoPointer" }
  | { readonly kind: "pointerLeadsOutsideTheImage"; readonly address: number }
  | { readonly kind: "noTableAtThePointer"; readonly address: number }
  | { readonly kind: "tableHasNoEntries" }
  | { readonly kind: "tableRunsPastTheEnd"; readonly entries: number }
  | { readonly kind: "firstEntryIsNotTheHeader"; readonly type: number }
  | { readonly kind: "secondHeader" }
  /**
   * Rows must not decrease in type: a FIT handler is allowed to stop looking at
   * the first type past the one it wants.
   */
  | { readonly kind: "typesOutOfOrder"; readonly previous: number; readonly type: number }
  | { readonly kind: "checksumMismatch"; readonly stored: number; readonly computed: number }
  | { readonly kind: "noMicrocodeEntry" }
  | { readonly kind: "addressOutsideTheImage"; readonly address: number }
  | { readonly kind: "addressNotAligned"; readonly address: number }
  /**
   * A microcode row pointing at something that is neither a microcode header
   * nor an empty slot — the defect that is the reason a tool must read what it
   * wrote an address to.
   */
  | { readonly kind: "notMicrocodeAtTheAddress"; readonly address: number }
  | { readonly kind: "reservedIsNotZero"; readonly value: number };

export interface FITProblem {
  readonly detail: FITProblemKind;
  /** The row it is about, when it is about one. */
  readonly entryIndex?: number | undefined;
  /** Where to send the dump. */
  readonly offset?: number | undefined;
}

export function fitSeverity(detail: FITProblemKind): FITSeverity {
  return detail.kind === "reservedIsNotZero" ? "warning" : "error";
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

export function fitProblemMessage(problem: FITProblem): string {
  const detail = problem.detail;
  switch (detail.kind) {
    case "imageHasNoPointer":
      return "The image is too small to hold a FIT pointer";
    case "pointerLeadsOutsideTheImage":
      return `The FIT pointer, ${hex(detail.address)}, is outside this image`;
    case "noTableAtThePointer":
      return `No FIT signature at ${hex(detail.address)}, where the pointer leads`;
    case "tableHasNoEntries":
      return "The header says the table has no entries";
    case "tableRunsPastTheEnd":
      return `The header claims ${detail.entries} entries, which runs past the end of the image`;
    case "firstEntryIsNotTheHeader":
      return `The first entry is type ${hex(detail.type)}, not the header`;
    case "secondHeader":
      return "A second header entry, where there may be only one";
    case "typesOutOfOrder":
      return (
        `Type ${hex(detail.type)} after type ${hex(detail.previous)}: ` +
        "entries must not decrease in type"
      );
    case "checksumMismatch":
      return `The table checksum is ${hex(detail.stored)}, and should be ${hex(detail.computed)}`;
    case "noMicrocodeEntry":
      return "No microcode entry, and there must be at least one";
    case "addressOutsideTheImage":
      return `${hex(detail.address)} is outside this image`;
    case "addressNotAligned":
      return `${hex(detail.address)} is not aligned to 16 bytes`;
    case "notMicrocodeAtTheAddress":
      return `No microcode header at ${hex(detail.address)}, and it is not an empty slot`;
    case "reservedIsNotZero":
      return `The reserved byte is ${hex(detail.value)}, and should be zero`;
  }
}
