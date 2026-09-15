import { describe, expect, it } from "vitest";
import {
  detectKeyboardPlatform,
  type HexKeyEvent,
  hasPrimaryModifier,
  isContextClick,
  resolveHexKey,
  resolveTarget,
} from "@/ui/pane/hexKeys";

const key = (overrides: Partial<HexKeyEvent> & { key: string }): HexKeyEvent => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe("the primary modifier", () => {
  it("is Cmd on Apple platforms and Ctrl everywhere else", () => {
    expect(hasPrimaryModifier(key({ key: "a", metaKey: true }), "apple")).toBe(true);
    expect(hasPrimaryModifier(key({ key: "a", ctrlKey: true }), "apple")).toBe(false);
    expect(hasPrimaryModifier(key({ key: "a", ctrlKey: true }), "other")).toBe(true);
    expect(hasPrimaryModifier(key({ key: "a", metaKey: true }), "other")).toBe(false);
  });

  it("is detected from the platform string", () => {
    expect(detectKeyboardPlatform("MacIntel")).toBe("apple");
    expect(detectKeyboardPlatform("macOS")).toBe("apple");
    expect(detectKeyboardPlatform("iPhone")).toBe("apple");
    expect(detectKeyboardPlatform("Win32")).toBe("other");
    expect(detectKeyboardPlatform("Linux x86_64")).toBe("other");
    expect(detectKeyboardPlatform("")).toBe("other");
  });
});

// The press that opens the context menu must not put the caret down: the
// browser sends it before the menu, and a caret placed there took the
// selection away from the menu that was opened on it.
describe("the press that opens the context menu", () => {
  it("is the secondary button, on every platform", () => {
    expect(isContextClick({ button: 2, ctrlKey: false }, "apple")).toBe(true);
    expect(isContextClick({ button: 2, ctrlKey: false }, "other")).toBe(true);
  });

  it("is Control-click on a Mac, and only there", () => {
    expect(isContextClick({ button: 0, ctrlKey: true }, "apple")).toBe(true);
    expect(isContextClick({ button: 0, ctrlKey: true }, "other")).toBe(false);
  });

  it("is not a plain click", () => {
    expect(isContextClick({ button: 0, ctrlKey: false }, "apple")).toBe(false);
    expect(isContextClick({ button: 0, ctrlKey: false }, "other")).toBe(false);
  });
});

describe("the bookmark keys", () => {
  it("mark with ⌘D and edit with ⇧⌘D", () => {
    expect(resolveHexKey(key({ key: "d", metaKey: true }), "apple")).toEqual({
      kind: "toggleBookmark",
    });
    expect(resolveHexKey(key({ key: "D", metaKey: true, shiftKey: true }), "apple")).toEqual({
      kind: "editBookmark",
    });
  });
});

describe("the arrow keys", () => {
  for (const platform of ["apple", "other"] as const) {
    it(`move by a byte and by a row on ${platform}`, () => {
      expect(resolveHexKey(key({ key: "ArrowLeft" }), platform)).toEqual({
        kind: "moveBy",
        delta: -1,
        extend: false,
      });
      expect(resolveHexKey(key({ key: "ArrowRight" }), platform)).toEqual({
        kind: "moveBy",
        delta: 1,
        extend: false,
      });
      expect(resolveHexKey(key({ key: "ArrowUp" }), platform)).toEqual({
        kind: "moveBy",
        delta: -16,
        extend: false,
      });
      expect(resolveHexKey(key({ key: "ArrowDown" }), platform)).toEqual({
        kind: "moveBy",
        delta: 16,
        extend: false,
      });
    });
  }

  // @upstream ByteRipperTests/KeyboardNavigationTests.swift#KeyboardNavigationTests.testCmdShiftRightExtendsSelection
  it("extends the selection with Shift", () => {
    expect(resolveHexKey(key({ key: "ArrowRight", shiftKey: true }), "other")).toEqual({
      kind: "moveBy",
      delta: 1,
      extend: true,
    });
  });
});

