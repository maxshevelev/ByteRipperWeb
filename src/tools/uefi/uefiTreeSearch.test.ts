import { describe, expect, it } from "vitest";
import {
  hasSubtypes,
  matchesQuery,
  queryIsEmpty,
  type SearchDirection,
  type SearchedNode,
  searchSubtypes,
  searchTypes,
  UEFISearchOpenings,
  UEFITreeSearch,
  type UEFITreeSearchSource,
} from "@/tools/uefi/uefiTreeSearch";

/**
 * The search over the tree's rows: what a query matches, the order the walk offers rows
 * in — down before across, round once — what it asks to be read first, and what it has
 * opened and owes a closing.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests
 */

// MARK: - A tree as a table

/**
 * A tree given as `path: children counts`, where a branch not in `read` has not been
 * read: it lists nothing until `expand` says it has been.
 */
class Table implements UEFITreeSearchSource {
  readonly children = new Map<string, string[]>();
  readonly read: Set<string>;
  readonly top: string[];

  constructor(top: number, children: Record<string, number>, read?: readonly string[]) {
    this.top = Array.from({ length: top }, (_, index) => `${index}`);
    for (const [path, count] of Object.entries(children)) {
      this.children.set(
        path,
        Array.from({ length: count }, (_, index) => `${path}.${index}`)
      );
    }
    // Unless told which, every branch with a row of its own is read.
    this.read = new Set(read ?? [...this.top, ...this.children.keys()]);
  }

  topRows() {
    return this.top;
  }

  listedChildren(key: string) {
    if (!this.read.has(key) && this.children.has(key)) return undefined;
    return this.children.get(key) ?? [];
  }

  expand(key: string) {
    this.read.add(key);
  }
}

/** Everything the walk offers from `origin`, expanding what it asks for. */
function walk(table: Table, origin: string | undefined, direction: SearchDirection, limit = 100) {
  const search = new UEFITreeSearch(origin, direction);
  const rows: string[] = [];
  const expanded: string[] = [];
  while (rows.length < limit) {
    const next = search.advance(table);
    if (next.kind === "candidate") rows.push(next.key);
    else if (next.kind === "expand") {
      expanded.push(next.key);
      table.expand(next.key);
    } else return { rows, expanded, wrapped: search.wrapped };
  }
  return { rows, expanded, wrapped: search.wrapped };
}

/** 0 ─ 0.0, 0.1 ─ 0.1.0     1     2 ─ 2.0 */
const sample = (read?: readonly string[]) => new Table(3, { "0": 2, "0.1": 1, "2": 1 }, read);

