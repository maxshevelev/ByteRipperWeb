/**
 * The doors into the book, and the one thing worth pinning about them: the
 * toolbar's `?` and the command menu's Help block are the same list.
 *
 * Asserted against the builder rather than against titles spelled here, for
 * upstream's reason — a test that repeated the titles would go on passing after
 * the two drifted apart. Here they cannot drift, because there is one call and
 * both places make it; what this checks is that the call answers with the six
 * doors, each of which does something.
 */

import { describe, expect, it } from "vitest";
import { helpMenuEntries } from "@/ui/shell/helpMenu";
import { isMenuAction } from "@/ui/shell/menuModel";

describe("the help menu", () => {
  // @upstream ByteRipperTests/ToolbarItemsTests.swift#ToolbarItemsTests.testTheHelpPullDownCarriesTheHelpMenu
  it("offers the same six doors wherever it is opened from", () => {
    const first = helpMenuEntries();
    const again = helpMenuEntries();
    expect(first.map((entry) => (isMenuAction(entry) ? entry.label : entry.kind))).toEqual(
      again.map((entry) => (isMenuAction(entry) ? entry.label : entry.kind))
    );
    expect(first).toHaveLength(6);
  });

  /** A door that opens nothing is a door nobody should be offered. */
  it("gives every door something to do", () => {
    for (const entry of helpMenuEntries()) {
      expect(isMenuAction(entry), "every row is a command, not a heading").toBe(true);
      if (isMenuAction(entry)) {
        expect(entry.label.length).toBeGreaterThan(0);
        expect(typeof entry.onSelect).toBe("function");
        expect(entry.disabled ?? false, "the book is there whatever is open").toBe(false);
      }
    }
  });

  /** The book itself is the first door: it is what "Help" means with no question. */
  it("starts with the book", () => {
    const first = helpMenuEntries()[0];
    expect(first !== undefined && isMenuAction(first) && first.label).toBe("ByteRipper Help");
  });
});
