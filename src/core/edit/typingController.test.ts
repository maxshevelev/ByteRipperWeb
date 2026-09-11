import { describe, expect, it } from "vitest";
import type { DiffEdit } from "@/core/diff/diffEngine";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt, selection } from "@/core/document/selectionModel";
import { SERIES_BREAK_MS, TypingController } from "@/core/edit/typingController";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";

/**
 * Ported from the editing half of `PaneViewModel` and its app-level tests.
 *
 * A clock that only moves when a test moves it: the typing series depends on
 * real elapsed time, and a test that depended on how fast the machine ran it
 * would be a test that fails on a busy laptop.
 */
function setUp(bytes: number[]) {
  const doc = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));
  let clock = 1000;
  const edits: DiffEdit[] = [];
  const reveals: number[] = [];

  const typing = new TypingController(doc, {
    now: () => clock,
    onEdit: (edit) => edits.push(edit),
    onReveal: (offset) => reveals.push(offset),
  });

  return {
    doc,
    typing,
    edits,
    reveals,
    advanceClock: (ms: number) => {
      clock += ms;
    },
    content: async () => asArray(await readAll(doc.storage)),
    /** Types a run of hex digits, as a person would. */
    hex: async (digits: string) => {
      for (const character of digits) await typing.typeHexDigit(Number.parseInt(character, 16));
    },
  };
}

describe("typing hex, in overwrite mode", () => {
  it("writes a byte as two nibbles and undoes it in one press", async () => {
    const t = setUp([0x00, 0x11, 0x22]);
    await t.hex("a5");

    expect(await t.content()).toEqual([0xa5, 0x11, 0x22]);
    expect(t.doc.caret).toBe(1); // advanced past the finished byte

    await t.doc.undo();
    expect(await t.content()).toEqual([0x00, 0x11, 0x22]);
    expect(t.doc.canUndo).toBe(false);
  });

  it("shows the high nibble before the low one is typed", async () => {
    // The byte is written twice, and the half-typed state is visible — which is
    // the point: you can see what you are doing.
    const t = setUp([0x00]);
    await t.typing.typeHexDigit(0xa);
    expect(await t.content()).toEqual([0xa0]);
    expect(t.typing.nibble).toBe(1);
    expect(t.doc.caret).toBe(0); // the caret stays on the byte being typed

    await t.typing.typeHexDigit(0x5);
    expect(await t.content()).toEqual([0xa5]);
    expect(t.typing.nibble).toBe(0);
  });

  it("keeps the nibble it is not writing", async () => {
    const t = setUp([0xff]);
    await t.typing.typeHexDigit(0x3);
    expect(await t.content()).toEqual([0x3f]); // low nibble untouched
    await t.typing.typeHexDigit(0xc);
    expect(await t.content()).toEqual([0x3c]);
  });

  it("types a run across several bytes", async () => {
    const t = setUp([0, 0, 0, 0]);
    await t.hex("deadbeef");
    expect(await t.content()).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(t.doc.caret).toBe(4);
  });

  it("ignores anything that is not a hex digit", async () => {
    const t = setUp([0x00]);
    await t.typing.typeHexDigit(16);
    await t.typing.typeHexDigit(-1);
    await t.typing.typeHexDigit(1.5);
    expect(await t.content()).toEqual([0x00]);
    expect(t.doc.isDirty).toBe(false);
  });
});

