import { describe, expect, it } from "vitest";
import { HexLayout } from "@/render/hexGrid/hexLayout";

/**
 * Where a filled run of hex cells has its vertical edges: in the middle of the
 * space between two characters, never against a glyph.
 */

// charWidth 8, leftPadding 12, eight offset digits: the first byte is at 92.
const layout = (wordSize = 1) => new HexLayout({ charWidth: 8, rowHeight: 16, wordSize });

describe("the edges of a filled hex run", () => {
  it("starts half a character before the row's first byte", () => {
    expect(layout().hexRunStart(0)).toBe(88);
  });

  it("meets the previous byte in the middle of the gap between them", () => {
    // Byte 0 ends at 108, byte 1 starts at 116.
    expect(layout().hexRunStart(1)).toBe(112);
    expect(layout().hexRunEnd(0)).toBe(112);
  });

  it("splits the wider gap between the two groups down its middle", () => {
    // Byte 7 ends at 276, byte 8 starts at 292.
    expect(layout().hexRunEnd(7)).toBe(284);
    expect(layout().hexRunStart(8)).toBe(284);
  });

  it("ends half a character past the row's last byte", () => {
    const l = layout();
    expect(l.hexRunEnd(15)).toBe(l.hexByteX(15) + l.hexByteWidth + 4);
  });

  // Inside a word the cells touch, so the middle of nothing is their shared edge.
  it("uses the shared edge between two bytes of one word", () => {
    const l = layout(2);
    expect(l.hexRunEnd(0)).toBe(l.hexByteX(1));
    expect(l.hexRunStart(1)).toBe(l.hexByteX(1));
  });
});
