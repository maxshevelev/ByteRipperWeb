import { afterEach, describe, expect, it } from "vitest";
import { DocumentOrigin } from "@/state/documentOrigin";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  openEmptyInPane,
  openInPane,
  openPart,
  type PaneId,
  paneState,
  revertPane,
  workspaceStore,
} from "@/state/workspaceStore";
import { type PaneMenuActions, paneFileMenu } from "@/ui/shell/paneMenus";

/**
 * Revert, in a part's panel: what Revert to Saved is for a document that has no
 * file — it goes back to the bytes the panel was opened with, and the part
 * stays linked to the parent it came out of.
 *
 * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests
 */

afterEach(() => {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

/** The parent's bytes: a run this part is a stretch of. */
const parentBytes = () => Uint8Array.from({ length: 0x100 }, (_, index) => index & 0xff);

/** A file in slot A, and a part taken out of it at [0x20, 0x40). */
async function openPartOfA(): Promise<PaneId> {
  const bytes = parentBytes();
  openInPane("a", {
    name: "dump.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([bytes]),
  });
  const content = bytes.slice(0x20, 0x40);
  const origin = await DocumentOrigin.of({
    parent: "a",
    source: [0x20, 0x40],
    partName: "Body",
    content,
  });
  return openPart(content, "dump_Body.bin", origin);
}

const byteAt = async (pane: PaneId, at: number): Promise<number | undefined> => {
  const document = paneState(pane)?.document;
  return document === undefined ? undefined : (await document.read(at, 1))[0];
};

/** What the pane's own header menu titles Revert, and whether it can act. */
function revertEntry(pane: PaneId): { label: string; disabled: boolean } | undefined {
  const actions = new Proxy({}, { get: () => () => undefined }) as PaneMenuActions;
  const found = paneFileMenu(workspaceStore.getSnapshot(), pane, actions).find(
    (entry) => entry !== undefined && "onSelect" in entry && entry.label.startsWith("Revert")
  ) as { label: string; disabled?: boolean } | undefined;
  return found === undefined
    ? undefined
    : { label: found.label, disabled: found.disabled === true };
}

describe("Revert in a part's panel", () => {
  // @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testRevertToOriginalGoesBackToTheBytesTheTabOpenedWith
  it("goes back to the bytes the panel opened with, and stays linked", async () => {
    const part = await openPartOfA();
    const document = paneState(part)?.document;
    if (document === undefined) throw new Error("the part should be open");
    const origin = paneState(part)?.origin;
    if (origin === undefined) throw new Error("the part should be linked");

    expect(revertEntry(part)).toEqual({ label: "Revert to Original", disabled: true });

    await document.overwrite(0x10, new Uint8Array([0x55]));
    expect(await byteAt(part, 0x10)).toBe(0x55);
    expect(document.isDirty).toBe(true);
    expect(await origin.hasChanges(document)).toBe(true);
    expect(revertEntry(part)).toEqual({ label: "Revert to Original", disabled: false });

    await revertPane(part);

    // 0x30 in the parent is 0x10 in the part: the byte it was opened with.
    expect(await byteAt(part, 0x10)).toBe(0x30);
    expect(document.isDirty).toBe(false);
    expect(document.canUndo).toBe(false);
    expect(paneState(part)?.origin).toBe(origin);
    expect(await origin.hasChanges(document)).toBe(false);
  });

  // The bytes it went back to are the ones it is now read as modified against,
  // so nothing in the panel is painted red after a revert.
  it("leaves the part reading as unmodified", async () => {
    const part = await openPartOfA();
    const document = paneState(part)?.document;
    if (document === undefined) throw new Error("the part should be open");
    await document.overwrite(0, new Uint8Array([0xff]));

    await revertPane(part);

    const saved = paneState(part)?.saved;
    if (saved === undefined) throw new Error("a part reads as modified against its own bytes");
    expect(saved.size).toBe(document.size);
    expect(Array.from(await saved.read(0, document.size))).toEqual(
      Array.from(await document.read(0, document.size))
    );
  });

  // Upstream's one item, titled for the pane it acts on: a file goes back to
  // what is on disk, and a document with neither a file nor a parent — a New
  // File — has nothing to go back to.
  // @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testRevertToOriginalGoesBackToTheBytesTheTabOpenedWith
  it("is titled for the pane it acts on", async () => {
    await openPartOfA();

    expect(revertEntry("a")?.label).toBe("Revert to Saved");

    // Dirty, and still refused: there is nothing behind it to go back to, and
    // the empty placeholder it was opened over is not an answer.
    openEmptyInPane("b");
    await paneState("b")?.document.overwrite(0, new Uint8Array([1, 2, 3]));
    expect(paneState("b")?.document.isDirty).toBe(true);
    expect(revertEntry("b")).toEqual({ label: "Revert to Saved", disabled: true });
  });
});
