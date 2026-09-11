import { describe, expect, it } from "vitest";
import { BYTES_PER_ROW, HexLayout, wordSizeTitle } from "@/render/hexGrid/hexLayout";

/**
 * Ported from `HexLayoutTests.swift`.
 *
 * Geometry only, with charWidth 8 and rowHeight 17 — the same numbers upstream
 * asserts against, so the expected values below are upstream's own.
 */

const layout = (overrides: { wordSize?: number; offsetColumnChars?: number } = {}) =>
  new HexLayout({ charWidth: 8, rowHeight: 17, ...overrides });

describe("derived metrics", () => {
  it("are what the character width implies", () => {
    const l = layout();
    expect(l.hexByteWidth).toBe(16); // 2 chars
    expect(l.hexByteGap).toBe(8); // 1 char
    expect(l.groupWidth).toBe(184); // 8×16 + 7×8
    expect(l.betweenGroupsGap).toBe(16); // 2 chars
    expect(l.offsetColumnWidth).toBe(64); // 8 chars
    expect(l.textColumnWidth).toBe(128); // 16 chars
    expect(l.gapAfterOffset).toBe(16);
    expect(l.gapBeforeText).toBe(16);
    expect(l.contentWidth).toBe(632);
  });

  it("never shrinks the offset column below eight digits", () => {
    expect(layout({ offsetColumnChars: 2 }).offsetColumnChars).toBe(8);
  });
});

describe("word size", () => {
  it("packs a word's bytes and spaces the words", () => {
    // Word of 2: 4 words per group, 3 word gaps.
    const w2 = layout({ wordSize: 2 });
    expect(w2.wordSize).toBe(2);
    expect(w2.wordsPerGroup).toBe(4);
    expect(w2.wordWidth).toBe(32);
    expect(w2.groupWidth).toBe(152); // 8×16 + 3×8
    expect(w2.contentWidth).toBe(568);

    const w4 = layout({ wordSize: 4 });
    expect(w4.wordsPerGroup).toBe(2);
    expect(w4.wordWidth).toBe(64);
    expect(w4.groupWidth).toBe(136); // 8×16 + 1×8
    expect(w4.contentWidth).toBe(536);

    // Word of 8: one word fills a whole group — no word gap at all.
    const w8 = layout({ wordSize: 8 });
    expect(w8.wordsPerGroup).toBe(1);
    expect(w8.wordWidth).toBe(128);
    expect(w8.groupWidth).toBe(128);
    expect(w8.contentWidth).toBe(520);
  });

  it("falls back to one byte for anything else", () => {
    expect(layout({ wordSize: 3 }).wordSize).toBe(1);
    expect(layout({ wordSize: 16 }).wordSize).toBe(1);
    expect(layout({ wordSize: 0 }).wordSize).toBe(1);
  });

  it("groups bytes within a word", () => {
    const w4 = layout({ wordSize: 4 });
    // Bytes of one word are packed: no gap between them.
    expect(w4.hexByteX(1)).toBe(w4.hexByteX(0) + w4.hexByteWidth);
    expect(w4.hexByteX(3)).toBe(w4.hexByteX(0) + 3 * w4.hexByteWidth);
    // A word starts after its predecessor plus the word gap.
    expect(w4.hexByteX(4)).toBe(w4.hexByteX(3) + w4.hexByteWidth + w4.hexByteGap);
    expect(w4.hexByteX(7)).toBe(w4.hexByteX(4) + 3 * w4.hexByteWidth);
    // The two groups are still separated by the wider gap.
    expect(w4.hexByteX(8)).toBe(w4.hexByteX(0) + w4.groupWidth + w4.betweenGroupsGap);
  });

  it("leaves rows and offsets alone — the grouping is display only", () => {
    const w4 = layout({ wordSize: 4 });
    expect(w4.rowCount(16)).toBe(2);
    expect(w4.byteOffset(1, 0)).toBe(16);
    expect(w4.rowColumn(19)).toEqual({ row: 1, column: 3 });
  });

  it("names itself for the menu", () => {
    expect(wordSizeTitle(1)).toBe("1 Byte");
    expect(wordSizeTitle(8)).toBe("8 Bytes");
  });
});

