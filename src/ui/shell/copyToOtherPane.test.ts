import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { nextUndo, undoLast } from "@/state/undoRouter";
import {
  closePane,
  editingHooks,
  openInPane,
  openPart,
  type PaneId,
  paneState,
  type SlotId,
  setActivePane,
  workspaceStore,
} from "@/state/workspaceStore";
import { canCopyToOtherPane, copySelectionToOtherPane } from "@/ui/shell/copyToOtherPane";
import { isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";
import { dumpMenu, type PaneMenuActions } from "@/ui/shell/paneMenus";

/**
 * Edit ▸ Copy to Other Pane: the selected range, written over the same
 * addresses in the other pane without the clipboard — one undo step in the
 * receiving document, and a sentence for the case that cannot work.
 */

afterEach(() => {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
    activePane: "a",
    alert: undefined,
  }));
});

function open(pane: SlotId, bytes: Uint8Array): void {
  openInPane(pane, {
    name: `${pane}.bin`,
    size: bytes.length,
    lastModified: 0,
    source: new Blob([bytes.slice()]),
  });
}

/** Two files in a comparison, File A active. */
function comparison(a: Uint8Array, b: Uint8Array): void {
  open("a", a);
  open("b", b);
  setActivePane("a");
}

const filled = (value: number, length: number) => new Uint8Array(length).fill(value);

async function select(pane: PaneId, start: number, end: number): Promise<void> {
  await paneState(pane)?.typing.setSelection(start, end);
}

async function bytes(pane: PaneId): Promise<number[]> {
  const slot = paneState(pane);
  if (slot === undefined) throw new Error("the pane should be open");
  return [...(await slot.document.read(0, slot.document.size))];
}

const can = (pane: PaneId) => canCopyToOtherPane(workspaceStore.getSnapshot(), pane);

describe("Copy to Other Pane", () => {
  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testTheSelectionLandsAtTheSameAddressesAsOneUndoStep
  it("lands at the same addresses, as one undo step", async () => {
    comparison(filled(0xaa, 64), filled(0x00, 64));
    await select("a", 16, 24);

    await copySelectionToOtherPane("a");

    const expected = [...filled(0x00, 64)];
    expected.fill(0xaa, 16, 24);
    expect(await bytes("b")).toEqual(expected);
    expect(paneState("b")?.document.size).toBe(64);
    expect(nextUndo("b")?.label).toBe("Copy to Other Pane");
    expect(nextUndo("a")).toBeUndefined();
    expect(paneState("b")?.document.selection).toMatchObject({ start: 16, end: 24 });

    await undoLast("b", false);
    expect(await bytes("b")).toEqual([...filled(0x00, 64)]);
  });

  /**
   * The comparison hears of the copy as it hears of a typed byte. It did not:
   * the bytes agreed and went on being drawn as differing until something
   * else made the comparison look again.
   */
  it("tells the comparison which bytes it wrote", async () => {
    comparison(filled(0xaa, 64), filled(0x00, 64));
    await select("a", 16, 24);
    const heard: unknown[] = [];
    const before = editingHooks.onEdit;
    editingHooks.onEdit = (pane, edit) => heard.push({ pane, edit });
    try {
      await copySelectionToOtherPane("a");
    } finally {
      editingHooks.onEdit = before;
    }

    expect(heard).toEqual([{ pane: "b", edit: { kind: "overwrite", start: 16, end: 24 } }]);
  });

  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testItGoesFromTheActivePaneWhicheverThatIs
  it("goes from whichever pane it is asked of", async () => {
    comparison(filled(0x00, 16), filled(0xbb, 16));
    setActivePane("b");
    await select("b", 0, 4);

    await copySelectionToOtherPane("b");

    expect((await bytes("a")).slice(0, 6)).toEqual([0xbb, 0xbb, 0xbb, 0xbb, 0, 0]);
  });

  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testARangePastTheEndOfTheOtherFileIsRefused
  it("refuses a range past the end of the other file", async () => {
    comparison(filled(0xaa, 64), filled(0x00, 32));
    await select("a", 24, 40);

    await copySelectionToOtherPane("a");

    expect(workspaceStore.getSnapshot().alert?.title).toBe("Copy to Other Pane");
    expect(await bytes("b")).toEqual([...filled(0x00, 32)]);
    expect(paneState("b")?.document.size).toBe(32);
  });

  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testTheCommandNeedsTwoFilesAndASelection
  it("needs two files and a selection", async () => {
    comparison(filled(0xaa, 16), filled(0x00, 16));
    await select("a", 4, 4);
    expect(can("a")).toBe(false);

    await select("a", 0, 8);
    expect(can("a")).toBe(true);

    closePane("b");
    await select("a", 0, 8);
    expect(can("a")).toBe(false);
  });

  it("is not offered from a fragment panel, nor while one covers the panes", async () => {
    comparison(filled(0xaa, 16), filled(0x00, 16));
    await select("a", 0, 8);
    const part = openPart(filled(0x11, 16), "part.bin");
    await select(part, 0, 8);

    expect(can(part)).toBe(false);
    expect(can("a")).toBe(false);
  });
});

/** Nothing here calls the shell back: the command is the store's own act. */
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

const labels = (entries: readonly (MenuEntry | undefined)[]): string[] =>
  entries.flatMap((entry) => (entry !== undefined && isMenuAction(entry) ? [entry.label] : []));

const menuOver = (pane: PaneId, offset: number) =>
  dumpMenu(workspaceStore.getSnapshot(), pane, offset, actions);

describe("the menu over a selection", () => {
  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testTheSelectionsMenuOffersItBesideCopy
  it("offers it beside Copy, and only over the selection", async () => {
    comparison(filled(0xaa, 64), filled(0x00, 64));
    await select("a", 16, 32);

    expect(labels(menuOver("a", 20)).slice(0, 2)).toEqual(["Copy", "Copy to Other Pane"]);
    expect(labels(menuOver("a", 40))).not.toContain("Copy to Other Pane");
  });

  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testTheRightClickedPaneIsTheSourceEvenWhenInactive
  it("copies from the pane that was right-clicked, active or not", async () => {
    comparison(filled(0x00, 32), filled(0xbb, 32));
    await select("b", 8, 12);

    const item = menuOver("b", 9).find(
      (entry) => entry !== undefined && isMenuAction(entry) && entry.label === "Copy to Other Pane"
    );
    if (item === undefined || !isMenuAction(item)) throw new Error("not offered");
    item.onSelect();
    for (let tries = 0; tries < 100 && nextUndo("a") === undefined; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect((await bytes("a")).slice(6, 14)).toEqual([0, 0, 0xbb, 0xbb, 0xbb, 0xbb, 0, 0]);
    expect(nextUndo("a")?.label).toBe("Copy to Other Pane");
  });

  // @upstream ByteRipperTests/CopyToOtherPaneTests.swift#CopyToOtherPaneTests.testASingleFilesMenuDoesNotOfferIt
  it("does not offer it with one file", async () => {
    open("a", filled(0xaa, 16));
    await select("a", 0, 8);

    expect(labels(menuOver("a", 2))).not.toContain("Copy to Other Pane");
  });
});
