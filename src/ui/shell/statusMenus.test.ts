/**
 * The status bar's two right-click menus (§3.4): the file size in the form it
 * was opened on, and the caret's address as the bar draws it.
 *
 * Upstream asserts these off `NSMenuItem`s and reads the pasteboard back. Both
 * halves are here — the title the user reads and the string that reaches the
 * clipboard — because the two are one thing: the item is titled with what it
 * will copy, so a title and a payload that drifted apart is the bug this is
 * looking for.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";
import { statusOffsetMenu, statusSizeMenu } from "@/ui/shell/paneMenus";

/** Everything the page tried to put on the clipboard, in order. */
const copied: string[] = [];

// A browser's clipboard, one function deep. The write is reached synchronously —
// the item's command is what calls it — so the assertions below need no waiting.
vi.stubGlobal("navigator", {
  clipboard: {
    writeText: (text: string) => {
      copied.push(text);
      return Promise.resolve();
    },
  },
});

afterEach(() => {
  copied.length = 0;
});

const item = (entries: readonly MenuEntry[]): MenuEntry => {
  const first = entries[0];
  if (first === undefined) throw new Error("the menu carries no item");
  return first;
};

const title = (entry: MenuEntry): string => {
  if (!isMenuAction(entry)) throw new Error("this menu is one command, not a section");
  return entry.label;
};

const choose = (entry: MenuEntry): void => {
  if (!isMenuAction(entry)) throw new Error("this menu is one command, not a section");
  entry.onSelect();
};

// @upstream ByteRipperTests/StatusBarSizeTests.swift#StatusBarSizeTests.testTheMenuCopiesTheSizeInTheFormItWasOpenedOn
describe("the size's menu", () => {
  it("copies the size in the form it was opened on", () => {
    const size = 2 * 1024 * 1024;

    const hex = item(statusSizeMenu(size, "hex"));
    expect(title(hex)).toBe("Copy hex size 200000");
    choose(hex);

    const decimal = item(statusSizeMenu(size, "decimal"));
    expect(title(decimal)).toBe("Copy size 2097152");
    choose(decimal);

    // The hex one bare, with no `0x` for a field of the app's own to double.
    expect(copied).toEqual(["200000", "2097152"]);
  });
});

// @upstream ByteRipperTests/StatusBarOffsetTests.swift#StatusBarOffsetTests.testTheMenuCopiesTheAddressAsTheBarDrawsIt
describe("the offset's menu", () => {
  it("copies the address as the bar draws it", () => {
    const digits = "0002E6";
    const only = statusOffsetMenu(digits);
    // Copying is all this menu does — the dump's own menu is where blocks live
    // (§10.2) — so one item, and nothing else.
    expect(only).toHaveLength(1);

    const copy = item(only);
    expect(title(copy)).toBe("Copy offset 0002E6");
    choose(copy);

    // Exactly the digits the bar drew: no "0x", no padding the bar did not show,
    // nothing else.
    expect(copied).toEqual(["0002E6"]);
  });
});
