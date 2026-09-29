import { L, localized } from "@/core/localization/localization";
import type { LibraryConflict, LibraryResolution } from "@/core/search/patternLibrary";
import { encodingTitle } from "@/core/search/searchPattern";
import type { SearchPatternEntry } from "@/core/search/searchPatternEntry";
import { conflictId } from "@/core/sync/syncMerge";

/**
 * How the questions a merge could not answer read (§11).
 *
 * The merge decides *what* the question is; this decides how it reads — the
 * naming is the view's business, which is why it is not beside the model. One
 * row per conflict: what happened is that two sides said different things about
 * *this pattern*, and "renamed here, deleted in the file" reads as what it is.
 *
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SyncPresentable
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SearchPatternEntry
 */

/**
 * What names an entry in a question: its name, or the pattern itself where it
 * has none.
 *
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SyncPresentable.label
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SearchPatternEntry.label
 */
export function entryLabel(entry: SearchPatternEntry): string {
  return entry.name === "" ? entry.pattern : entry.name;
}

/**
 * What one side holds, in full: the name *and* the pattern. Two sides often
 * disagree about the pattern under the same name, and a row reading "Test for
 * ASCII" against "Test for ASCII" asks the user to choose between two identical
 * things.
 *
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SyncPresentable.summary
 * @upstream ByteRipperApp/Search/SyncPresentation.swift#SearchPatternEntry.summary
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.describe
 */
export function entrySummary(entry: SearchPatternEntry): string {
  const named = entry.name === "" ? "" : `${entry.name}: `;
  return `${named}"${entry.pattern}"  ${encodingTitle(entry.encoding)}`;
}

/**
 * The words for the two sides, which depend on where the other side came from:
 * a file imported by hand now, the shared folder later.
 *
 * @web-only upstream has one other side, the shared library, and names it inline
 */
export interface ConflictWording {
  /** This side, as a column title and as a choice. */
  readonly ours: string;
  /** The other side, as a column title. */
  readonly theirs: string;
  /** The other side as a choice, short enough for the popup. */
  readonly theirsChoice: string;
  /** An entry the other side changed while this side deleted it, said whole. */
  readonly changedThere: (summary: string) => string;
  /** An entry the other side deleted, when it can say which side that was. */
  readonly deletedThere: string;
  /** The sentence under the title. */
  readonly message: string;
}

/**
 * A library file opened with Import….
 *
 * @web-only upstream has no import
 */
export const IMPORT_WORDING: () => ConflictWording = localized(() => ({
  ours: L("This Browser"),
  theirs: L("Imported File"),
  theirsChoice: L("File"),
  changedThere: (summary) => L("%1$@ — changed in the imported file", summary),
  deletedThere: L("Deleted in the imported file"),
  message: L(
    "This browser and the imported file hold the same patterns and say different things about them. Choose which to keep."
  ),
}));

/**
 * The library folder: other machines' files, merged with this browser's.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.init
 */
export const SHARED_WORDING: () => ConflictWording = localized(() => ({
  ours: L("This Browser"),
  theirs: L("Shared Library"),
  theirsChoice: L("Shared"),
  changedThere: (summary) => L("%1$@ — changed on another machine", summary),
  deletedThere: L("Deleted on another machine"),
  message: L(
    "This browser and the shared library were both changed before either saw the other. Choose which to keep."
  ),
}));

/** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.init */
export function conflictTitle(count: number): string {
  return count === 1 ? L("One conflicting change") : L("%1$@ conflicting changes", count);
}

/**
 * What the row is about: the entry, by the name this side has for it.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.pattern
 */
export function conflictSubject(conflict: LibraryConflict): string {
  return entryLabel(conflict.kind === "editedAndDeleted" ? conflict.entry : conflict.ours);
}

/** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ourSide */
export function ourSide(conflict: LibraryConflict): string {
  if (conflict.kind !== "editedAndDeleted") return entrySummary(conflict.ours);
  return conflict.deletedHere
    ? L("Deleted here")
    : L("%1$@ — changed here", entrySummary(conflict.entry));
}

/** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.theirSide */
export function theirSide(conflict: LibraryConflict, wording: ConflictWording): string {
  if (conflict.kind !== "editedAndDeleted") return entrySummary(conflict.theirs);
  if (conflict.deletedHere) return wording.changedThere(entrySummary(conflict.entry));
  return conflict.deletedBy === "" ? L("Deleted") : wording.deletedThere;
}

/**
 * "Keep both" means two entries, which is only an answer where the two are
 * genuinely different searches — §11 keeps one search once.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.allowsKeepingBoth
 */
export function allowsKeepingBoth(conflict: LibraryConflict): boolean {
  return conflict.kind === "bothEdited";
}

/** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.choices */
export function resolutionChoices(conflict: LibraryConflict): readonly LibraryResolution[] {
  return allowsKeepingBoth(conflict)
    ? ["keepOurs", "keepTheirs", "keepBoth"]
    : ["keepOurs", "keepTheirs"];
}

/**
 * What each choice is called, in {@link resolutionChoices}' order — always this
 * side first, as every other row reads.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.titles
 */
export function resolutionTitles(
  conflict: LibraryConflict,
  wording: ConflictWording
): readonly string[] {
  if (conflict.kind === "editedAndDeleted") {
    return conflict.deletedHere
      ? [L("The deletion"), L("Their version")]
      : [L("Mine"), L("The deletion")];
  }
  return allowsKeepingBoth(conflict)
    ? [wording.ours, wording.theirsChoice, L("Both")]
    : [wording.ours, wording.theirsChoice];
}

/**
 * Every question answered the same way: the starting point with `keepOurs` — the
 * state already shown, so leaving the sheet alone changes nothing — and the bulk
 * buttons, for someone who knows which side was right.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.setAll
 */
export function answeringAll(
  conflicts: readonly LibraryConflict[],
  resolution: LibraryResolution
): Map<string, LibraryResolution> {
  return new Map(conflicts.map((conflict) => [conflictId(conflict), resolution]));
}
