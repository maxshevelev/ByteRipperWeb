import { describe, expect, it } from "vitest";
import type { ToolRowMarks } from "@/tools/toolRowMarks";
import { rowMarksBadges, rowMarkTitle, rowPaintAttrs } from "@/ui/toolPanel/RowMarks";

/**
 * How every firmware panel dresses a row (`Design/ROW_MARKS.md` §1, §2): what
 * it paints behind it, what the pointer reads on it, and which icons it draws.
 *
 * The same three decisions upstream splits between `ToolPanelRowView` and
 * `ToolPanelTable`, decided in functions rather than in elements so they can be
 * checked without a browser — the browser's half is whether the rules in the
 * stylesheet match the attribute names these produce, which the unit that owns
 * each attribute name is the check for.
 */

const rail: ToolRowMarks = {
  decompressedFrom: "Read out of the pm module, stored LZMA compressed",
};
const tinted: ToolRowMarks = { protection: "ibb" };
const both: ToolRowMarks = { protection: "firmware", ...rail };

describe("the paint", () => {
  it("names the tint after the protection and marks the rail with an empty attribute", () => {
    expect(rowPaintAttrs(tinted, true)).toEqual({ "data-tint": "protectedIBB" });
    expect(rowPaintAttrs({ protection: "firmware" }, true)).toEqual({
      "data-tint": "protectedFirmware",
    });
    expect(rowPaintAttrs(rail, true)).toEqual({ "data-rail": "" });
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheRowViewPaintsTheRailOnlyWhileMarkingsAreShown
  it("paints nothing with the markings off, and nothing for a row with no marks", () => {
    // The Show Markings switch: the row draws plain, and its icons — which are
    // elements, not paint — stay.
    expect(rowPaintAttrs(both, false)).toEqual({});
    expect(rowPaintAttrs(rail, false)).toEqual({});
    expect(rowPaintAttrs({}, true)).toEqual({});
    expect(rowPaintAttrs(undefined, true)).toEqual({});
  });

  it("gives a row wearing both both attributes, since they are separate channels", () => {
    expect(rowPaintAttrs(both, true)).toEqual({
      "data-tint": "protectedFirmware",
      "data-rail": "",
    });
  });

  it("never writes an attribute for paint the row does not wear", () => {
    // A rule matching `[data-tint]` must not match an empty one, or every row
    // in the panel would take the tint's layer.
    const attrs = rowPaintAttrs(rail, true);
    expect("data-tint" in attrs).toBe(false);
    expect(Object.values(rowPaintAttrs({}, true))).toEqual([]);
  });
});

describe("the row's tooltip", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheBackgroundAndTheRailAreSaidInWords
  it("says the background and the rail in words", () => {
    expect(rowMarkTitle(both)).toBe(
      "Inside a range the firmware checks at boot · Read out of the pm module, stored LZMA compressed"
    );
    expect(rowMarkTitle(tinted)).toBe("Inside the Boot Guard IBB");
  });

  it("leaves a row that paints nothing without a tooltip, so its cells' survive", () => {
    expect(rowMarkTitle({})).toBeUndefined();
    expect(rowMarkTitle(undefined)).toBeUndefined();
    // A row whose whole mark is an icon has nothing to say here: the icon's own
    // title carries it.
    expect(
      rowMarkTitle({ problem: { isError: true, lines: ["Invalid checksum"] } })
    ).toBeUndefined();
  });
});

describe("the icons", () => {
  it("draws nothing for a row with no marks and no verdict", () => {
    expect(rowMarksBadges(undefined)).toEqual([]);
    expect(rowMarksBadges({})).toEqual([]);
  });

  it("puts the verdict first, then the problem, then the badges", () => {
    const marks: ToolRowMarks = {
      problem: { isError: false, lines: ["The reserved byte is 0x1, and should be zero"] },
      roles: [{ kind: "holdsChecks", words: "Holds the hashes" }],
    };
    const badges = rowMarksBadges(marks, { mark: "newest", toolTip: "Newest" });

    expect(badges.map((badge) => badge.mark)).toEqual(["newest", "caution", "holdsChecks"]);
  });

  it("draws the problem as an error or a caution by what it is", () => {
    expect(rowMarksBadges({ problem: { isError: true, lines: ["bad"] } })[0]?.mark).toBe("error");
    expect(rowMarksBadges({ problem: { isError: false, lines: ["hmm"] } })[0]?.mark).toBe(
      "caution"
    );
  });

  it("puts every problem line in the pointer's reach, and names the icon", () => {
    const badges = rowMarksBadges({
      problem: { isError: true, lines: ["Invalid $CPD CRC-32 checksum", "and the manifest's"] },
    });

    expect(badges[0]?.title).toBe("Invalid $CPD CRC-32 checksum\nand the manifest's");
    expect(badges[0]?.label).toBe("Invalid");
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable.badgeTags
  it("draws at most two badges, the first two the panel named", () => {
    const three: ToolRowMarks = {
      roles: [
        { kind: "holdsChecks", words: "first" },
        { kind: "compressed", algorithm: "LZMA", decoded: true },
        { kind: "partlyProtected" },
      ],
    };

    const badges = rowMarksBadges(three);
    expect(badges).toHaveLength(2);
    expect(badges.map((badge) => badge.mark)).toEqual(["holdsChecks", "compressed"]);
  });

  it("leaves out a mark the row does not wear, rather than drawing it invisible", () => {
    // An icon a row does not wear takes no room (§1): a row with no problem
    // draws no problem icon, and one with no verdict draws none either.
    expect(rowMarksBadges({ roles: [] })).toEqual([]);
    expect(rowMarksBadges({})).toEqual([]);
    // The verdict is the panel's, not the row's: it is drawn even for a row
    // that wears nothing else, because a row only gets one when it has one.
    expect(rowMarksBadges({}, { mark: "newest", toolTip: "Newest" })).toHaveLength(1);
  });

  it("gives a badge the words its own state implies", () => {
    const opens = rowMarksBadges({
      roles: [{ kind: "compressed", algorithm: "Huffman", decoded: true }],
    });
    const shut = rowMarksBadges({
      roles: [{ kind: "compressed", algorithm: "Huffman", decoded: false }],
    });

    expect(opens[0]?.mark).toBe("compressed");
    expect(opens[0]?.title).toBe("Huffman compressed data that opens here");
    expect(shut[0]?.mark).toBe("compressedUndecoded");
    expect(shut[0]?.title).toBe("Huffman compressed data that does not open here");
  });
});
