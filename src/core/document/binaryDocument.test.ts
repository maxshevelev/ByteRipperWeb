import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt, selection, selectionOfLength } from "@/core/document/selectionModel";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";

/**
 * Ported from `BinaryDocumentTests.swift`.
 *
 * Its save, Save As, read-only and revert-from-disk cases are not here: those
 * are the file layer, which arrives in M4. `markSaved()` stands in where a test
 * only needs the checkpoint the save path would set.
 */

const documentOf = (bytes: number[]) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));

const content = async (doc: BinaryDocument) => asArray(await readAll(doc.storage));

describe("a freshly opened document", () => {
  it("exposes its size and nothing to undo", () => {
    const doc = documentOf([0x01, 0x02, 0x03]);
    expect(doc.size).toBe(3);
    expect(doc.isDirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
    expect(doc.selection).toEqual(caretAt(0, 3));
  });
});

describe("every mutation is one undoable transaction", () => {
  // It changes the content, marks the document dirty, and a single undo takes
  // the file back to exactly what it was opened with — with nothing left to
  // undo behind it.
  const cases: {
    name: string;
    initial: number[];
    mutate: (doc: BinaryDocument) => Promise<void>;
    edited: number[];
  }[] = [
    {
      name: "overwrite",
      initial: [0x00, 0x01, 0x02, 0x03],
      mutate: (doc) => doc.overwrite(1, new Uint8Array([0xaa])),
      edited: [0x00, 0xaa, 0x02, 0x03],
    },
    {
      name: "insert",
      initial: [0x00, 0x01, 0x02, 0x03],
      mutate: (doc) => doc.insert(2, new Uint8Array([0xff, 0xfe])),
      edited: [0x00, 0x01, 0xff, 0xfe, 0x02, 0x03],
    },
    {
      name: "delete",
      initial: [0x00, 0x01, 0x02, 0x03, 0x04],
      mutate: (doc) => doc.delete(1, 3),
      edited: [0x00, 0x03, 0x04],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const doc = documentOf(testCase.initial);
      await testCase.mutate(doc);
      expect(await content(doc)).toEqual(testCase.edited);
      expect(doc.isDirty).toBe(true);

      await doc.undo();
      expect(await content(doc)).toEqual(testCase.initial);
      expect(doc.canUndo).toBe(false); // one edit, one undo

      await doc.redo();
      expect(await content(doc)).toEqual(testCase.edited);
      expect(doc.canUndo).toBe(true);
    });
  }
});

describe("fill", () => {
  const cases: {
    name: string;
    initial: number[];
    pattern: number[];
    start: number;
    end: number;
    expected: number[];
  }[] = [
    {
      name: "the pattern repeats and is cut off at the range's end",
      initial: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06],
      pattern: [0xde, 0xad],
      start: 1,
      end: 6,
      expected: [0x01, 0xde, 0xad, 0xde, 0xad, 0xde],
    },
    {
      name: "a pattern longer than the range is truncated",
      initial: [0x01, 0x02, 0x03],
      pattern: [0xaa, 0xbb, 0xcc, 0xdd],
      start: 1,
      end: 3,
      expected: [0x01, 0xaa, 0xbb],
    },
    {
      name: "a range past EOF is clamped, and the file does not grow",
      initial: [0x01, 0x02, 0x03],
      pattern: [0xff],
      start: 1,
      end: 10,
      expected: [0x01, 0xff, 0xff],
    },
    {
      name: "an empty pattern is a no-op",
      initial: [0x01, 0x02, 0x03],
      pattern: [],
      start: 0,
      end: 2,
      expected: [0x01, 0x02, 0x03],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const doc = documentOf(testCase.initial);
      await doc.fill(new Uint8Array(testCase.pattern), testCase.start, testCase.end);
      expect(await content(doc)).toEqual(testCase.expected);
      // Dirty only if something was actually written.
      expect(doc.isDirty).toBe(
        JSON.stringify(testCase.expected) !== JSON.stringify(testCase.initial)
      );
    });
  }

  it("is one transaction from either entry point", async () => {
    const doc = documentOf([0x01, 0x02, 0x03, 0x04]);
    await doc.fill(new Uint8Array([0xde, 0xad]), 0, 4);
    expect(await content(doc)).toEqual([0xde, 0xad, 0xde, 0xad]);

    await doc.undo();
    expect(await content(doc)).toEqual([0x01, 0x02, 0x03, 0x04]);
    await doc.redo();
    expect(await content(doc)).toEqual([0xde, 0xad, 0xde, 0xad]);

    const zeroed = documentOf([0x00, 0x01, 0x02, 0x03]);
    await zeroed.fillZero(1, 3);
    expect(await content(zeroed)).toEqual([0x00, 0x00, 0x00, 0x03]);

    await zeroed.undo();
    expect(await content(zeroed)).toEqual([0x00, 0x01, 0x02, 0x03]);
  });
});

