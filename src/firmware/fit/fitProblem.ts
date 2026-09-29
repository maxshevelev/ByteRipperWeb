import { L } from "@/core/localization/localization";
import type { ImageRange } from "@/firmware/imageReader";

/**
 * Something wrong with the table, or with the image around it.
 *
 * Collected and shown, never thrown: a FIT worth opening a tool on is usually
 * one somebody has already edited by hand, and the defects are what the user
 * came to see. Each problem carries the offset to look at, so the panel can
 * send the dump there.
 */

/** @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.Severity */
export type FITSeverity =
  /** The table breaks a rule the specification states as one. */
  | "error"
  /** Worth saying, but the table still works. */
  | "warning";

/**
 * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.Kind
 * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.kind
 */
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
  | { readonly kind: "reservedIsNotZero"; readonly value: number }
  /**
   * The image keeps a Top Swap backup of the block the FIT is in, and there is
   * no table where the backup's pointer leads.
   */
  | { readonly kind: "topSwapBackupHasNoTable"; readonly backupAt: number }
  /** The backup's FIT is not byte for byte this one. */
  | { readonly kind: "topSwapTableDiffers"; readonly at: number }
  /** A backup row, or what it points at inside the block, is not the same as the top block's. */
  | { readonly kind: "topSwapEntryDiffers" }
  /**
   * The backup holds the same FIT, but other bytes of the block differ — which
   * is what refuses a microcode change until the copies agree.
   */
  | { readonly kind: "topSwapBlockDiffers"; readonly backup: ImageRange };

/** @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem */
export interface FITProblem {
  readonly detail: FITProblemKind;
  /**
   * The row it is about, when it is about one.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.entryIndex
   */
  readonly entryIndex?: number | undefined;
  /**
   * Where to send the dump.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.offset
   */
  readonly offset?: number | undefined;
  /**
   * Found in the Top Swap backup's copy of the table rather than in the table
   * itself: `entryIndex` is a row of that copy.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.inBackup
   * @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.init
   */
  readonly inBackup?: boolean | undefined;
}

/** @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.severity */
export function fitSeverity(detail: FITProblemKind): FITSeverity {
  switch (detail.kind) {
    case "reservedIsNotZero":
    case "topSwapBackupHasNoTable":
    case "topSwapTableDiffers":
    case "topSwapEntryDiffers":
    case "topSwapBlockDiffers":
      return "warning";
    default:
      return "error";
  }
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/** @upstream Modules/FITTool/Sources/FITTool/FITProblem.swift#FITProblem.message */
export function fitProblemMessage(problem: FITProblem): string {
  const own = ownMessage(problem.detail);
  return problem.inBackup === true ? L("Top Swap backup: %1$@", own) : own;
}

function ownMessage(detail: FITProblemKind): string {
  switch (detail.kind) {
    case "imageHasNoPointer":
      return L("The image is too small to hold a FIT pointer");
    case "pointerLeadsOutsideTheImage":
      return L("The FIT pointer, %1$@, is outside this image", hex(detail.address));
    case "noTableAtThePointer":
      return L("No FIT signature at %1$@, where the pointer leads", hex(detail.address));
    case "tableHasNoEntries":
      return L("The header says the table has no entries");
    case "tableRunsPastTheEnd":
      return L(
        "The header claims %1$@ entries, which runs past the end of the image",
        detail.entries
      );
    case "firstEntryIsNotTheHeader":
      return L("The first entry is type %1$@, not the header", hex(detail.type));
    case "secondHeader":
      return L("A second header entry, where there may be only one");
    case "typesOutOfOrder":
      return L(
        "Type %1$@ after type %2$@: entries must not decrease in type",
        hex(detail.type),
        hex(detail.previous)
      );
    case "checksumMismatch":
      return L(
        "The table checksum is %1$@, and should be %2$@",
        hex(detail.stored),
        hex(detail.computed)
      );
    case "noMicrocodeEntry":
      return L("No microcode entry, and there must be at least one");
    case "addressOutsideTheImage":
      return L("%1$@ is outside this image", hex(detail.address));
    case "addressNotAligned":
      return L("%1$@ is not aligned to 16 bytes", hex(detail.address));
    case "notMicrocodeAtTheAddress":
      return L("No microcode header at %1$@, and it is not an empty slot", hex(detail.address));
    case "reservedIsNotZero":
      return L("The reserved byte is %1$@, and should be zero", hex(detail.value));
    case "topSwapBackupHasNoTable":
      return L(
        "The Top Swap backup at %1$@ has no FIT where its pointer leads",
        hex(detail.backupAt)
      );
    case "topSwapTableDiffers":
      return L("The Top Swap backup's FIT at %1$@ is not the same as this one", hex(detail.at));
    case "topSwapEntryDiffers":
      return L("this entry, or what it points at, is not the same as in the top block");
    case "topSwapBlockDiffers":
      return L(
        "The Top Swap backup at %1$@ holds the same FIT, but other bytes of the block differ, so microcode changes are refused until the copies agree",
        hex(detail.backup.start)
      );
  }
}
