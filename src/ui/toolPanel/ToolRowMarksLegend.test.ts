import { describe, expect, it } from "vitest";
import { rowMarkMeaning, type ToolRowMark } from "@/tools/toolRowMarks";
import {
  expandedKey,
  offersShowMarkings,
  orderedMarks,
  showsMarkingsKey,
} from "@/ui/toolPanel/ToolRowMarksLegend";

/**
 * The legend's decisions (`Design/ROW_MARKS.md` §6) — upstream's
 * `ToolRowMarksTests`' legend half.
 *
 * What upstream reads off a laid-out stack view has no counterpart here: this
 * legend's lines and margins are the stylesheet's, and the browser is the thing
 * that lays them out. What is decided in code — which lines, in which order, and
 * whether the switch is offered at all — is decided in pure functions so it can
 * be checked without a window.
 */

describe("the lines", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheLegendListsThePanelsMarksInChannelOrder
  it("lists one line per mark the panel draws, in the channels' order", () => {
    // Named the way a panel names them — the panel's own order inside a channel
    // is nothing the reading order should follow.
    const listed = orderedMarks(["compressed", "error", "decompressed"]);

    expect(listed).toEqual(["decompressed", "error", "compressed"]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testVerdictsAreMarksOfTheCatalogue
  it("puts a panel's verdicts in the verdicts' place, between the rail and the problems", () => {
    expect(orderedMarks(["error", "newerListed", "newest"])).toEqual([
      "newerListed",
      "newest",
      "error",
    ]);
  });

  it("groups by channel without touching the list it was handed", () => {
    // Within a channel the order is the panel's own — which is why the panels
    // list their marks in the catalogue's order — and across channels it is the
    // reading order §6 fixes, which is what this sorts.
    const panelOrder: readonly ToolRowMark[] = ["holdsChecks", "compressed", "caution", "error"];
    const listed = orderedMarks(panelOrder);
    const channelOf = (mark: ToolRowMark) =>
      mark === "error" || mark === "caution" ? "problem" : "role";

    expect(listed.map(channelOf)).toEqual(["problem", "problem", "role", "role"]);
    expect([...listed].sort()).toEqual([...panelOrder].sort());
    expect(panelOrder).toEqual(["holdsChecks", "compressed", "caution", "error"]);
  });

  it("lists every mark it is given, each once", () => {
    const many: readonly ToolRowMark[] = ["error", "caution", "partlyProtected", "decompressed"];
    const listed = orderedMarks(many);

    expect([...listed].sort()).toEqual([...many].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("gives every line the catalogue's own words for its mark", () => {
    // The same table the rows are dressed from, so a line and its mark cannot
    // drift apart.
    for (const mark of orderedMarks(["error", "decompressed", "newest"])) {
      expect(rowMarkMeaning(mark).length).toBeGreaterThan(0);
    }
  });
});

describe("the Show Markings switch", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolRowMarksTests.swift#ToolRowMarksTests.testTheSwitchIsOfferedOnlyToAPanelThatPaints
  it("is offered only where there is paint to hide", () => {
    expect(offersShowMarkings(["newest", "error"])).toBe(false);
    expect(offersShowMarkings(["error", "decompressed"])).toBe(true);
    expect(offersShowMarkings(["protectedIBB"])).toBe(true);
    expect(offersShowMarkings([])).toBe(false);
  });

  it("is offered to the FIT table for nothing, and to the ME tree for its rail", () => {
    // The two panels as they stand: the FIT table draws icons only, the ME tree
    // has a real rail (G1 is a UEFI gap, not an ME one).
    const fit: readonly ToolRowMark[] = [
      "newest",
      "newerListed",
      "newerMaybe",
      "error",
      "caution",
      "holdsChecks",
    ];
    const me: readonly ToolRowMark[] = [
      "decompressed",
      "error",
      "caution",
      "compressed",
      "compressedUndecoded",
      "holdsChecks",
    ];

    expect(offersShowMarkings(fit)).toBe(false);
    expect(offersShowMarkings(me)).toBe(true);
  });
});

describe("what is remembered", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.expandedKey
  it("remembers each state per panel, under upstream's own names", () => {
    expect(expandedKey("UEFIStructure")).toBe("byteripper.rowMarksLegendExpanded.UEFIStructure");
    expect(showsMarkingsKey("MEAnalyzer")).toBe("byteripper.rowMarksShown.MEAnalyzer");
    expect(showsMarkingsKey("FIT")).toBe("byteripper.rowMarksShown.FIT");
    // Different panels, different keys: one panel's choice is not another's.
    expect(expandedKey("FIT")).not.toBe(expandedKey("MEAnalyzer"));
    expect(showsMarkingsKey("FIT")).not.toBe(expandedKey("FIT"));
  });

  it("puts every panel's states under the project's own prefix", () => {
    for (const panel of ["UEFIStructure", "MEAnalyzer", "FIT"]) {
      expect(expandedKey(panel).startsWith("byteripper.")).toBe(true);
      expect(showsMarkingsKey(panel).startsWith("byteripper.")).toBe(true);
    }
  });
});