describe("Home, End, Page Up and Page Down", () => {
  // The deliberate divergence: a Mac scrolls with these and leaves the caret
  // alone, because that is what every Mac application does; everywhere else
  // they move the caret, because that is what every application there does.
  it("scroll on a Mac", () => {
    expect(resolveHexKey(key({ key: "Home" }), "apple")).toEqual({ kind: "scrollTo", edge: "top" });
    expect(resolveHexKey(key({ key: "End" }), "apple")).toEqual({
      kind: "scrollTo",
      edge: "bottom",
    });
    expect(resolveHexKey(key({ key: "PageUp" }), "apple")).toEqual({
      kind: "scrollByPage",
      down: false,
    });
    expect(resolveHexKey(key({ key: "PageDown" }), "apple")).toEqual({
      kind: "scrollByPage",
      down: true,
    });
  });

  it("move the caret everywhere else", () => {
    expect(resolveHexKey(key({ key: "Home" }), "other")).toEqual({
      kind: "moveTo",
      target: "rowStart",
      extend: false,
    });
    expect(resolveHexKey(key({ key: "End" }), "other")).toEqual({
      kind: "moveTo",
      target: "rowEnd",
      extend: false,
    });
    expect(resolveHexKey(key({ key: "PageDown" }), "other")).toEqual({
      kind: "moveTo",
      target: "pageDown",
      extend: false,
    });
  });

  it("goes to the file's ends under the primary modifier on both", () => {
    expect(resolveHexKey(key({ key: "Home", ctrlKey: true }), "other")).toEqual({
      kind: "moveTo",
      target: "fileStart",
      extend: false,
    });
    expect(resolveHexKey(key({ key: "ArrowUp", metaKey: true }), "apple")).toEqual({
      kind: "moveTo",
      target: "fileStart",
      extend: false,
    });
  });
});

describe("the commands with names", () => {
  it("selects all and opens Go To under the primary modifier", () => {
    expect(resolveHexKey(key({ key: "a", metaKey: true }), "apple")).toEqual({ kind: "selectAll" });
    expect(resolveHexKey(key({ key: "A", ctrlKey: true }), "other")).toEqual({ kind: "selectAll" });
    expect(resolveHexKey(key({ key: "l", ctrlKey: true }), "other")).toEqual({
      kind: "goToPosition",
    });
  });

  it("lets the wrong modifier through to the browser", () => {
    // Ctrl+A on a Mac is not Select All, and claiming it would break the
    // emacs binding that moves to the start of a line.
    expect(resolveHexKey(key({ key: "a", ctrlKey: true }), "apple")).toBeUndefined();
    expect(resolveHexKey(key({ key: "a", metaKey: true }), "other")).toBeUndefined();
  });

  it("leaves Alt alone for difference navigation", () => {
    expect(resolveHexKey(key({ key: "ArrowDown", altKey: true }), "other")).toBeUndefined();
  });

  it("claims nothing it has no use for", () => {
    expect(resolveHexKey(key({ key: "F5" }), "other")).toBeUndefined();
    expect(resolveHexKey(key({ key: "t", ctrlKey: true }), "other")).toBeUndefined();
  });
});

describe("resolving a target", () => {
  it("finds the ends of the caret's row", () => {
    expect(resolveTarget("rowStart", 20, 1000, 30, false)).toBe(16);
    // A bare caret lands on the row's last byte; a selection's half-open end
    // sits one past it, so both reveal the same byte.
    expect(resolveTarget("rowEnd", 20, 1000, 30, false)).toBe(31);
    expect(resolveTarget("rowEnd", 20, 1000, 30, true)).toBe(32);
  });

  it("clamps the last row to the file's end", () => {
    expect(resolveTarget("rowEnd", 20, 24, 30, true)).toBe(24);
    expect(resolveTarget("rowEnd", 20, 24, 30, false)).toBe(23);
  });

  it("does not fall off an empty file", () => {
    expect(resolveTarget("rowEnd", 0, 0, 30, false)).toBe(0);
    expect(resolveTarget("rowEnd", 0, 0, 30, true)).toBe(0);
  });

  it("moves by pages and stops at the file's ends", () => {
    expect(resolveTarget("pageDown", 0, 10_000, 30, false)).toBe(480);
    expect(resolveTarget("pageUp", 480, 10_000, 30, false)).toBe(0);
    expect(resolveTarget("pageUp", 10, 10_000, 30, false)).toBe(0);
    expect(resolveTarget("pageDown", 9_990, 10_000, 30, false)).toBe(10_000);
  });

  it("knows the file's own ends", () => {
    expect(resolveTarget("fileStart", 500, 10_000, 30, false)).toBe(0);
    expect(resolveTarget("fileEnd", 500, 10_000, 30, false)).toBe(10_000);
  });
});