describe("edits that change the length", () => {
  it("shrinks the file back when an overwrite past EOF is undone", async () => {
    const doc = documentOf([0x00, 0x01]);
    await doc.overwrite(1, new Uint8Array([0xaa, 0xbb]));
    expect(await content(doc)).toEqual([0x00, 0xaa, 0xbb]);
    expect(doc.size).toBe(3);

    await doc.undo();
    expect(await content(doc)).toEqual([0x00, 0x01]);
    expect(doc.size).toBe(2);

    await doc.redo();
    expect(await content(doc)).toEqual([0x00, 0xaa, 0xbb]);
  });

  it("deletes the leftover when a replacement is shorter", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03]);
    await doc.replace(1, 3, new Uint8Array([0xff]));
    expect(await content(doc)).toEqual([0x00, 0xff, 0x03]);

    await doc.undo();
    expect(await content(doc)).toEqual([0x00, 0x01, 0x02, 0x03]);
    await doc.redo();
    expect(await content(doc)).toEqual([0x00, 0xff, 0x03]);
  });

  it("clamps the selection when the file shrinks under it", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03]);
    doc.setSelection(selectionOfLength(1, 3, doc.size));
    expect(doc.selection).toEqual(selection(1, 4, 4));

    await doc.delete(1, 3);
    expect(doc.size).toBe(2);
    expect(doc.selection.fileSize).toBe(2);
    expect(doc.selection.end).toBe(2);
  });
});

describe("dirty state", () => {
  it("stays dirty after a save, an undo and a different edit", async () => {
    // It used to compare the number of edits standing, call that the saved
    // state, and let the change be closed away without a prompt.
    const doc = documentOf([0x00, 0x00, 0x00]);
    await doc.overwrite(0, new Uint8Array([0x11]));
    await doc.overwrite(1, new Uint8Array([0xbb]));
    doc.markSaved();
    expect(doc.isDirty).toBe(false);

    await doc.undo();
    expect(doc.isDirty).toBe(true); // one edit short of what was written

    await doc.overwrite(1, new Uint8Array([0xcc]));
    expect(await content(doc)).toEqual([0x11, 0xcc, 0x00]);
    expect(doc.isDirty).toBe(true); // what was saved holds BB there, not CC

    doc.markSaved();
    expect(doc.isDirty).toBe(false);
  });

  it("discards the redo stack on a fresh edit", async () => {
    const doc = documentOf([0x00]);
    await doc.overwrite(0, new Uint8Array([0xaa]));
    await doc.undo();
    expect(doc.canRedo).toBe(true);

    await doc.overwrite(0, new Uint8Array([0xbb]));
    expect(doc.canRedo).toBe(false);
    expect(await content(doc)).toEqual([0xbb]);

    await doc.undo();
    expect(await content(doc)).toEqual([0x00]);
    expect(await doc.undo()).toBeUndefined();
  });
});

describe("where undo and redo leave the caret", () => {
  it("returns to where the edit began, and forward to where it ended", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.setSelection(caretAt(3, doc.size));
    await doc.overwrite(3, new Uint8Array([0xff]));

    await doc.undo();
    expect(doc.selection.start).toBe(3);
    await doc.redo();
    expect(doc.selection.start).toBe(4);
  });

  it("does the same for an insert", async () => {
    const doc = documentOf([0x00, 0x01, 0x02]);
    doc.setSelection(caretAt(1, doc.size));
    await doc.insert(1, new Uint8Array([0xaa, 0xbb]));
    expect(doc.selection.start).toBe(1); // an insert does not move the caret

    await doc.undo();
    expect(doc.selection.start).toBe(1);
    await doc.redo();
    expect(doc.selection.start).toBe(3); // at + count
  });

  it("restores the whole selection, not just its caret", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.setSelection(selection(1, 4, doc.size));
    await doc.overwrite(1, new Uint8Array([0xff]));

    await doc.undo();
    expect(doc.selection).toEqual(selection(1, 4, 5));
  });

  it("redoes to the state the command left, remainder included", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.setSelection(selection(1, 4, doc.size));
    await doc.overwrite(1, new Uint8Array([0xff]));
    // What typing into a selection leaves: the unconsumed remainder.
    doc.setSelection(selection(2, 4, doc.size));
    doc.noteSelectionAfterEdit();

    await doc.undo();
    await doc.redo();
    expect(doc.selection).toEqual(selection(2, 4, 5));
  });

  it("does not attach a stray note to an older transaction", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03]);
    await doc.overwrite(0, new Uint8Array([0xaa]));
    await doc.overwrite(1, new Uint8Array([0xbb]));
    await doc.undo(); // the second edit is now on the redo stack

    doc.setSelection(selection(3, 4, doc.size));
    doc.noteSelectionAfterEdit();

    await doc.undo();
    await doc.redo();
    expect(doc.selection).toEqual(caretAt(1, 4)); // the first edit redoes to its own end
  });
});