describe("rows", () => {
  it("always leaves somewhere for the caret at EOF", () => {
    const l = layout();
    expect(l.rowCount(0)).toBe(1); // empty → one placeholder row
    expect(l.rowCount(1)).toBe(1);
    expect(l.rowCount(15)).toBe(1);
    expect(l.rowCount(16)).toBe(2); // an extra row so the caret at EOF is on the grid
    expect(l.rowCount(17)).toBe(2);
    expect(l.rowCount(32)).toBe(3);

    expect(l.totalHeight(0)).toBe(17);
    expect(l.totalHeight(16)).toBe(34);
  });

  it("round-trips an offset through row and column", () => {
    const l = layout();
    expect(l.byteOffset(1, 3)).toBe(19);
    expect(l.rowColumn(19)).toEqual({ row: 1, column: 3 });
    expect(l.byteOffset(5, 15)).toBe(95);
    expect(l.byteOffset(0, 0)).toBe(0);
  });
});

describe("column geometry", () => {
  it("places the hex cells", () => {
    const l = layout();
    expect(l.hexByteX(0)).toBe(92); // leftPadding + offset column + gap
    expect(l.hexByteX(7)).toBe(260);
    expect(l.hexByteX(8)).toBe(292); // the second group, after the wider gap
    expect(l.hexByteX(15)).toBe(460);
    expect(l.hexByteX(0) + l.hexByteWidth + l.hexByteGap).toBe(l.hexByteX(1));
  });

  it("places the text column, ending exactly at the right padding", () => {
    const l = layout();
    expect(l.textX(0)).toBe(492);
    expect(l.textX(15)).toBe(612);
    expect(l.textX(15) + l.charWidth).toBe(l.contentWidth - l.rightPadding);
  });

  it("places the caret at either nibble", () => {
    // Absolute, because expressing the caret's x through hexByteFrame would
    // restate the implementation's own body.
    const l = layout();
    expect(l.caretX(2, 0)).toBe(140);
    expect(l.caretX(2, 1)).toBe(148);
  });

  it("spans the dead zone from one nibble's middle to the other's", () => {
    const l = layout();
    expect(l.highNibbleMidX(2)).toBe(144);
    expect(l.lowNibbleMidX(2)).toBe(152);
  });
});

describe("virtualisation", () => {
  it("names the rows a viewport touches", () => {
    const l = layout();
    expect(l.visibleRowRange(0, 17)).toEqual({ first: 0, end: 1 });
    expect(l.visibleRowRange(16, 34)).toEqual({ first: 0, end: 3 }); // spanning three partials
    expect(l.visibleRowRange(17, 17)).toEqual({ first: 1, end: 2 }); // aligned
    expect(l.visibleRowRange(0, 0)).toEqual({ first: 0, end: 0 });
  });

  it("frames a row", () => {
    expect(layout().rowFrame(2)).toEqual({ x: 0, y: 34, width: 632, height: 17 });
  });
});

describe("hit testing", () => {
  it("finds the hex cells", () => {
    const l = layout();
    expect(l.hitTest(92, 0, 10)).toEqual({ row: 0, column: { kind: "hex", column: 0 } });
    expect(l.hitTest(300, 17, 10)).toEqual({ row: 1, column: { kind: "hex", column: 8 } });
    expect(l.hitTest(468, 0, 10)).toEqual({ row: 0, column: { kind: "hex", column: 15 } });
  });

  it("finds the text and offset columns", () => {
    const l = layout();
    expect(l.hitTest(492 + 5 * 8, 0, 10)).toEqual({ row: 0, column: { kind: "text", column: 5 } });
    expect(l.hitTest(20, 0, 10)).toEqual({ row: 0, column: { kind: "offset" } });
  });

  it("misses outside the content", () => {
    const l = layout();
    expect(l.hitTest(700, 0, 10)).toBeUndefined(); // the right padding
    expect(l.hitTest(200, 170, 1)).toBeUndefined(); // past the last row
    expect(l.hitTest(-1, 0, 10)).toBeUndefined();
  });

  it("never lets a click fall dead in a gap", () => {
    const l = layout();
    // Between two words → the following word.
    expect(l.hitTest(l.hexByteX(0) + l.hexByteWidth + l.hexByteGap / 2, 0, 10)).toEqual({
      row: 0,
      column: { kind: "hex", column: 1 },
    });
    // Between the two groups → the next group's first byte.
    expect(l.hitTest(l.hexByteX(7) + l.hexByteWidth + l.betweenGroupsGap / 2, 0, 10)).toEqual({
      row: 0,
      column: { kind: "hex", column: 8 },
    });
    // Past the last hex byte → the row's last byte.
    expect(l.hitTest(l.hexByteX(15) + l.hexByteWidth + l.hexByteGap / 2, 0, 10)).toEqual({
      row: 0,
      column: { kind: "hex", column: 15 },
    });
  });

  it("tracks packed words", () => {
    const w4 = layout({ wordSize: 4 });
    expect(w4.hitTest(w4.hexByteX(3), 0, 10)).toEqual({
      row: 0,
      column: { kind: "hex", column: 3 },
    });
    const gap = w4.hexByteX(3) + w4.hexByteWidth + w4.hexByteGap / 2;
    expect(w4.hitTest(gap, 0, 10)).toEqual({ row: 0, column: { kind: "hex", column: 4 } });

    const w8 = layout({ wordSize: 8 });
    expect(w8.hitTest(w8.hexByteX(15), 0, 10)).toEqual({
      row: 0,
      column: { kind: "hex", column: 15 },
    });
  });
});