describe("keys that type", () => {
  it("takes hex digits in the hex column and refuses the rest", () => {
    expect(resolveHexKey(key({ key: "a" }), "other", "hex")).toEqual({
      kind: "hexDigit",
      digit: 10,
    });
    expect(resolveHexKey(key({ key: "F" }), "other", "hex")).toEqual({
      kind: "hexDigit",
      digit: 15,
    });
    expect(resolveHexKey(key({ key: "7" }), "other", "hex")).toEqual({
      kind: "hexDigit",
      digit: 7,
    });
    // `g` is not a hex digit, and `0x` tricks like "0b" must not slip through.
    expect(resolveHexKey(key({ key: "g" }), "other", "hex")).toBeUndefined();
    expect(resolveHexKey(key({ key: " " }), "other", "hex")).toBeUndefined();
  });

  it("offers any printable character to the text column's decoding table", () => {
    expect(resolveHexKey(key({ key: "A" }), "other", "text")).toEqual({
      kind: "character",
      character: "A",
    });
    expect(resolveHexKey(key({ key: "€" }), "other", "text")).toEqual({
      kind: "character",
      character: "€",
    });
    expect(resolveHexKey(key({ key: " " }), "other", "text")).toEqual({
      kind: "character",
      character: " ",
    });
  });

  it("never mistakes a named key for typing", () => {
    for (const named of ["F5", "Escape", "Enter", "ArrowUp", "Shift", "CapsLock"]) {
      expect(resolveHexKey(key({ key: named }), "other", "text"), named).not.toMatchObject({
        kind: "character",
      });
    }
  });
});

describe("the editing commands", () => {
  it("maps delete, backspace and the insert-mode toggle", () => {
    expect(resolveHexKey(key({ key: "Delete" }), "other")).toEqual({
      kind: "delete",
      forward: true,
    });
    expect(resolveHexKey(key({ key: "Backspace" }), "other")).toEqual({
      kind: "delete",
      forward: false,
    });
    expect(resolveHexKey(key({ key: "Insert" }), "other")).toEqual({ kind: "toggleInsertMode" });
    expect(resolveHexKey(key({ key: "Tab" }), "other")).toEqual({ kind: "switchColumn" });
  });

  it("maps undo and redo, in both spellings", () => {
    expect(resolveHexKey(key({ key: "z", metaKey: true }), "apple")).toEqual({
      kind: "undo",
      batch: false,
    });
    expect(resolveHexKey(key({ key: "Z", metaKey: true, shiftKey: true }), "apple")).toEqual({
      kind: "redo",
    });
    // What Chrome on a Mac actually sends for ⇧⌘Z: the letter stays lower case.
    expect(resolveHexKey(key({ key: "z", metaKey: true, shiftKey: true }), "apple")).toEqual({
      kind: "redo",
    });
    expect(resolveHexKey(key({ key: "z", ctrlKey: true, shiftKey: true }), "other")).toEqual({
      kind: "redo",
    });
    // Ctrl+Y is Redo on Windows and Linux, and nothing on a Mac.
    expect(resolveHexKey(key({ key: "y", ctrlKey: true }), "other")).toEqual({ kind: "redo" });
    expect(resolveHexKey(key({ key: "y", metaKey: true }), "apple")).toBeUndefined();
  });

  it("maps save, save as, copy and paste", () => {
    expect(resolveHexKey(key({ key: "s", ctrlKey: true }), "other")).toEqual({ kind: "save" });
    expect(resolveHexKey(key({ key: "S", ctrlKey: true, shiftKey: true }), "other")).toEqual({
      kind: "saveAs",
    });
    expect(resolveHexKey(key({ key: "c", metaKey: true }), "apple")).toEqual({ kind: "copy" });
    expect(resolveHexKey(key({ key: "v", metaKey: true }), "apple")).toEqual({ kind: "paste" });
  });

  it("does not treat a modified letter as typing", () => {
    // Cmd+G is not the hex digit G — and more to the point, Ctrl+S must save
    // rather than write 0x05 into the file.
    expect(resolveHexKey(key({ key: "s", ctrlKey: true }), "other")).toEqual({ kind: "save" });
    expect(resolveHexKey(key({ key: "b", ctrlKey: true }), "other", "hex")).toBeUndefined();
  });
});
