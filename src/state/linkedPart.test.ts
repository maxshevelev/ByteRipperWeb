import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart, partNameOf } from "@/state/openLinkedPart";
import {
  partsLinkedTo,
  strandingCloseButton,
  strandingSentence,
  updateInParent,
  updateInParentItem,
} from "@/state/partUpdate";
import {
  closePart,
  openEmptyInPane,
  type PartId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The link a part carries back to where its bytes came from, and Update in
 * Parent putting them there. Ported from upstream's `LinkedPartTests`, at the
 * level this port has one: the link and the write, not the window around them.
 *
 * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests
 */

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
  vi.unstubAllGlobals();
});

/** A file of `length` bytes, each its own offset, in pane A. */
async function fileInA(length = 0x40): Promise<void> {
  openEmptyInPane("a", "bios.bin");
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  await slot.document.insert(
    0,
    Uint8Array.from({ length }, (_, index) => index & 0xff)
  );
}

/** Takes `[start, end)` of pane A out as a part, linked to it. */
async function partOfA(start: number, end: number, name = "bios_zone.bin"): Promise<PartId> {
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  return openLinkedPart({
    parent: "a",
    bytes: await slot.document.read(start, end - start),
    name,
    source: [start, end],
    partName: "zone",
  });
}

const bytesOf = async (pane: PartId | "a"): Promise<number[]> => {
  const slot = paneState(pane);
  if (slot === undefined) return [];
  return Array.from(await slot.document.read(0, slot.document.size));
};

describe("the link", () => {
  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAZoneTabIsLinkedToTheZoneAndNamesItsParent
   */
  it("names the part, the parent and the bytes it came from", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;

    expect(origin?.parent).toBe("a");
    expect(origin?.sourceRange).toEqual([0x10, 0x20]);
    expect(origin?.partName).toBe("zone");
    expect(origin?.parentName).toBe("bios.bin");
    expect(await origin?.state()).toBe("intact");
    expect(origin?.explanationFor("intact")).toBe(
      "Opened from “zone” in bios.bin. Click to show it there."
    );
  });

  /**
   * The source's own bytes are what the link is about, not the offsets: change
   * them in the parent and the link says so.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testTheLinkFollowsTheSourceBytes
   */
  it("says when the source has changed in the parent", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;

    await paneState("a")?.document.overwrite(0x11, Uint8Array.from([0xff]));

    expect(await origin?.state()).toBe("sourceChanged");
    expect(origin?.explanationFor("sourceChanged")).toBe(
      "Opened from “zone” in bios.bin, which has changed there since."
    );
  });

  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testClosingTheParentBreaksTheLink
   */
  it("is broken when the parent goes", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;

    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));

    expect(await origin?.state()).toBe("parentClosed");
    // And it still knows what it was called there.
    expect(origin?.parentName).toBe("bios.bin");
    expect((await updateInParentItem(part)).enabled).toBe(false);
  });

  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAToolTabsPartIsNamedWithoutTheDumpAroundIt
   */
  it("names a part without the dump around it", () => {
    expect(partNameOf("bios_LZMA section.bin", "bios.rom")).toBe("LZMA section");
    expect(partNameOf("elsewhere.bin", "bios.rom")).toBe("elsewhere");
    expect(partNameOf("bios_.bin", "bios.rom")).toBe("bios_");
  });
});

describe("update in parent", () => {
  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testUpdatingAZoneWritesTheTabBackAsOneUndoStep
   */
  it("writes the part back where it came from, as one undo step", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    await paneState(part)?.document.overwrite(0, Uint8Array.from([0xaa, 0xbb]));

    const outcome = await updateInParent(part);

    expect(outcome).toEqual({ kind: "updated", parent: "a" });
    const file = await bytesOf("a");
    expect(file.slice(0x10, 0x12)).toEqual([0xaa, 0xbb]);
    // One step: taking it back restores the two bytes together.
    await paneState("a")?.document.undo();
    expect((await bytesOf("a")).slice(0x10, 0x12)).toEqual([0x10, 0x11]);
  });

  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testTheCommandIsOfferedWhenThereIsSomethingToPutBack
   */
  it("is offered only while there is something to put back", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);

    expect(await updateInParentItem(part)).toEqual({
      title: "Update in “bios.bin”",
      enabled: false,
    });

    await paneState(part)?.document.overwrite(0, Uint8Array.from([0xaa]));
    expect((await updateInParentItem(part)).enabled).toBe(true);

    // And once the parent has the bytes, there is nothing left to put back.
    await updateInParent(part);
    expect((await updateInParentItem(part)).enabled).toBe(false);
  });

  /**
   * A part goes back only at its own length: the bytes after it in the file are
   * not this part's to move.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testALengthChangeIsRefused
   */
  it("refuses a part whose length changed", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    await paneState(part)?.document.insert(0, Uint8Array.from([0x01]));

    const outcome = await updateInParent(part);

    expect(outcome.kind).toBe("refused");
    expect(workspaceStore.getSnapshot().alert?.title).toBe("The length changed");
    expect((await bytesOf("a")).slice(0x10, 0x12)).toEqual([0x10, 0x11]);
  });

  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAChangedSourceIsOverwrittenOnlyWhenConfirmed
   */
  it("overwrites a changed source only when that is confirmed", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    await paneState(part)?.document.overwrite(0, Uint8Array.from([0xaa]));
    await paneState("a")?.document.overwrite(0x11, Uint8Array.from([0xee]));

    vi.stubGlobal("window", { confirm: () => false });
    expect((await updateInParent(part)).kind).toBe("cancelled");
    expect((await bytesOf("a"))[0x10]).toBe(0x10);

    vi.stubGlobal("window", { confirm: () => true });
    expect((await updateInParent(part)).kind).toBe("updated");
    expect((await bytesOf("a"))[0x10]).toBe(0xaa);
  });

  /** The parent is gone: there is nothing to put the bytes into, and it says so. */
  it("refuses a part whose parent has closed", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    await paneState(part)?.document.overwrite(0, Uint8Array.from([0xaa]));
    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));

    expect((await updateInParent(part)).kind).toBe("refused");
    expect(workspaceStore.getSnapshot().alert?.title).toBe("The parent is closed");
  });
});

describe("what closing a parent would strand", () => {
  /**
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testClosingTheParentBreaksTheLink
   * @upstream ByteRipperTests/FragmentToolTests.swift#FragmentToolTests.testClosingAPanelOthersCameOutOfAsksFirst
   */
  it("is the parts that came out of it", async () => {
    await fileInA();
    const first = await partOfA(0x10, 0x20);
    const second = await partOfA(0x20, 0x30);

    expect(partsLinkedTo("a").sort()).toEqual([first, second].sort());
    expect(partsLinkedTo(first)).toEqual([]);
  });

  /** @upstream ByteRipperTests/FragmentToolTests.swift#FragmentToolTests.testTheTabCountsWhatItWouldAskAbout */
  it("is said in the singular for one and the plural for more", () => {
    expect(strandingSentence(1)).toContain("One panel was opened out of it");
    expect(strandingSentence(3)).toContain("3 panels were opened out of it");
    expect(strandingCloseButton(1)).toBe("Close and Break Link");
    expect(strandingCloseButton(2)).toBe("Close and Break Links");
  });
});
