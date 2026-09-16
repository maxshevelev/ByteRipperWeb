import { describe, expect, it } from "vitest";
import {
  ROW_MARK_SYMBOL,
  ROW_MARK_TINT,
  rowMarkSymbol,
  rowMarkTint,
} from "@/tools/toolRowMarkStyle";
import {
  ALL_ROW_MARKS,
  channelOrder,
  hasRail,
  NO_ROW_MARKS,
  ROW_MARK_CHANNEL,
  ROW_MARK_CHANNELS,
  type RowRole,
  roleMark,
  roleTooltip,
  rowMarkChannel,
  rowMarkMeaning,
  rowMarksSummary,
  rowRoles,
  worstProblem,
} from "@/tools/toolRowMarks";

/**
 * The row marks every firmware panel shares (`Design/ROW_MARKS.md`): the value,
 * and the one catalogue the rows and their legends both draw from.
 *
 * Ported from upstream's `ToolRowMarksTests` — the parts of it that are about
 * the value and the catalogue. What upstream reads back off a dressed AppKit
 * cell and off a layout pass has no counterpart here: this port dresses a row
 * with attributes React sets, and the legend is a component rather than a
 * stack view.
 */

describe("the value", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheWorstProblemIsTheOneShown
  it("shows the worst problem, and keeps the caution in the tooltip", () => {
    expect(worstProblem([], [])).toBeUndefined();
    expect(worstProblem([], ["c"])).toEqual({ isError: false, lines: ["c"] });
    expect(worstProblem(["e"], ["c"])).toEqual({ isError: true, lines: ["e", "c"] });
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheBackgroundAndTheRailAreSaidInWords
  it("says the background and the rail in words, so nothing is said by colour alone", () => {
    expect(rowMarksSummary(NO_ROW_MARKS)).toBeUndefined();
    expect(
      rowMarksSummary({ protection: "ibb", decompressedFrom: "Decompressed from LZMA at 0x60" })
    ).toBe("Inside the Boot Guard IBB · Decompressed from LZMA at 0x60");
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheSectionThatOpensWearsTheRailAndSaysWhy
  it("gives the section that opens the rail, and says why", () => {
    const opener = { opensDecompressed: true };
    expect(hasRail(opener)).toBe(true);
    expect(rowMarksSummary(opener)).toBe(
      "Compressed: what it holds is listed under it, decompressed"
    );
    expect(hasRail(NO_ROW_MARKS)).toBe(false);
  });

  it("reads the roles of a row that has none as none", () => {
    expect(rowRoles(NO_ROW_MARKS)).toEqual([]);
  });
});

describe("the catalogue", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testEveryIconMarkHasASymbolAndThePaintHasNone
  it("gives every icon mark a symbol, and the paint none", () => {
    for (const mark of ALL_ROW_MARKS) {
      const channel = rowMarkChannel(mark);
      const isPaint = channel === "background" || channel === "rail";
      expect(rowMarkSymbol(mark) === undefined, `${mark} is paint or is an icon`).toBe(isPaint);
      expect(rowMarkMeaning(mark).length, `${mark} says what it means`).toBeGreaterThan(0);
    }
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testVerdictsAreMarksOfTheCatalogue
  it("never lets a verdict take a problem's shape", () => {
    const problemSymbols = (["error", "caution"] as const).map((mark) => ROW_MARK_SYMBOL[mark]);
    for (const mark of ALL_ROW_MARKS) {
      if (rowMarkChannel(mark) !== "verdict") continue;
      expect(problemSymbols).not.toContain(rowMarkSymbol(mark));
    }
    expect(rowMarkSymbol("newerListed")).toBe("arrow.up.circle");
  });

  it("puts every mark in exactly one channel, and names each channel once", () => {
    const named = Object.values(ROW_MARK_CHANNEL);
    expect(new Set(named).size).toBe(ROW_MARK_CHANNELS.length);
    for (const mark of ALL_ROW_MARKS) {
      expect(ROW_MARK_CHANNELS).toContain(named[ALL_ROW_MARKS.indexOf(mark)]);
    }
    // Every channel's place is its own: the legend sorts by it.
    expect(ROW_MARK_CHANNELS.map(channelOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives every mark a palette entry", () => {
    for (const mark of ALL_ROW_MARKS) expect(rowMarkTint(mark)).toBe(ROW_MARK_TINT[mark]);
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMarks.Role.mark
  it("draws a role as the mark its kind and state name", () => {
    expect(roleMark({ kind: "compressed", algorithm: "LZMA", decoded: true })).toBe("compressed");
    expect(roleMark({ kind: "compressed", algorithm: "LZMA", decoded: false })).toBe(
      "compressedUndecoded"
    );
    expect(roleMark({ kind: "holdsChecks", words: "Holds the hashes" })).toBe("holdsChecks");
    expect(roleMark({ kind: "partlyProtected" })).toBe("partlyProtected");
  });

  it("gives a badge the pointer text its own state implies", () => {
    const opens: RowRole = { kind: "compressed", algorithm: "Huffman", decoded: true };
    const shut: RowRole = { kind: "compressed", algorithm: "Huffman", decoded: false };
    expect(roleTooltip(opens)).toBe("Huffman compressed data that opens here");
    expect(roleTooltip(shut)).toBe("Huffman compressed data that does not open here");
    expect(roleTooltip({ kind: "holdsChecks", words: "Holds the AMI vendor hash table" })).toBe(
      "Holds the AMI vendor hash table"
    );
    expect(roleTooltip({ kind: "partlyProtected" })).toBe(rowMarkMeaning("partlyProtected"));
  });
});

describe("the palette", () => {
  it("gives the two colours the catalogue reserves to the marks that own them", () => {
    // The tints a theme defines; the reserved colours have one owner each, so a
    // rose row means the same thing in every panel.
    expect(rowMarkTint("protectedIBB")).toBe("protectedIBB");
    expect(rowMarkTint("protectedFirmware")).toBe("protectedFirmware");
    expect(rowMarkTint("decompressed")).toBe("decompressed");
  });

  it("colours both 'not confirmed newest' verdicts the same", () => {
    // They differ in how sure we are, not in what kind of thing they are.
    expect(rowMarkTint("newerListed")).toBe(rowMarkTint("newerMaybe"));
  });

  it("gives the grey badge the grey palette entry", () => {
    for (const mark of ["compressedUndecoded", "holdsChecks", "partlyProtected"] as const) {
      expect(rowMarkTint(mark)).toBe("secondary");
      expect(rowMarkChannel(mark)).toBe("role");
    }
  });
});
