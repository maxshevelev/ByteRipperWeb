import { describe, expect, it } from "vitest";
import { continuesDrag, startsDrag } from "@/ui/shell/pointerDrag";

/**
 * The two decisions behind every handle in the app. They are checked here
 * rather than in a browser because the bug they exist for is one a browser
 * reproduces only now and then: a drag whose release never arrived, and a
 * layout that then follows the pointer across the handle with no button held.
 */

describe("startsDrag", () => {
  it("takes the primary button and nothing else", () => {
    expect(startsDrag({ button: 0, isPrimary: true })).toBe(true);
    expect(startsDrag({ button: 1, isPrimary: true })).toBe(false);
    expect(startsDrag({ button: 2, isPrimary: true })).toBe(false);
  });

  it("is not a second finger", () => {
    expect(startsDrag({ button: 0, isPrimary: false })).toBe(false);
  });
});

describe("continuesDrag", () => {
  it("is a move with the button still held", () => {
    expect(continuesDrag({ buttons: 1 })).toBe(true);
    // A second button pressed mid-drag does not end it.
    expect(continuesDrag({ buttons: 3 })).toBe(true);
  });

  it("is not a hover", () => {
    // The case the whole module is for: the pointer crossing a handle with
    // nothing held must not drive the layout, whatever the drag remembers.
    expect(continuesDrag({ buttons: 0 })).toBe(false);
  });

  it("is not some other button on its own", () => {
    expect(continuesDrag({ buttons: 2 })).toBe(false);
    expect(continuesDrag({ buttons: 4 })).toBe(false);
  });
});
