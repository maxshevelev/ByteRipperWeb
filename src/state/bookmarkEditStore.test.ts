import { beforeEach, describe, expect, it } from "vitest";
import {
  bookmarkEditStore,
  cancelBookmarkEdit,
  commitBookmarkEdit,
  deleteEditedBookmark,
  editBookmarkInPane,
  editedBookmarkRow,
  handleOffsetDoubleClick,
  toggleBookmarkInPane,
} from "@/state/bookmarkEditStore";
import { addBookmark, bookmarkAt, bookmarks, removeBookmark } from "@/state/bookmarksStore";

const session = () => bookmarkEditStore.getSnapshot().session;

beforeEach(() => {
  cancelBookmarkEdit();
  for (const mark of [...bookmarks.bookmarks]) removeBookmark(mark.row);
});

describe("⌘D", () => {
  it("marks an unmarked row and opens the naming popover on it", () => {
    toggleBookmarkInPane("a", 0x1234);
    expect(bookmarkAt(0x1230)).toEqual({ row: 0x1230, name: "" });
    expect(session()).toMatchObject({ pane: "a", row: 0x1230, existingName: undefined });
  });

  it("then Return saves the name", () => {
    toggleBookmarkInPane("a", 0x1234);
    commitBookmarkEdit(0x1230, "  Boot block ");
    expect(bookmarkAt(0x1230)?.name).toBe("Boot block");
    expect(session()).toBeUndefined();
  });

  it("then Esc takes the new mark away again", () => {
    toggleBookmarkInPane("a", 0x1234);
    cancelBookmarkEdit();
    expect(bookmarkAt(0x1230)).toBeUndefined();
    expect(session()).toBeUndefined();
  });

  it("unmarks a marked row on the spot, with nothing to dismiss", () => {
    addBookmark(0x40, "kept");
    toggleBookmarkInPane("b", 0x48);
    expect(bookmarkAt(0x40)).toBeUndefined();
    expect(session()).toBeUndefined();
  });

  it("while naming, unmarking the row closes the popover", () => {
    toggleBookmarkInPane("a", 0x80);
    toggleBookmarkInPane("a", 0x80);
    expect(bookmarkAt(0x80)).toBeUndefined();
    expect(session()).toBeUndefined();
  });
});

describe("the offset field", () => {
  it("moves the bookmark to the row it names, name and all", () => {
    toggleBookmarkInPane("a", 0x100);
    commitBookmarkEdit(0x200, "moved");
    expect(bookmarkAt(0x100)).toBeUndefined();
    expect(bookmarkAt(0x200)).toEqual({ row: 0x200, name: "moved" });
  });

  it("names a row, rounding down to its start", () => {
    expect(editedBookmarkRow("0x1237", 0)).toBe(0x1230);
    expect(editedBookmarkRow("4660", 0)).toBe(0x1230);
  });

  it("names no row for text that is not an offset", () => {
    expect(editedBookmarkRow("0xZZ", 0)).toBeUndefined();
    expect(editedBookmarkRow("", 0)).toBeUndefined();
  });

  it("refuses a row another bookmark holds, but not the mark's own", () => {
    addBookmark(0x300, "other");
    addBookmark(0x100, "mine");
    expect(editedBookmarkRow("0x300", 0x100)).toBeUndefined();
    expect(editedBookmarkRow("0x10F", 0x100)).toBe(0x100);
  });
});

describe("a double click on an address", () => {
  it("marks and names a bare row", () => {
    handleOffsetDoubleClick("a", 0x500);
    expect(bookmarkAt(0x500)).toBeDefined();
    expect(session()?.existingName).toBeUndefined();
  });

  it("edits the mark that is there rather than unmarking it", () => {
    addBookmark(0x500, "Here");
    handleOffsetDoubleClick("a", 0x500);
    expect(bookmarkAt(0x500)?.name).toBe("Here");
    expect(session()).toMatchObject({ row: 0x500, existingName: "Here" });
  });
});

describe("editing an existing bookmark", () => {
  it("leaves it exactly as it was on Esc", () => {
    addBookmark(0x600, "Same");
    editBookmarkInPane("a", 0x600);
    cancelBookmarkEdit();
    expect(bookmarkAt(0x600)).toEqual({ row: 0x600, name: "Same" });
  });

  it("removes it with Delete", () => {
    addBookmark(0x600, "Gone");
    editBookmarkInPane("a", 0x600);
    deleteEditedBookmark();
    expect(bookmarkAt(0x600)).toBeUndefined();
    expect(session()).toBeUndefined();
  });

  it("opens nothing on a row that carries no mark", () => {
    editBookmarkInPane("a", 0x700);
    expect(session()).toBeUndefined();
  });

  it("offers no Delete for a mark still being named", () => {
    toggleBookmarkInPane("a", 0x800);
    deleteEditedBookmark();
    expect(bookmarkAt(0x800)).toBeDefined();
    expect(session()).toBeDefined();
  });

  it("replaces a session already on screen", () => {
    toggleBookmarkInPane("a", 0x900);
    toggleBookmarkInPane("b", 0xa00);
    expect(session()).toMatchObject({ pane: "b", row: 0xa00 });
    // The first mark stays: replacing a popover runs neither of its outcomes.
    expect(bookmarkAt(0x900)).toBeDefined();
  });
});
