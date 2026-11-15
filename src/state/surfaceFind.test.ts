import { afterEach, describe, expect, it } from "vitest";
import { CopyPartCodec } from "@/core/parts/partCodec";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart } from "@/state/openLinkedPart";
import {
  barFor,
  closeSearch,
  editQuery,
  openSearch,
  reopenSearch,
  searchedPane,
  searchStore,
  setCaseSensitive,
  setStandingCaseSensitive,
} from "@/state/searchStore";
import { snapshotWorkspace } from "@/state/workspace/workspaceRecorder";
import {
  closePart,
  foldParts,
  frontSurface,
  openEmptyInPane,
  type PaneId,
  type PartId,
  paneState,
  raisePart,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * A find bar per surface (§11): the tab's over its panes, and each fragment panel's over its
 * dump — each its own pattern and case rule, each searching only its own pane, a panel's folding
 * into the dock with the panel and coming back with it, and each written into the workspace.
 */

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  closeSearch(WORKSPACE_SURFACE);
  setStandingCaseSensitive(false);
  setCaseSensitive(false, WORKSPACE_SURFACE);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

async function fileInA(): Promise<void> {
  openEmptyInPane("a", "bios.bin");
  await paneState("a")?.document.insert(
    0,
    Uint8Array.from({ length: 0x400 }, (_, index) => index & 0xff)
  );
}

async function partOf(parent: PaneId, name: string, source: [number, number]): Promise<PartId> {
  const part = await openLinkedPart({ parent, name, source, codec: new CopyPartCodec() });
  if (part === undefined) throw new Error("the part should open");
  return part;
}

const bar = (surface: Parameters<typeof barFor>[1]) => barFor(searchStore.getSnapshot(), surface);

describe("a fragment panel's find bar", () => {
  // The store's half of upstream's test: the bar is the panel's own, the tab's stays closed, and
  // folding the panel keeps its bar open for when it comes back. Where it stands on screen — over
  // the panel's dump and map, never over a tool panel — is the stylesheet's, checked in a page.
  // @upstream ByteRipperTests/FindBarPlacementTests.swift#FindBarPlacementTests.testAFragmentPanelHasABarOfItsOwnThatFoldsWithIt
  // @upstream-differs the bar's state, not its frame: the layout is CSS
  it("is the panel's own, searches its part, and folds with it", async () => {
    await fileInA();
    const part = await partOf("a", "zone", [0x100, 0x300]);
    raisePart(part);
    expect(frontSurface()).toBe(part);

    openSearch();
    editQuery("BEEF");
    expect(bar(part).open).toBe(true);
    expect(bar(part).query).toBe("BEEF");
    expect(bar(WORKSPACE_SURFACE).open, "the tab's bar stays closed").toBe(false);
    expect(searchedPane(part)).toBe(part);
    expect(searchedPane(WORKSPACE_SURFACE)).toBe("a");

    foldParts();
    expect(frontSurface()).toBe(WORKSPACE_SURFACE);
    expect(bar(part).open, "folded with the panel, still open").toBe(true);
    openSearch();
    editQuery("CAFE");
    expect(bar(WORKSPACE_SURFACE).query).toBe("CAFE");
    expect(bar(part).query, "each keeps its own pattern").toBe("BEEF");

    raisePart(part);
    expect(bar(part).open).toBe(true);
    expect(bar(part).query).toBe("BEEF");
  });

  it("goes with the part", async () => {
    await fileInA();
    const part = await partOf("a", "zone", [0x100, 0x300]);
    openSearch(part);
    closePart(part);
    expect(searchStore.getSnapshot().bars[part]).toBeUndefined();
  });
});

describe("every surface's find bar, as the workspace writes it", () => {
  // Each bar has its own case rule; a panel's starts with the rule of the bar it was taken out
  // under — the tab's for a part of File A, the parent panel's for a part of a part — and the
  // workspace writes each bar's pattern while it is open and its rule open or closed.
  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testEachSurfacesFindBarComesBackWithItsOwnPatternAndCaseRule
  // @upstream-differs what is written, read back from the record; the restore's half — each bar
  // reopened on its pattern and rule — is checked in a page
  it("comes back with its own pattern and case rule", async () => {
    await fileInA();
    // Away from the standing choice, so a bar that merely started from it would be caught.
    setStandingCaseSensitive(false);
    setCaseSensitive(true, WORKSPACE_SURFACE);
    setStandingCaseSensitive(false);
    const zone = await partOf("a", "zone", [0x100, 0x300]);
    expect(bar(zone).caseSensitive, "a part of File A takes the tab's rule").toBe(true);
    setCaseSensitive(false, zone);
    const inner = await partOf(zone, "inner", [0x40, 0x80]);
    expect(bar(inner).caseSensitive, "a part of a part takes its parent panel's rule").toBe(false);
    reopenSearch(zone, "BEEF", "ascii");

    const { workspace } = await snapshotWorkspace();

    expect(workspace.tab.surface.findPattern, "the tab's bar was closed").toBeUndefined();
    expect(workspace.tab.surface.findCaseSensitive).toBe(true);
    const [first, second] = workspace.tab.fragments;
    expect(first?.surface.findPattern).toEqual({ text: "BEEF", encoding: "ascii" });
    expect(first?.surface.findCaseSensitive).toBe(false);
    expect(second?.surface.findPattern).toBeUndefined();
    expect(second?.surface.findCaseSensitive).toBe(false);
  });
});
