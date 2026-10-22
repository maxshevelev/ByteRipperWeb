import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";
import { carryHistory, putBackHistory } from "@/state/workspace/carriedHistory";

/**
 * A pane carried to another window takes its undo history with it: written out as plain data —
 * what a `BroadcastChannel` clones — and put back over the same content there, it undoes and
 * redoes as it did in the window it came from (`Design/DESKTOP_WINDOWS.md`, D5).
 */

const documentOf = (bytes: number[]) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));

const content = async (doc: BinaryDocument) => asArray(await readAll(doc.storage));

describe("an undo history carried to another window", () => {
  it("undoes and redoes there as it did here, a fill's pattern and a step's name with it", async () => {
    const original = Array(32).fill(0);
    const doc = documentOf(original);
    await doc.overwrite(0, new Uint8Array([1, 1]));
    doc.markSaved();
    await doc.fill(new Uint8Array([0xab, 0xcd]), 8, 20);
    doc.beginEditGroup("Add Microcode");
    await doc.insert(4, new Uint8Array([7, 7, 7]));
    doc.endEditGroup();
    await doc.undo(); // one step to redo over there

    const carried = await carryHistory(doc.undoHistory);
    if (carried === undefined) throw new Error("nothing carried");
    const crossed = structuredClone(carried);

    const there = documentOf(await content(doc));
    expect(putBackHistory(there.undoHistory, crossed)).toBe(true);
    expect(there.isDirty).toBe(true);
    expect(there.undoHistory.redoLabel).toBe("Add Microcode");
    await there.redo();
    await doc.redo();
    expect(await content(there)).toEqual(await content(doc));
    await there.undo();
    await there.undo();
    expect(there.isDirty, "back on the saved state").toBe(false);
    await there.undo();
    expect(await content(there)).toEqual(original);
  });

  it("carries nothing for a history with no step", async () => {
    expect(await carryHistory(documentOf([1, 2, 3]).undoHistory)).toBeUndefined();
  });
});
