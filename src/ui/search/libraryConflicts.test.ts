import { describe, expect, it } from "vitest";
import type { LibraryConflict } from "@/core/search/patternLibrary";
import { searchPatternEntry } from "@/core/search/searchPatternEntry";
import {
  answeringAll,
  conflictSubject,
  conflictTitle,
  entryLabel,
  entrySummary,
  IMPORT_WORDING,
  ourSide,
  resolutionChoices,
  resolutionTitles,
  theirSide,
} from "@/ui/search/libraryConflicts";

// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testTheSheetShowsBothSidesOfEachConflict

const fpt = searchPatternEntry({
  name: "Intel ME FPT",
  pattern: "$FPT",
  encoding: "ascii",
  caseSensitive: false,
});
const renamed = { ...fpt, name: "ME region table" };

describe("what a side says", () => {
  it("names an entry by its name, or by its pattern where it has none", () => {
    expect(entryLabel(fpt)).toBe("Intel ME FPT");
    expect(entryLabel({ ...fpt, name: "" })).toBe("$FPT");
  });

  it("gives the name and the pattern, so two sides under one name still differ", () => {
    expect(entrySummary(fpt)).toBe('Intel ME FPT: "$FPT"  ASCII');
    expect(entrySummary({ ...fpt, name: "" })).toBe('"$FPT"  ASCII');
  });
});

describe("a row of the resolver", () => {
  it("shows both sides of each conflict, and starts on this side's", () => {
    const conflict: LibraryConflict = { kind: "bothEdited", ours: fpt, theirs: renamed };

    expect(conflictSubject(conflict)).toBe("Intel ME FPT");
    expect(ourSide(conflict)).toContain("Intel ME FPT");
    expect(ourSide(conflict)).toContain('"$FPT"');
    expect(theirSide(conflict, IMPORT_WORDING)).toContain("ME region table");
    expect(theirSide(conflict, IMPORT_WORDING)).toContain('"$FPT"');
    expect(answeringAll([conflict], "keepOurs").get(fpt.id)).toBe("keepOurs");
  });

  it("offers both only where the two are different searches", () => {
    const edited: LibraryConflict = { kind: "bothEdited", ours: fpt, theirs: renamed };
    const duplicate: LibraryConflict = { kind: "duplicate", ours: fpt, theirs: renamed };

    expect(resolutionChoices(edited)).toEqual(["keepOurs", "keepTheirs", "keepBoth"]);
    expect(resolutionTitles(edited, IMPORT_WORDING)).toEqual(["This Browser", "File", "Both"]);
    expect(resolutionChoices(duplicate)).toEqual(["keepOurs", "keepTheirs"]);
    expect(resolutionTitles(duplicate, IMPORT_WORDING)).toEqual(["This Browser", "File"]);
  });

  it("says which side deleted, and which side changed", () => {
    const deletedThere: LibraryConflict = {
      kind: "editedAndDeleted",
      entry: fpt,
      deletedBy: "OTHER",
      deletedHere: false,
    };
    expect(ourSide(deletedThere)).toBe('Intel ME FPT: "$FPT"  ASCII — changed here');
    expect(theirSide(deletedThere, IMPORT_WORDING)).toBe("Deleted in the imported file");
    expect(theirSide({ ...deletedThere, deletedBy: "" }, IMPORT_WORDING)).toBe("Deleted");
    expect(resolutionTitles(deletedThere, IMPORT_WORDING)).toEqual(["Mine", "The deletion"]);

    const deletedHere: LibraryConflict = { ...deletedThere, deletedHere: true };
    expect(ourSide(deletedHere)).toBe("Deleted here");
    expect(theirSide(deletedHere, IMPORT_WORDING)).toBe(
      'Intel ME FPT: "$FPT"  ASCII — changed in the imported file'
    );
    expect(resolutionTitles(deletedHere, IMPORT_WORDING)).toEqual([
      "The deletion",
      "Their version",
    ]);
    expect(resolutionChoices(deletedHere)).toEqual(["keepOurs", "keepTheirs"]);
  });

  it("answers every row at once for someone who knows which side was right", () => {
    const other = { ...fpt, id: "0F3C8A1E-2B4D-4E6F-8A9B-1C2D3E4F5A6B" };
    const conflicts: LibraryConflict[] = [
      { kind: "bothEdited", ours: fpt, theirs: renamed },
      { kind: "duplicate", ours: other, theirs: renamed },
    ];
    expect([...answeringAll(conflicts, "keepTheirs")]).toEqual([
      [fpt.id, "keepTheirs"],
      [other.id, "keepTheirs"],
    ]);
  });

  it("counts the questions in its title", () => {
    expect(conflictTitle(1)).toBe("One conflicting change");
    expect(conflictTitle(3)).toBe("3 conflicting changes");
  });
});