describe("edit groups", () => {
  it("coalesce into one undo", async () => {
    const doc = documentOf([0x00, 0x01]);
    doc.beginEditGroup();
    await doc.overwrite(0, new Uint8Array([0xaa]));
    await doc.overwrite(1, new Uint8Array([0xbb]));
    doc.endEditGroup();

    expect(await content(doc)).toEqual([0xaa, 0xbb]);
    expect(doc.undoHistory.undoDepth).toBe(1);

    await doc.undo();
    expect(await content(doc)).toEqual([0x00, 0x01]);
  });

  it("restore the selection the group began with", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.setSelection(selection(2, 5, doc.size));
    doc.beginEditGroup();
    await doc.overwrite(2, new Uint8Array([0xf0]));
    await doc.overwrite(2, new Uint8Array([0xff])); // the second nibble
    doc.endEditGroup();

    await doc.undo();
    expect(doc.selection).toEqual(selection(2, 5, 5));
  });

  it("restore every byte a cancelled group touched", async () => {
    // The operations must be reverted newest first: reverting them in recording
    // order would make the second insert's inverse delete a byte that has
    // already moved.
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.beginEditGroup();
    await doc.insert(1, new Uint8Array([0xaa]));
    await doc.insert(3, new Uint8Array([0xbb]));
    await doc.overwrite(0, new Uint8Array([0x99]));
    expect(await content(doc)).toEqual([0x99, 0xaa, 0x01, 0xbb, 0x02, 0x03, 0x04]);

    await doc.cancelEditGroup();
    expect(await content(doc)).toEqual([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(doc.size).toBe(5);
  });

  it("record nothing when cancelled, and restore their start selection", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    await doc.overwrite(4, new Uint8Array([0x44])); // one committed edit behind the group
    expect(doc.undoHistory.undoDepth).toBe(1);

    doc.setSelection(selection(2, 4, doc.size));
    doc.beginEditGroup();
    await doc.insert(2, new Uint8Array([0xf0]));
    doc.setSelection(caretAt(3, doc.size));
    await doc.cancelEditGroup();

    expect(doc.undoHistory.undoDepth).toBe(1);
    expect(doc.canRedo).toBe(false);
    expect(doc.selection).toEqual(selection(2, 4, 5));

    // And the one undo left on the stack is the edit from before the group.
    await doc.undo();
    expect(await content(doc)).toEqual([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(doc.canUndo).toBe(false);
  });
});

describe("a typing series", () => {
  it("undoes a byte, then the rest in one batch, and redoes symmetrically", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03]);
    doc.beginSeries(1);
    // The caret advances between bytes, as the view model does.
    await doc.overwrite(0, new Uint8Array([0xa0]));
    doc.setSelection(caretAt(1, doc.size));
    await doc.overwrite(1, new Uint8Array([0xa1]));
    doc.setSelection(caretAt(2, doc.size));
    await doc.overwrite(2, new Uint8Array([0xa2]));
    doc.setSelection(caretAt(3, doc.size));
    doc.endSeries();

    await doc.undo(false);
    expect(await content(doc)).toEqual([0xa0, 0xa1, 0x02, 0x03]);
    expect(doc.selection.start).toBe(2); // where the removed byte was

    await doc.undo(true);
    expect(await content(doc)).toEqual([0x00, 0x01, 0x02, 0x03]);
    expect(doc.selection.start).toBe(0); // the start of the series
    expect(doc.canUndo).toBe(false);

    await doc.redo();
    expect(await content(doc)).toEqual([0xa0, 0xa1, 0x02, 0x03]);
    expect(doc.selection.start).toBe(2);
    await doc.redo();
    expect(await content(doc)).toEqual([0xa0, 0xa1, 0xa2, 0x03]);
    expect(doc.selection.start).toBe(3);
  });

  it("restores the selection typing consumed", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03, 0x04]);
    doc.setSelection(selection(2, 5, doc.size));
    doc.beginSeries(1);
    // Typing into a selection consumes it byte by byte.
    await doc.replace(2, 3, new Uint8Array([0xf0]));
    doc.setSelection(selection(3, 5, doc.size));
    doc.noteSelectionAfterEdit();
    await doc.replace(3, 4, new Uint8Array([0xf1]));
    doc.setSelection(selection(4, 5, doc.size));
    doc.noteSelectionAfterEdit();
    await doc.replace(4, 5, new Uint8Array([0xf2]));
    doc.setSelection(caretAt(5, doc.size));
    doc.noteSelectionAfterEdit();
    doc.endSeries();

    await doc.undo(false);
    expect(doc.selection).toEqual(selection(4, 5, 5));

    await doc.undo(true);
    expect(doc.selection).toEqual(selection(2, 5, 5));

    await doc.redo();
    expect(doc.selection).toEqual(selection(4, 5, 5));
    await doc.redo();
    expect(doc.selection).toEqual(caretAt(5, 5));
  });

  it("honours a fill's caret override in both directions", async () => {
    const doc = documentOf([0x00, 0x01, 0x02, 0x03]);
    doc.setSelection(selection(1, 3, doc.size));
    await doc.fill(new Uint8Array([0xff]), 1, 3, 1);

    await doc.undo();
    expect(doc.selection.start).toBe(1); // the selection start it began from

    await doc.redo();
    expect(doc.selection.start).toBe(1); // a fill leaves the caret at the range start
  });
});

