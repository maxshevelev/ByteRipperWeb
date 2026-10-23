import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyPartCodec } from "@/core/parts/partCodec";
import { DocumentOrigin } from "@/state/documentOrigin";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart } from "@/state/openLinkedPart";
import { takeOpensTopLevelRows } from "@/state/opensTopLevelRows";
import {
  partsLinkedTo,
  strandingCloseButton,
  strandingSentence,
  updateInParent,
  updateInParentItem,
} from "@/state/partUpdate";
import { releaseSession } from "@/state/sessions/pageSessions";
import { openGivenPart } from "@/state/testing/givenParts";
import { sessionOn, toolController } from "@/state/toolController";
import { bringPane } from "@/state/workspace/paneTransfer";
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
async function partOfA(start: number, end: number, name = "zone"): Promise<PartId> {
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  return openGivenPart({
    parent: "a",
    bytes: await slot.document.read(start, end - start),
    name,
    source: [start, end],
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
   * The verdicts are about the bytes, and a part typed back to what it was has
   * nothing to put back — which is also what keeps the walk that answers this
   * honest: it stops at the first byte that differs and remembers where, so the
   * byte that stopped it is the first one checked next time.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testTheLinkFollowsTheSourceBytes
   */
  it("has nothing to put back once the part is what it was", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;
    const document = paneState(part)?.document;
    if (origin === undefined || document === undefined) throw new Error("the part should be open");

    await document.overwrite(8, Uint8Array.from([0xaa]));
    expect(await origin.hasChanges(document)).toBe(true);
    // A second edit, further in: the first is still what the walk finds first.
    await document.overwrite(12, Uint8Array.from([0xbb]));
    expect(await origin.hasChanges(document)).toBe(true);

    await document.overwrite(8, Uint8Array.from([0x18]));
    expect(await origin.hasChanges(document)).toBe(true);
    await document.overwrite(12, Uint8Array.from([0x1c]));
    expect(await origin.hasChanges(document)).toBe(false);
  });

  /**
   * An edit in the parent that does not touch the source leaves the link alone:
   * it is those bytes the link is about, not the whole file.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testTheLinkFollowsTheSourceBytes
   */
  it("is still intact when the parent changes elsewhere", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;

    await paneState("a")?.document.overwrite(0x30, Uint8Array.from([0xff]));

    expect(await origin?.state()).toBe("intact");
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
   * The header offers the update while the part holds bytes its parent does not
   * have, and takes it away once they are back; the update says last where it
   * can be undone — in the parent. The web's level is the answer the header's
   * button is shown by (`updateInParentItem`) and the alert the update leaves.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testTheHeaderOffersTheUpdateWhileThePartIsModified
   */
  it("is offered in the header while the part is modified, and says where undo takes it back", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    expect((await updateInParentItem(part)).enabled).toBe(false);

    await paneState(part)?.document.overwrite(0, Uint8Array.from([0x55]));
    expect((await updateInParentItem(part)).enabled).toBe(true);

    await updateInParent(part);

    expect((await bytesOf("a"))[0x10]).toBe(0x55);
    const alert = workspaceStore.getSnapshot().alert;
    expect(alert?.title).toBe("Updated “bios.bin”");
    expect(alert?.message).toBe("Undo in “bios.bin” takes it back.");
    expect(alert?.outcome).toBe("success");
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

describe("a part opened with a tool on", () => {
  /**
   * A node taken out of a UEFI tree opens with UEFI Structure on in its panel and the tree's
   * first level open.
   *
   * @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testANodeOpenedAsAPanelOpensWithItsTreeShown
   * @upstream-differs at the state: the tool is on the part's surface and the wish to open its
   * first level is there to be taken once; the rows opening is the panel's own
   */
  it("switches the tool on in the part's panel and wishes its top level open", async () => {
    await fileInA();
    const part = await openLinkedPart({
      parent: "a",
      name: "bios_node.bin",
      source: [0x10, 0x20],
      tool: "dev.maxik.tool.uefi-structure",
    });
    if (part === undefined) throw new Error("the part did not open");

    expect(sessionOn(toolController.getSnapshot(), part).activeIdentifier).toBe(
      "dev.maxik.tool.uefi-structure"
    );
    expect(takeOpensTopLevelRows(part)).toBe(true);
    expect(takeOpensTopLevelRows(part)).toBe(false);
  });

  it("switches nothing on for a part opened with no tool", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);

    expect(sessionOn(toolController.getSnapshot(), part).activeIdentifier).toBeUndefined();
    expect(takeOpensTopLevelRows(part)).toBe(false);
  });
});

describe("the link of a part let go on a pane", () => {
  /**
   * The link is the part's own, so it goes where the part goes: let go on a pane, the pane is
   * still linked to the zone it came out of, and Update in Parent still knows where the bytes go.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAPartTornOffIntoATabKeepsItsLink
   */
  it("goes with it, and the bytes still go back where they came from", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);

    await bringPane(undefined, part, "b", false);

    expect(workspaceStore.getSnapshot().parts).toEqual({});
    const origin = paneState("b")?.origin;
    expect(origin?.parent).toBe("a");
    expect(await origin?.state()).toBe("intact");
    await paneState("b")?.document.overwrite(0, Uint8Array.from([0x55]));
    expect((await updateInParent("b")).kind).toBe("updated");
    expect((await bytesOf("a"))[0x10]).toBe(0x55);
  });

  /**
   * A parent shown in another window is no pane of this one, but its session is the same one
   * every window reaches: the link reads it and writes into it there.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAPartTornOffIntoATabKeepsItsLink
   */
  it("finds a parent another window shows", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const parent = paneState("a")?.document;
    const carried = paneState(part)?.origin?.carry();
    if (parent === undefined || carried === undefined) throw new Error("the part should be open");
    // The parent goes on in another window: its pane goes here, its session does not.
    releaseSession(parent);
    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));
    const origin = await DocumentOrigin.carried({ ...carried, codec: new CopyPartCodec() });

    expect(origin?.parent).toBeUndefined();
    expect(await origin?.state()).toBe("intact");
    expect(origin?.parentName).toBe("bios.bin");
    await parent.overwrite(0x11, Uint8Array.from([0xff]));
    expect(await origin?.state()).toBe("sourceChanged");
    origin?.release();
  });

  it("is broken once the parent's session ends, wherever it was shown", async () => {
    await fileInA();
    const part = await partOfA(0x10, 0x20);
    const origin = paneState(part)?.origin;
    await bringPane(undefined, part, "b", false);

    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));

    expect(await paneState("b")?.origin?.state()).toBe("parentClosed");
    expect(paneState("b")?.origin?.sourceRange).toEqual(origin?.sourceRange);
  });
});
