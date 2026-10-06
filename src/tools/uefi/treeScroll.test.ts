import { describe, expect, it } from "vitest";
import { scrollToShowStretch } from "@/tools/uefi/treeScroll";

const view = { headerHeight: 22, rowHeight: 22, clientHeight: 22 + 10 * 22 };

describe("scrolling to a row and what it holds", () => {
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.scrollToShowChildren */
  it("leaves the tree where it is when the stretch is on screen", () => {
    expect(scrollToShowStretch({ ...view, scrollTop: 0, row: 2, last: 6 })).toBe(0);
  });

  it("brings the children up from below, as many as fit", () => {
    // Rows 8..14 lie from 176 to 330 and the view holds ten rows from 0.
    expect(scrollToShowStretch({ ...view, scrollTop: 0, row: 8, last: 14 })).toBe(15 * 22 - 220);
  });

  it("puts the row at the top when the stretch is taller than the view", () => {
    expect(scrollToShowStretch({ ...view, scrollTop: 0, row: 4, last: 40 })).toBe(4 * 22);
  });

  it("brings a row that lies above the view back", () => {
    expect(scrollToShowStretch({ ...view, scrollTop: 400, row: 3, last: 3 })).toBe(3 * 22);
  });
});
