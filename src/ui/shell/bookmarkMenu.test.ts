import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElsewhereCodec } from "@/core/testing/partCodecs";
import {
  bookmarkEditStore,
  cancelBookmarkEdit,
  commitBookmarkEdit,
} from "@/state/bookmarkEditStore";
import { bookmarkAt, bookmarks, removeBookmark } from "@/state/bookmarksStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openGivenPart } from "@/state/testing/givenParts";
import {
  closePart,
  openEmptyInPane,
  type PaneId,
  type PartId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { compactEntries, isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";
import { dumpMenu, type PaneMenuActions } from "@/ui/shell/paneMenus";

/**
 * The dump menu's bookmark block (§20.3): it says what it will do to the row
 * that was right-clicked — Add Bookmark on a row with no mark, Delete Bookmark
 * and Edit Bookmark… on one that has — and does it to that row, in that pane.
 *
 * Upstream builds the menu with `makeOffsetMenu` and reads its titles; here the
 * menu is a value, so its labels are read and an item is picked by name.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addBookmarkMenuItems
 */

/** Nothing here calls the shell back: the bookmark items are the stores' own acts. */
const actions = {
  onNew: () => {},
  onOpen: () => {},
  onSave: () => {},
  onSaveAs: () => {},
  onRename: () => {},
  onRevert: () => {},
  onDuplicate: () => {},
  onClose: () => {},
  onFill: () => {},
  onDeleteBytes: () => {},
  onSelectBlockFrom: () => {},
  onSplitHere: () => {},
  onSelectZone: () => {},
  onSegments: () => {},
  onEditSegment: () => {},
  onJoin: () => {},
  onProblem: () => {},
  onMessage: () => {},
} satisfies PaneMenuActions;

const menu = (pane: PaneId, offset: number): (MenuEntry | undefined)[] =>
  dumpMenu(workspaceStore.getSnapshot(), pane, offset, actions);

const titles = (pane: PaneId, offset: number): string[] =>
  menu(pane, offset).flatMap((entry) =>
    entry !== undefined && isMenuAction(entry) ? [entry.label] : []
  );

const pick = (pane: PaneId, offset: number, label: string): void => {
  const found = menu(pane, offset).find(
    (entry) => entry !== undefined && isMenuAction(entry) && entry.label === label
  );
  if (found === undefined || !isMenuAction(found)) throw new Error(`no item named ${label}`);
  found.onSelect();
};

const session = () => bookmarkEditStore.getSnapshot().session;

/** A file of `length` bytes in pane A. */
async function fileInA(length = 64): Promise<void> {
  openEmptyInPane("a", "bios.bin");
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  await slot.document.insert(
    0,
    Uint8Array.from({ length }, (_, index) => index & 0xff)
  );
}

beforeEach(() => {
  cancelBookmarkEdit();
  for (const mark of [...bookmarks.bookmarks]) removeBookmark("a", mark.row);
});

afterEach(() => {
  cancelBookmarkEdit();
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

describe("the bookmark block", () => {
  // The address is the ROW's: a right-click on a byte marks that byte's row,
  // and the title is what says so (§20.1).
  // @upstream ByteRipperTests/BookmarkTests.swift#BookmarkTests.testTheContextMenuAddsOrDeletesAndEdits
  it("offers Add on a row with no mark, Delete and Edit on one that has", async () => {
    await fileInA();

    // A byte in the middle of row 0x10, so the row address has to be derived.
    const unmarked = titles("a", 0x1b);
    expect(unmarked).toContain("Add Bookmark at 00000010");
    expect(unmarked.some((title) => title.startsWith("Delete Bookmark"))).toBe(false);
    expect(unmarked).not.toContain("Edit Bookmark…");

    bookmarks.add(0x1b, "ME region");
    const marked = titles("a", 0x1b);
    expect(marked).toContain("Delete Bookmark at 00000010");
    expect(marked.some((title) => title.startsWith("Add Bookmark"))).toBe(false);
    expect(marked).toContain("Edit Bookmark…");
  });

  // Adding from the menu asks for the name the same way ⌘D does; deleting asks
  // nothing.
  // @upstream ByteRipperTests/BookmarkTests.swift#BookmarkTests.testTheContextMenuItemsActOnTheClickedRow
  it("acts on the row that was right-clicked", async () => {
    await fileInA();

    pick("a", 0x2a, "Add Bookmark at 00000020");
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x20]);
    expect(session()).toMatchObject({ pane: "a", row: 0x20, existingName: undefined });
    commitBookmarkEdit(0x20, "vendor block");
    expect(bookmarks.bookmarks).toEqual([{ row: 0x20, name: "vendor block" }]);

    pick("a", 0x2a, "Delete Bookmark at 00000020");
    expect(bookmarks.bookmarks).toEqual([]);
    expect(session()).toBeUndefined();
  });

  /** Both file slots read one list, so the other pane's menu says Delete too. */
  it("reads the list the two panes share", async () => {
    await fileInA();
    openEmptyInPane("b", "other.bin");
    await paneState("b")?.document.insert(0, new Uint8Array(64));
    bookmarks.add(0x30);

    expect(titles("b", 0x31)).toContain("Delete Bookmark at 00000030");
    pick("b", 0x31, "Delete Bookmark at 00000030");
    expect(bookmarkAt("a", 0x30)).toBeUndefined();
  });
});

describe("the bookmark block in a part", () => {
  async function partOfA(start: number, end: number, kind?: "decompressed"): Promise<PartId> {
    const slot = paneState("a");
    if (slot === undefined) throw new Error("pane A should be open");
    return openGivenPart({
      parent: "a",
      bytes: await slot.document.read(start, end - start),
      name: "zone.bin",
      source: [start, end],
      partName: "zone",
      ...(kind === undefined ? {} : { back: new ElsewhereCodec() }),
    });
  }

  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testTheOffsetMenuKeepsTheBookmarkBlockInACopiedPart
  it("names the part's own address in a copied part", async () => {
    await fileInA(0x200);
    const part = await partOfA(0x100, 0x140);

    expect(titles(part, 0x1b)).toContain("Add Bookmark at 00000010");
    pick(part, 0x1b, "Add Bookmark at 00000010");
    expect(bookmarkAt("a", 0x110)).toEqual({ row: 0x110, name: "" });
  });

  // A disabled item would still be an offer, and there is nothing being offered.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testTheOffsetMenuHasNoBookmarkBlockInADecompressedPart
  it("is not there in a decompressed part", async () => {
    await fileInA(0x200);
    const part = await partOfA(0x100, 0x140, "decompressed");

    const offered = titles(part, 0x10);
    expect(offered.some((title) => title.includes("Bookmark at"))).toBe(false);
    expect(offered).not.toContain("Edit Bookmark…");
    // And no separator left dangling, once the menu is laid out as it is shown.
    const last = compactEntries(menu(part, 0x10)).at(-1);
    expect(last !== undefined && isMenuAction(last)).toBe(true);
  });
});