describe("the order", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testForwardGoesDownBeforeAcrossAndComesRoundToTheOrigin
  it("goes down before across and comes round to the origin", () => {
    const result = walk(sample(), "0.1", "forward");
    // The origin is the last row offered, once the walk has come round.
    expect(result.rows).toEqual(["0.1.0", "1", "2", "2.0", "0", "0.0", "0.1"]);
    expect(result.wrapped).toBe(true);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testBackwardGoesThroughWhatIsInARowBeforeTheRow
  it("goes back through what is in a row before the row", () => {
    const result = walk(sample(), "2", "backward");
    expect(result.rows).toEqual(["1", "0.1.0", "0.1", "0.0", "0", "2.0", "2"]);
    expect(result.wrapped).toBe(true);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testNoOriginStartsAtAnEndAndDoesNotComeRound
  it("starts at an end without an origin and does not come round", () => {
    expect(walk(sample(), undefined, "forward").rows).toEqual([
      "0",
      "0.0",
      "0.1",
      "0.1.0",
      "1",
      "2",
      "2.0",
    ]);
    expect(walk(sample(), undefined, "backward").rows).toEqual([
      "2.0",
      "2",
      "1",
      "0.1.0",
      "0.1",
      "0.0",
      "0",
    ]);
    expect(walk(sample(), undefined, "forward").wrapped).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testAnOriginThatIsNoLongerThereStillEndsTheWalk
  it("ends when the origin is no longer there", () => {
    // Every row once, and then it stops.
    expect(walk(sample(), "9", "forward").rows).toHaveLength(7);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testAnEmptyTreeOffersNothing
  it("offers nothing for an empty tree", () => {
    expect(walk(new Table(0, {}), undefined, "forward").rows).toEqual([]);
    expect(walk(new Table(0, {}), "0", "backward").rows).toEqual([]);
  });
});

describe("what has to be read first", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testAnUnreadBranchIsAskedForBeforeTheWalkGoesInto
  it("asks for an unread branch before going into it", () => {
    const result = walk(sample(["0", "2"]), "0.0", "forward");
    // 0.1 holds a row, and is asked for as the walk reaches it.
    expect(result.expanded).toEqual(["0.1"]);
    expect(result.rows.slice(0, 3)).toEqual(["0.1", "0.1.0", "1"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testBackWardsAnUnreadBranchIsReadBeforeTheRowAfterIt
  it("reads an unread branch before the row after it, going back", () => {
    const result = walk(sample(["0", "2"]), "1", "backward");
    // Its last row comes before the row itself.
    expect(result.expanded[0]).toBe("0.1");
    expect(result.rows.slice(0, 2)).toEqual(["0.1.0", "0.1"]);
  });
});

describe("what a query matches", () => {
  const file = (name: string, guid?: string, subtype = 0x07): SearchedNode => ({
    itemType: 0x42,
    itemSubtype: subtype,
    name,
    guid,
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testTextIsASubstringOfTheNameWhateverTheCase
  it("takes the text as a substring of the name, whatever the case", () => {
    const node = file("SetupUtility");
    expect(matchesQuery({ text: "setup" }, node, "SetupUtility")).toBe(true);
    // The space after it is not part of it.
    expect(matchesQuery({ text: "UTIL " }, node, "x")).toBe(true);
    expect(matchesQuery({ text: "smm" }, node, "SetupUtility")).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testTheRowsNameAndTheGUIDItStandsForAreBothFound
  it("finds both the row's name and the GUID it stands for", () => {
    const node = file("DxeCore", "D6A2CB7F-6A18-4E2F-B43B-9920A733700A");
    const query = (text: string) => matchesQuery({ text }, node, "DXE Core");
    expect(query("dxe core")).toBe(true);
    expect(query("DxeCore")).toBe(true);
    expect(query("6a18-4e2f")).toBe(true);
    // Hex without the dashes.
    expect(query("d6a2cb7f6a18")).toBe(true);
    expect(query("zzzz")).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testTypeAndSubtypeNarrowTheName
  it("narrows the name by type and subtype", () => {
    const query = { text: "smm", type: 0x42, subtype: 0x07 };
    expect(matchesQuery(query, file("Smm", undefined, 0x07), "Smm")).toBe(true);
    expect(matchesQuery(query, file("Smm", undefined, 0x06), "Smm")).toBe(false);
    const section: SearchedNode = { itemType: 0x43, itemSubtype: 0x10, name: "Smm" };
    expect(matchesQuery(query, section, "Smm")).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testASubtypeMeansNothingWithoutAFileOrASectionType
  it("takes a subtype for nothing without a file or a section type", () => {
    const volume: SearchedNode = { itemType: 0x41, name: "FFS" };
    expect(matchesQuery({ text: "", type: 0x41, subtype: 0x07 }, volume, "FFS")).toBe(true);
    expect(hasSubtypes(0x41)).toBe(false);
    expect(hasSubtypes(0x43)).toBe(true);
  });

  // A Name section's text is its file's name: the file is the one match, unless sections
  // are what is asked for.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testANameSectionIsNotASecondMatchForItsFile
  it("does not take a Name section for a second match of its file", () => {
    const section: SearchedNode = { itemType: 0x43, itemSubtype: 0x15, name: "PeiPcie" };
    expect(matchesQuery({ text: "peipcie" }, section, "PeiPcie")).toBe(false);
    expect(matchesQuery({ text: "peipcie", type: 0x43 }, section, "PeiPcie")).toBe(true);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testAQueryThatAsksForNothingIsEmpty
  it("is empty when it asks for nothing", () => {
    expect(queryIsEmpty({ text: "" })).toBe(true);
    expect(queryIsEmpty({ text: "  " })).toBe(true);
    expect(queryIsEmpty({ text: "", type: 0x42 })).toBe(false);
    expect(queryIsEmpty({ text: "a" })).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testTheChoicesAreTheColumnsOwnWords
  it("offers the column's own words", () => {
    const types = searchTypes();
    expect(types[0]).toEqual({ code: 0x3d, name: "Capsule" });
    expect(types.at(-1)?.name).toBe("AMD microcode");
    expect(types).toContainEqual({ code: 0x42, name: "File" });
    expect(searchSubtypes(0x42)).toContainEqual({ code: 0x07, name: "Driver" });
    expect(searchSubtypes(0x43)).toContainEqual({ code: 0x10, name: "PE32 image" });
    expect(searchSubtypes(0x41)).toEqual([]);
    expect(searchSubtypes(undefined)).toEqual([]);
  });
});

describe("what the search opened", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testARowAboveTheNextMatchStaysAndTheRestIsShutDeepestFirst
  it("keeps a row above the next match and shuts the rest, deepest first", () => {
    const openings = new UEFISearchOpenings();
    for (const key of ["0", "0.1", "0.1.2", "3"]) openings.record(key);

    // 0 and 0.1 are above the match; 0.1.2 and 3 are not.
    expect(openings.closings("0.1.5")).toEqual(["0.1.2", "3"]);
    // The match itself stays open.
    expect(openings.closings("0.1")).toEqual(["0.1.2", "3"]);
    const all = openings.closings("7");
    expect(all.slice(0, 2)).toEqual(["0.1.2", "0.1"]);
    expect(new Set(all)).toEqual(new Set(["0.1.2", "0.1", "0", "3"]));
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeSearchTests.swift#UEFITreeSearchTests.testARowTheReaderTookOverOrThatIsReleasedIsNotShut
  it("does not shut a row the reader took over or that is released", () => {
    const openings = new UEFISearchOpenings();
    openings.record("0");
    openings.record("0.1");
    openings.record("0.1");
    // Once.
    expect(openings.opened).toHaveLength(2);

    openings.forget("0.1");
    expect(openings.closings("4")).toEqual(["0"]);
    openings.release();
    expect(openings.isEmpty).toBe(true);
    expect(openings.closings("4")).toEqual([]);
  });
});
