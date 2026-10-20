import { describe, expect, it } from "vitest";
import { HexLayout } from "@/render/hexGrid/hexLayout";
import { NOTE_CONTOUR_REACH, noteContourAt } from "@/render/hexGrid/noteContour";

/**
 * Where a note's outline answers the pointer: on the line only, as far out on either edge.
 *
 * @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests
 */
describe("a note's outline under the pointer", () => {
  const layout = new HexLayout({ charWidth: 8, rowHeight: 17 });
  const padding = 2;
  // One note on 0x40..<0x60 — rows 4 and 5.
  const note = { start: 0x40, end: 0x60 };
  const byteX = (column: number) => layout.hexByteX(column) + layout.charWidth;
  const at = (x: number, y: number) => noteContourAt({ x, y }, [note], layout, padding);

  // A note speaks on its outline, and says nothing over the bytes inside it, which it would
  // otherwise keep covering — nor outside it.
  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testANoteSpeaksOnItsOutlineOnly
  it("answers on its outline only", () => {
    const top = 4 * layout.rowHeight;
    expect(at(byteX(3), top)).toBe(note);
    expect(at(byteX(10), top + NOTE_CONTOUR_REACH - 0.5)).toBe(note);
    expect(at(byteX(7), 5 * layout.rowHeight), "inside, over its bytes").toBeUndefined();
    expect(at(byteX(7), 8.5 * layout.rowHeight), "and outside it").toBeUndefined();
  });

  // The outline answers the same distance either side of it on both of its vertical edges.
  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testBothEdgesOfANoteAnswerAsFarOut
  it("answers as far out on both edges", () => {
    const y = 5 * layout.rowHeight;
    const reach = (around: number) => {
      const hits: number[] = [];
      for (let x = around - 5.5; x <= around + 5.5; x += 0.5)
        if (at(x, y) !== undefined) hits.push(x);
      return hits;
    };
    const left = reach(layout.hexByteX(0) - padding);
    const right = reach(layout.hexByteX(15) + layout.hexByteWidth + padding);
    expect(left.length).toBeGreaterThan(0);
    expect(left.length, "the two edges reach as far").toBe(right.length);
  });

  it("gives the innermost where two outlines meet", () => {
    const inner = { start: 0x40, end: 0x50 };
    expect(
      noteContourAt({ x: byteX(3), y: 4 * layout.rowHeight }, [note, inner], layout, padding)
    ).toBe(inner);
  });
});