describe("typing into a selection", () => {
  it("consumes it byte by byte, and the remainder stays visible", async () => {
    const t = setUp([1, 2, 3, 4, 5]);
    t.doc.setSelection(selection(1, 4, t.doc.size));

    await t.hex("aa");
    expect(await t.content()).toEqual([1, 0xaa, 3, 4, 5]);
    // The unconsumed part of the selection is what is left.
    expect(t.doc.selection).toEqual(selection(2, 4, 5));

    await t.hex("bb");
    expect(t.doc.selection).toEqual(selection(3, 4, 5));
    await t.hex("cc");
    // Consumed to the end: the selection collapses to a caret past it.
    expect(t.doc.selection).toEqual(caretAt(4, 5));
    expect(await t.content()).toEqual([1, 0xaa, 0xbb, 0xcc, 5]);
  });

  it("asks for the selection's start to be revealed before typing blind", async () => {
    // After Select All, or any selection scrolled away from, the bytes land
    // somewhere that may not be on screen.
    const t = setUp([1, 2, 3, 4, 5]);
    t.doc.setSelection(selection(3, 5, t.doc.size));
    await t.typing.typeHexDigit(0xf);
    expect(t.reveals).toEqual([3]);
  });

  it("undoes the whole consumed run when it was one gesture", async () => {
    const t = setUp([1, 2, 3, 4, 5]);
    t.doc.setSelection(selection(1, 4, t.doc.size));
    await t.hex("aabbcc");

    // A deliberate undo takes back one byte; the fast repeat takes the rest.
    await t.doc.undo(false);
    expect(await t.content()).toEqual([1, 0xaa, 0xbb, 4, 5]);
    await t.doc.undo(true);
    expect(await t.content()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the typing series", () => {
  it("makes an uninterrupted run one fast-undo gesture", async () => {
    const t = setUp([0, 0, 0]);
    await t.hex("112233");

    await t.doc.undo(false); // one byte
    expect(await t.content()).toEqual([0x11, 0x22, 0x00]);
    await t.doc.undo(true); // the rest of the run
    expect(await t.content()).toEqual([0, 0, 0]);
    expect(t.doc.canUndo).toBe(false);
  });

  it("is broken by a pause", async () => {
    const t = setUp([0, 0, 0]);
    await t.hex("1122");
    t.advanceClock(SERIES_BREAK_MS + 1);
    await t.hex("33");

    await t.doc.undo(false); // the byte after the pause
    expect(await t.content()).toEqual([0x11, 0x22, 0x00]);
    // The batch cannot reach across the pause into the earlier series.
    await t.doc.undo(true);
    expect(await t.content()).toEqual([0x11, 0x00, 0x00]);
  });

  it("is broken by a caret move", async () => {
    const t = setUp([0, 0, 0, 0]);
    await t.hex("1122");
    await t.typing.breakRun();
    t.doc.setSelection(caretAt(3, t.doc.size));
    await t.hex("33");

    await t.doc.undo(false);
    expect(await t.content()).toEqual([0x11, 0x22, 0x00, 0x00]);
    await t.doc.undo(true);
    expect(await t.content()).toEqual([0x11, 0x00, 0x00, 0x00]);
  });

  it("is broken by changing column", async () => {
    // The hex and text columns are different gestures even on the same byte.
    const t = setUp([0, 0, 0]);
    await t.hex("11");
    await t.typing.setInputRegion("text");
    await t.typing.typeByte(0x41);

    await t.doc.undo(false);
    expect(await t.content()).toEqual([0x11, 0x00, 0x00]);
  });
});

describe("typing into the text column", () => {
  it("writes a whole byte in one step", async () => {
    const t = setUp([0, 0, 0]);
    await t.typing.setInputRegion("text");
    await t.typing.typeByte(0x41);
    await t.typing.typeByte(0x42);

    expect(await t.content()).toEqual([0x41, 0x42, 0x00]);
    expect(t.doc.caret).toBe(2);

    await t.doc.undo(false);
    expect(await t.content()).toEqual([0x41, 0x00, 0x00]);
  });
});

describe("insert mode", () => {
  it("inserts a byte and fills its low nibble in place", async () => {
    const t = setUp([0x11, 0x22]);
    await t.typing.setInsertMode(true);
    expect(t.typing.modeLabel).toBe("INS");

    await t.typing.typeHexDigit(0xa);
    // The tail shifted right and the new byte's low half is empty.
    expect(await t.content()).toEqual([0xa0, 0x11, 0x22]);
    expect(t.typing.nibble).toBe(1);

    await t.typing.typeHexDigit(0x5);
    expect(await t.content()).toEqual([0xa5, 0x11, 0x22]);
    expect(t.doc.caret).toBe(1);
  });

  it("undoes an inserted byte in one press, shrinking the file back", async () => {
    const t = setUp([0x11, 0x22]);
    await t.typing.setInsertMode(true);
    await t.hex("a5");
    expect(t.doc.size).toBe(3);

    await t.doc.undo();
    expect(await t.content()).toEqual([0x11, 0x22]);
    expect(t.doc.size).toBe(2);
  });

  it("inserts a whole byte from the text column", async () => {
    const t = setUp([0x11]);
    await t.typing.setInsertMode(true);
    await t.typing.setInputRegion("text");
    await t.typing.typeByte(0x41);
    expect(await t.content()).toEqual([0x41, 0x11]);
  });

  it("drops a selection rather than consuming it", async () => {
    // A highlight left standing would name bytes that have since shifted right.
    const t = setUp([1, 2, 3, 4, 5]);
    t.doc.setSelection(selection(1, 4, t.doc.size));
    await t.typing.setInsertMode(true);
    await t.hex("ff");

    expect(await t.content()).toEqual([1, 0xff, 2, 3, 4, 5]);
    expect(t.doc.selection).toEqual(caretAt(2, 6));
  });

  it("asks once before the first edit that shifts the file", async () => {
    let asked = 0;
    const doc = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array([1, 2]))));
    const typing = new TypingController(doc, {
      confirmInsertShift: () => {
        asked++;
        return true;
      },
    });
    await typing.setInsertMode(true);
    await typing.typeHexDigit(0xa);
    await typing.typeHexDigit(0x5);
    await typing.typeHexDigit(0xb);
    expect(asked).toBe(1);
  });

  it("swallows the keystroke when the answer is no", async () => {
    const doc = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array([1, 2]))));
    const typing = new TypingController(doc, { confirmInsertShift: () => false });
    await typing.setInsertMode(true);
    await typing.typeHexDigit(0xa);

    expect(asArray(await readAll(doc.storage))).toEqual([1, 2]);
    expect(doc.isDirty).toBe(false);
  });
});