describe("the events the UI listens to", () => {
  it("fires a commit for a forward edit and for a group's close, never for undo", async () => {
    const doc = documentOf([0x00, 0x01, 0x02]);
    let commits = 0;
    doc.onTransactionCommitted(() => commits++);

    await doc.overwrite(0, new Uint8Array([0xaa]));
    expect(commits).toBe(1);

    doc.beginEditGroup();
    await doc.overwrite(1, new Uint8Array([0xbb]));
    await doc.overwrite(2, new Uint8Array([0xcc]));
    expect(commits).toBe(1); // nothing is committed until the group closes
    doc.endEditGroup();
    expect(commits).toBe(2);

    await doc.undo();
    await doc.redo();
    expect(commits).toBe(2); // undo and redo restore, they do not record
  });

  it("does not fire a commit for a cancelled group", async () => {
    const doc = documentOf([0x00, 0x01]);
    let commits = 0;
    doc.onTransactionCommitted(() => commits++);

    doc.beginEditGroup();
    await doc.insert(0, new Uint8Array([0xff]));
    await doc.cancelEditGroup();
    expect(commits).toBe(0);
  });

  it("reports every byte change, restoring ones included", async () => {
    const doc = documentOf([0x00, 0x01, 0x02]);
    const changes: { count: number; restoring: boolean }[] = [];
    doc.onContentChanged((change) =>
      changes.push({ count: change.ops.length, restoring: change.restoring })
    );

    await doc.overwrite(0, new Uint8Array([0xaa]));
    await doc.undo();
    await doc.redo();

    expect(changes).toEqual([
      { count: 1, restoring: false },
      { count: 1, restoring: true },
      { count: 1, restoring: true },
    ]);
  });

  it("reports a selection change once, and not when nothing moved", () => {
    const doc = documentOf([0x00, 0x01, 0x02]);
    let changes = 0;
    const stop = doc.onSelectionChanged(() => changes++);

    doc.setSelection(caretAt(2, doc.size));
    expect(changes).toBe(1);
    doc.setSelection(caretAt(2, doc.size));
    expect(changes).toBe(1);

    stop();
    doc.setSelection(caretAt(0, doc.size));
    expect(changes).toBe(1);
  });
});

describe("reverting", () => {
  it("discards every edit and starts again over the storage it is given", async () => {
    const doc = documentOf([0x00, 0x01, 0x02]);
    await doc.overwrite(0, new Uint8Array([0xff]));
    doc.setSelection(caretAt(2, doc.size));
    expect(doc.isDirty).toBe(true);

    doc.revert(new MemoryBackedStorage(new Uint8Array([0x00, 0x01, 0x02])));

    expect(await content(doc)).toEqual([0x00, 0x01, 0x02]);
    expect(doc.isDirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
    expect(doc.selection).toEqual(caretAt(0, 3));
  });
});

describe("a half-typed byte", () => {
  it("counts as unsaved while its edit group is still open", async () => {
    // The bytes have already changed — the byte is on screen, in red — but the
    // transaction is not recorded until the group closes. Reporting clean there
    // is the one moment a close could discard a visible edit without asking.
    const doc = documentOf([0x00, 0x11]);
    doc.beginEditGroup();
    await doc.overwrite(0, new Uint8Array([0xa0]));

    expect(await content(doc)).toEqual([0xa0, 0x11]);
    expect(doc.isDirty).toBe(true);

    doc.endEditGroup();
    expect(doc.isDirty).toBe(true);
  });

  it("goes clean again when the group is cancelled", async () => {
    const doc = documentOf([0x00, 0x11]);
    doc.beginEditGroup();
    await doc.overwrite(0, new Uint8Array([0xa0]));
    await doc.cancelEditGroup();

    expect(await content(doc)).toEqual([0x00, 0x11]);
    expect(doc.isDirty).toBe(false);
  });
});