describe("drag selection", () => {
  // A byte joins the selection when the pointer passes its cell centre, not
  // when it enters the next byte's cell.
  it("tracks byte centres", () => {
    const l = layout();
    // Before byte 0's centre (92 + 8 = 100) the end is the row start.
    expect(l.dragEndOffset(92, 0, 10)).toBe(0);
    expect(l.dragEndOffset(99, 0, 10)).toBe(0);
    expect(l.dragEndOffset(100, 0, 10)).toBe(1);
    expect(l.dragEndOffset(110, 0, 10)).toBe(1);
    // Byte 4's centre is at 196.
    expect(l.dragEndOffset(195, 0, 10)).toBe(4);
    expect(l.dragEndOffset(196, 0, 10)).toBe(5);
    // The rule holds across the between-groups gap: mid(8) = 300.
    expect(l.dragEndOffset(300, 0, 10)).toBe(9);
  });

  it("selects the row's last byte while the pointer is still over it", () => {
    const l = layout();
    expect(l.dragEndOffset(460, 0, 10)).toBe(15);
    expect(l.dragEndOffset(467, 0, 10)).toBe(15);
    expect(l.dragEndOffset(468, 0, 10)).toBe(16);
    // The same boundaries on row 1, which starts at byte 16.
    expect(l.dragEndOffset(100, 17, 10)).toBe(17);
    expect(l.dragEndOffset(468, 17, 10)).toBe(32);
    expect(l.dragEndOffset(491, 0, 10)).toBe(16);
  });

  it("applies the same rule in the text column", () => {
    const l = layout();
    expect(l.dragEndOffset(492, 0, 10)).toBe(0);
    expect(l.dragEndOffset(495, 0, 10)).toBe(0);
    expect(l.dragEndOffset(496, 0, 10)).toBe(1);
    expect(l.dragEndOffset(615, 0, 10)).toBe(15);
    expect(l.dragEndOffset(616, 0, 10)).toBe(16);
    expect(l.dragEndOffset(619, 0, 10)).toBe(16);
  });

  it("takes the offset column as the row's start, and misses where hit testing does", () => {
    const l = layout();
    expect(l.dragEndOffset(20, 0, 10)).toBe(0);
    expect(l.dragEndOffset(20, 17, 10)).toBe(16);
    expect(l.dragEndOffset(700, 0, 10)).toBeUndefined();
    expect(l.dragEndOffset(200, 170, 1)).toBeUndefined();
    expect(l.dragEndOffset(-1, 0, 10)).toBeUndefined();
  });

  it("uses the bytes' own centres inside a packed word, not the word's edge", () => {
    const w4 = layout({ wordSize: 4 });
    expect(w4.dragEndOffset(147, 0, 10)).toBe(3);
    expect(w4.dragEndOffset(148, 0, 10)).toBe(4);
    expect(w4.dragEndOffset(172, 0, 10)).toBe(5);
    expect(w4.dragEndOffset(w4.hexByteX(15) + 8, 0, 10)).toBe(BYTES_PER_ROW);
  });
});

it("scrolls both panes of a comparison over the longer file", () => {
  // The scroll extent is the comparison's, not each pane's own: the two scroll
  // by absolute offset, so a shorter pane that stopped at its own last row
  // would leave the pair showing different offsets — which is the one thing the
  // arrangement exists to prevent. The rows past a pane's own EOF are empty.
  const layout = new HexLayout({ charWidth: 8, rowHeight: 17 });
  const shorter = 1024 * 1024;
  const longer = 4 * 1024 * 1024;

  expect(layout.totalHeight(Math.max(shorter, longer))).toBe(layout.totalHeight(longer));
  expect(layout.totalHeight(Math.max(longer, shorter))).toBe(layout.totalHeight(longer));
  // And a pane with no companion is sized to itself.
  expect(layout.totalHeight(Math.max(shorter, 0))).toBe(layout.totalHeight(shorter));
});