describe("delete and backspace", () => {
  it("fills with zero in overwrite mode, leaving the length alone", async () => {
    const t = setUp([1, 2, 3, 4]);
    t.doc.setSelection(caretAt(1, t.doc.size));
    await t.typing.deleteForward();

    expect(await t.content()).toEqual([1, 0, 3, 4]);
    expect(t.doc.size).toBe(4);
    expect(t.doc.caret).toBe(1);
  });

  it("fills a whole selection with zero", async () => {
    const t = setUp([1, 2, 3, 4]);
    t.doc.setSelection(selection(1, 3, t.doc.size));
    await t.typing.deleteForward();
    expect(await t.content()).toEqual([1, 0, 0, 4]);
  });

  it("takes the byte before the caret on backspace", async () => {
    const t = setUp([1, 2, 3, 4]);
    t.doc.setSelection(caretAt(2, t.doc.size));
    await t.typing.deleteBackward();
    expect(await t.content()).toEqual([1, 0, 3, 4]);
  });

  it("removes bytes and shifts the tail in insert mode", async () => {
    const t = setUp([1, 2, 3, 4]);
    await t.typing.setInsertMode(true);
    t.doc.setSelection(caretAt(1, t.doc.size));
    await t.typing.deleteForward();

    expect(await t.content()).toEqual([1, 3, 4]);
    expect(t.doc.size).toBe(3);
  });

  it("does nothing at the file's edges", async () => {
    const t = setUp([1, 2]);
    t.doc.setSelection(caretAt(0, t.doc.size));
    await t.typing.deleteBackward();
    expect(await t.content()).toEqual([1, 2]);

    t.doc.setSelection(caretAt(2, t.doc.size));
    await t.typing.deleteForward();
    expect(await t.content()).toEqual([1, 2]);
    expect(t.doc.isDirty).toBe(false);
  });
});

describe("what the comparison is told", () => {
  it("names the window each keystroke changed", async () => {
    const t = setUp([0, 0, 0]);
    await t.hex("a5");
    expect(t.edits).toEqual([
      { kind: "overwrite", start: 0, end: 1 },
      { kind: "overwrite", start: 0, end: 1 },
    ]);
  });

  it("names an insert as an insert, so the tail is rescanned", async () => {
    const t = setUp([1, 2]);
    await t.typing.setInsertMode(true);
    await t.typing.typeHexDigit(0xa);
    expect(t.edits).toEqual([{ kind: "insert", at: 0, length: 1 }]);
  });
});

describe("keystrokes that arrive faster than the bytes can be read", () => {
  it("still compose the byte they were meant to", async () => {
    // The browser divergence: every edit is asynchronous, so two fast digits
    // can overlap. Without the queue the low nibble reads the byte as it was
    // *before* the high nibble landed and writes 0x05 instead of 0xa5.
    const t = setUp([0x00, 0x00]);
    const first = t.typing.typeHexDigit(0xa);
    const second = t.typing.typeHexDigit(0x5);
    await Promise.all([first, second]);

    expect(await t.content()).toEqual([0xa5, 0x00]);
  });

  it("keeps a whole run in order", async () => {
    const t = setUp([0, 0, 0, 0]);
    await Promise.all(
      [0xd, 0xe, 0xa, 0xd, 0xb, 0xe, 0xe, 0xf].map((digit) => t.typing.typeHexDigit(digit))
    );
    expect(await t.content()).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});
