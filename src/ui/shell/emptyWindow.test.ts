import { describe, expect, it } from "vitest";
import { hexAddress } from "@/core/text/hexText";
import { bookmarkHeading, bookmarkRows, windowTitle } from "@/ui/shell/emptyWindow";

/** What an empty window is for — upstream's `EmptyStateBookmarksTests`. */

describe("the empty window's bookmark list", () => {
  // An empty list would be a heading over nothing.
  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testNoBookmarksMeansNoSection
  it("has no rows, and so no section, without marks", () => {
    expect(bookmarkRows([])).toEqual([]);
  });

  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testANamedBookmarkShowsItsAddressAndName
  it("shows a named mark's address and name", () => {
    expect(bookmarkRows([{ row: 0x7af0, name: "header" }])).toEqual([
      { address: hexAddress(0x7af0), name: "header" },
    ]);
  });

  // With no file there are no bytes to describe an unnamed mark by.
  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testAnUnnamedBookmarkShowsOnlyItsAddress
  it("shows an unnamed mark's address and nothing else", () => {
    expect(bookmarkRows([{ row: 0x40, name: "" }])).toEqual([
      { address: hexAddress(0x40), name: "" },
    ]);
  });

  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testTheListIsReplacedRatherThanAppended
  it("is the marks it was given, not those plus the last ones", () => {
    bookmarkRows([
      { row: 0x10, name: "a" },
      { row: 0x20, name: "b" },
    ]);
    expect(bookmarkRows([{ row: 0x30, name: "c" }]).map((row) => row.name)).toEqual(["c"]);
  });

  // The heading's colour is the bookmark purple, in the stylesheet.
  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testTheHeadingCountsAndWearsTheBookmarkColour
  it("is headed by a count", () => {
    expect(bookmarkHeading(1)).toBe("1 Bookmark Here:");
    expect(bookmarkHeading(2)).toBe("2 Bookmarks Here:");
  });
});

describe("the workspace's title", () => {
  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testTheTitleCountsTheBookmarks
  it("counts the marks an empty workspace is keeping", () => {
    expect(windowTitle({}, 0)).toBe("Empty");
    expect(windowTitle({}, 1)).toBe("Empty (1 Bookmark)");
    expect(windowTitle({}, 2)).toBe("Empty (2 Bookmarks)");
  });

  // @upstream ByteRipperTests/EmptyStateBookmarksTests.swift#EmptyStateBookmarksTests.testAWindowWithAFileIsStillNamedAfterIt
  it("is the file's name once there is a file, marks or no marks", () => {
    expect(windowTitle({ a: "bios.bin" }, 1)).toBe("bios.bin");
  });

  it("names both files of a comparison", () => {
    expect(windowTitle({ a: "good.bin", b: "bad.bin" }, 0)).toBe("good.bin ↔ bad.bin");
  });
});
