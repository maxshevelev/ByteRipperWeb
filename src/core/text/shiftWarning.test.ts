/**
 * The three warnings before an edit that shifts every offset after it (§7.2).
 *
 * Upstream shows three separate alerts and these are their words, so the
 * substance is the copy: the offset and the count in the form upstream writes
 * them, and a sentence per command rather than one sentence for all three.
 */

import { describe, expect, it } from "vitest";
import { shiftWarning } from "@/core/text/shiftWarning";

describe("the warning before a shifting edit", () => {
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.flipInsertMode
  it("names the offset a keystroke inserts at", () => {
    expect(shiftWarning({ kind: "insert", at: 0x2e6, count: 1 })).toEqual({
      title: "Insert?",
      message:
        "Inserting at offset 0x2E6 shifts every byte from here on — the file structure may be affected.",
      confirmLabel: "Insert",
    });
  });

  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.pasteInsert
  it("counts the bytes a paste puts in", () => {
    expect(shiftWarning({ kind: "paste", at: 0, count: 16 })).toEqual({
      title: "Paste Insert?",
      message: "Insert 16 byte(s) at offset 0x0. Existing bytes from this offset on will shift.",
      confirmLabel: "Insert",
    });
  });

  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deleteSelectionOrCaret
  it("counts the bytes a delete takes out", () => {
    expect(shiftWarning({ kind: "delete", at: 0x8, count: 4 })).toEqual({
      title: "Delete 4 byte(s)?",
      message:
        "Bytes from offset 0x8 will be removed. Subsequent offsets will shift — the file structure may be affected.",
      confirmLabel: "Delete",
    });
  });

  it("writes the offset as the alerts do", () => {
    // Upper-case, `0x`-prefixed, and not padded: the dump pads an address to
    // eight digits because its column is read as one, and a sentence is not.
    const at = (offset: number) => shiftWarning({ kind: "insert", at: offset, count: 1 }).message;
    expect(at(0)).toContain("offset 0x0 ");
    expect(at(0xab)).toContain("offset 0xAB ");
    expect(at(0xdeadbeef)).toContain("offset 0xDEADBEEF ");
  });
});
