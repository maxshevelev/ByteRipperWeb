import { describe, expect, it } from "vitest";
import {
  PAST_END_OF_FILE,
  rowDescription,
  selectionAfterChange,
  visibleRowCount,
} from "@/ui/dialogs/bookmarkList";

describe("the bookmark list's height", () => {
  it("is as tall as its rows, between three and ten", () => {
    expect(visibleRowCount(0)).toBe(3);
    expect(visibleRowCount(5)).toBe(5);
    expect(visibleRowCount(40)).toBe(10);
  });
});

describe("the selection when the list changes", () => {
  it("stays on a bookmark still listed, wherever it moved", () => {
    expect(selectionAfterChange([0x10, 0x20], [0x05, 0x10, 0x20], 0x20)).toBe(0x20);
  });

  it("passes to the row that slid into a removed one's place", () => {
    expect(selectionAfterChange([0x10, 0x20, 0x30], [0x10, 0x30], 0x20)).toBe(0x30);
  });

  it("passes to the new last row when the last one goes", () => {
    expect(selectionAfterChange([0x10, 0x20], [0x10], 0x20)).toBe(0x10);
  });

  it("is nothing once the list is empty, or when nothing was selected", () => {
    expect(selectionAfterChange([0x10], [], 0x10)).toBeUndefined();
    expect(selectionAfterChange([0x10], [0x10], undefined)).toBeUndefined();
  });
});

describe("an unnamed bookmark's description", () => {
  it("is the row's bytes in the dump's hex", () => {
    expect(rowDescription(new Uint8Array([0x5a, 0x0f, 0xff]))).toBe("5A 0F FF");
  });

  it("says so for a row past the end of the file", () => {
    expect(rowDescription(undefined)).toBe(PAST_END_OF_FILE);
  });
});
