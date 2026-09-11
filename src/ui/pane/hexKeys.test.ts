import { describe, expect, it } from "vitest";
import {
  detectKeyboardPlatform,
  type HexKeyEvent,
  hasPrimaryModifier,
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
