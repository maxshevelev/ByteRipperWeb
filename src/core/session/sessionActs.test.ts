import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { SessionActs } from "@/core/session/sessionActs";
import { CutHistory } from "@/core/session/sessionCuts";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { storageOver } from "@/core/testing/support";

/**
 * A session's two histories in the order things happened: one press takes back the last act,
 * whichever history holds it, and the partition comes back as it was rather than as the inverse
 * edits leave it.
 */

function session(size: number) {
  const document = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(size))));
  const cuts = new CutHistory(size);
  const acts = new SessionActs(document, cuts);
  document.onTransactionCommitted(() => acts.noteDocument());
  const cut = (offset: number) => {
    const next = cuts.partition.addCut(offset);
    if (next !== undefined && cuts.apply(next)) acts.noteCuts();
  };
  return { document, cuts, acts, cut };
}

describe("a press of Undo", () => {
  it("takes back the last act, an edit or a cut, in the order they happened", async () => {
    const { document, cuts, acts, cut } = session(64);
    await document.overwrite(0, Uint8Array.of(1));
    cut(32);
    await document.overwrite(1, Uint8Array.of(2));

    expect(await acts.undo(false)).toHaveLength(1);
    expect(cuts.partition.cuts, "the edit went, the cut stays").toEqual([32]);
    expect(await acts.undo(false)).toEqual([]);
    expect(cuts.partition.cuts).toEqual([]);
    expect(document.canUndo, "the first edit is still there").toBe(true);
    expect(await acts.undo(false)).toHaveLength(1);
    expect(acts.canUndo).toBe(false);
  });

  it("names the step after the document's transaction, and a cut after nothing", async () => {
    const { document, acts, cut } = session(64);
    document.beginEditGroup("Add Microcode");
    await document.insert(0, Uint8Array.of(1));
    document.endEditGroup();
    expect(acts.undoLabel).toBe("Add Microcode");
    cut(8);
    expect(acts.undoLabel).toBeUndefined();
  });
});

describe("a redo", () => {
  it("puts back a cut that an edit in between swallowed and gave back", async () => {
    const { cuts, acts, cut } = session(64);
    cut(32);
    await acts.undo(false);
    expect(cuts.partition.cuts).toEqual([]);

    // What undoing and redoing a join does to the partition waiting to be redone: the bytes around
    // the cut go, and come back.
    cuts.noteEdit({ kind: "delete", start: 24, end: 40 }, 48);
    cuts.noteEdit({ kind: "insert", at: 24, length: 16 }, 64);

    await acts.redo();
    expect(cuts.partition.cuts).toEqual([32]);
  });
});

describe("a group", () => {
  it("is taken back to the partition it started from, and redone to the one it left", async () => {
    const { cuts, acts } = session(64);
    acts.beginGroup();
    const named = cuts.partition.addCut(48)?.rename(0, "bios.bin");
    if (named !== undefined && cuts.apply(named)) acts.noteCuts();
    if (cuts.apply(cuts.partition.rename(1, "donor.bin"))) acts.noteCuts();
    acts.endGroup();
    expect(cuts.partition.cuts).toEqual([48]);

    await acts.undo(false);
    expect(cuts.partition.cuts).toEqual([]);
    expect(cuts.partition.segments.map((one) => one.name)).toEqual([""]);

    // As a join's undo leaves it: the joined bytes gone and back.
    cuts.noteEdit({ kind: "delete", start: 48, end: 64 }, 48);
    cuts.noteEdit({ kind: "insert", at: 48, length: 16 }, 64);

    await acts.redo();
    expect(cuts.partition.cuts).toEqual([48]);
    expect(cuts.partition.segments.map((one) => one.name)).toEqual(["bios.bin", "donor.bin"]);
  });

  it("is one press for the bytes and the cut a join makes", async () => {
    const { document, cuts, acts, cut } = session(16);
    acts.beginGroup();
    await document.insert(16, new Uint8Array(16));
    cut(16);
    acts.endGroup();
    await acts.undo(false);
    expect(document.size).toBe(16);
    expect(cuts.partition.cuts).toEqual([]);
    expect(acts.canUndo).toBe(false);
  });
});

describe("a history with nothing recorded of it", () => {
  it("still takes back what the document knows — after a restore, or past the limit", async () => {
    const { document, acts } = session(8);
    await document.overwrite(0, Uint8Array.of(1));
    acts.forget();
    expect(acts.canUndo).toBe(true);
    expect(await acts.undo(false)).toHaveLength(1);
    expect(document.canUndo).toBe(false);
  });

  it("comes back as it was written down", async () => {
    const { document, cuts, acts, cut } = session(64);
    await document.overwrite(0, Uint8Array.of(1));
    cut(32);
    const { past, future } = acts.recorded;
    acts.forget();
    acts.restore(past, future);
    await acts.undo(false);
    expect(cuts.partition.cuts).toEqual([]);
    expect(document.canUndo).toBe(true);
  });
});
