import { afterEach, describe, expect, it } from "vitest";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { canRenamePane, openEmptyInPane, renamePane, workspaceStore } from "@/state/workspaceStore";
import { type PaneMenuActions, paneFileMenu } from "@/ui/shell/paneMenus";

/**
 * Which panes have a name to change, and changing it — upstream's
 * `RenamePaneTests` where they are about the document rather than the field.
 */

afterEach(() => {
  workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
});

const slot = () => workspaceStore.getSnapshot().panes.a;

/** Gives pane A a file on disk behind it, which is what makes a name a file's. */
function saveA(): void {
  workspaceStore.update((state) => {
    const pane = state.panes.a;
    if (pane === undefined) return state;
    return {
      ...state,
      panes: { ...state.panes, a: { ...pane, saved: new MemoryBackedStorage(new Uint8Array(1)) } },
    };
  });
}

describe("renaming a pane", () => {
  // A new file has no file behind it, so its name is a label.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testAnUnsavedDocumentCanBeRenamed
  it("is offered for a document with no file behind it", () => {
    openEmptyInPane("a");
    expect(canRenamePane("a")).toBe(true);
  });

  // A saved document's name is its file's; an empty pane has none.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testAFileAndAnEmptyPaneCannotBeRenamed
  it("is refused for a file and for an empty pane", () => {
    expect(canRenamePane("a")).toBe(false);

    openEmptyInPane("a", "dump.bin");
    saveA();
    expect(canRenamePane("a")).toBe(false);
    expect(renamePane("a", "other.bin")).toBe(false);
    expect(slot()?.name).toBe("dump.bin");
  });

  // The file appears when the document is saved, not when it is named.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testRenamingChangesTheNameAndWritesNothing
  it("changes the name and nothing else", () => {
    openEmptyInPane("a");
    const document = slot()?.document;

    expect(renamePane("a", "patched.bin")).toBe(true);

    expect(slot()?.name).toBe("patched.bin");
    expect(slot()?.saved).toBeUndefined();
    expect(slot()?.document).toBe(document);
  });

  // A field closed by accident must not blank the header.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testAnEmptyNameLeavesTheOldOne
  it("leaves the old name for a name of nothing", () => {
    openEmptyInPane("a");
    expect(renamePane("a", "patched.bin")).toBe(true);

    expect(renamePane("a", "   ")).toBe(false);

    expect(slot()?.name).toBe("patched.bin");
  });

  // Enabled only for a document whose name is the app's to change.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testTheMenuItemFollowsWhatCanBeRenamed
  it("is in the header's menu, enabled only where it can be done", () => {
    const actions = new Proxy({}, { get: () => () => undefined }) as PaneMenuActions;
    const renameItem = () =>
      paneFileMenu(workspaceStore.getSnapshot(), "a", actions).find(
        (entry) => entry !== undefined && "onSelect" in entry && entry.label === "Rename"
      ) as { readonly disabled?: boolean } | undefined;

    openEmptyInPane("a");
    expect(renameItem()?.disabled).toBe(false);

    saveA();
    expect(renameItem()?.disabled).toBe(true);
  });
});
