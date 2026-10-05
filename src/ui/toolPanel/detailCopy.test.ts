import { describe, expect, it } from "vitest";
import { type CopyNode, detailCopyText } from "@/ui/toolPanel/detailCopy";

/**
 * Ported from `UEFIToolFlowTests` and `ToolFieldListTests`: what copying a selection of the
 * details puts on the clipboard. The selection itself is the browser's; the text made of
 * it is tested on a fragment built by hand.
 */

const text = (value: string): CopyNode => ({
  nodeType: 3,
  nodeName: "#text",
  textContent: value,
  childNodes: [],
});
const element = (nodeName: string, className: string | undefined, ...children: CopyNode[]) => ({
  nodeType: 1,
  nodeName: nodeName.toUpperCase(),
  className,
  textContent: children.map((one) => one.textContent ?? "").join(""),
  childNodes: children,
});
const fragment = (...children: CopyNode[]): CopyNode => ({
  nodeType: 11,
  nodeName: "#document-fragment",
  textContent: null,
  childNodes: children,
});

const field = (name: string, value: CopyNode[]) =>
  element(
    "div",
    "tool-detail-row",
    element("dt", undefined, text(name)),
    element("dd", undefined, ...value)
  );
const row = (...cells: string[]) =>
  element(
    "tr",
    undefined,
    ...cells.map((cell) => element("td", "tool-detail-grid-cell", text(cell)))
  );

describe("what copying the details copies", () => {
  // A drag from the first row into the value of the last selects both, the name and
  // value of a row a tab apart and each row on its line.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testADragSelectsAcrossRows
  it("copies a field as its name, a tab and its value, a line to a field", () => {
    const copied = detailCopyText(
      fragment(
        element("dl", undefined, field("Kind", [text("Volume")]), field("Size", [text("0x1000")]))
      )
    );
    expect(copied).toBe("Kind\tVolume\nSize\t0x1000");
  });

  // The tick a passed check carries is drawn, not copied: it is the one character a
  // reader did not read.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testThePassedChecksTickIsNotCopied
  it("does not copy the tick of a passed check", () => {
    const tick = element("svg", "tool-detail-done");
    expect(detailCopyText(fragment(field("Checksum", [tick, text("0x5A (Valid)")])))).toBe(
      "Checksum\t0x5A (Valid)"
    );
  });

  // A table's text is selected as a text view's is: ⌘C copies it with a tab between cells
  // and a line per row.
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testTheTextOfADetailTableIsSelected
  it("copies a table with a tab between cells and a line per row", () => {
    const copied = detailCopyText(
      fragment(
        element(
          "table",
          undefined,
          element(
            "tbody",
            undefined,
            row("JEDEC ID", "Chip", "Size"),
            row("1F4700", "AT25DF", "1 MB")
          )
        )
      )
    );
    expect(copied).toBe("JEDEC ID\tChip\tSize\n1F4700\tAT25DF\t1 MB");
  });

  // A drag that begins inside a row has the cells without the row around them; a word
  // is just the word.
  it("copies the cells of a row cut across, and a word as it stands", () => {
    expect(detailCopyText(fragment(element("td", "tool-detail-grid-cell", text("AT25DF"))))).toBe(
      "AT25DF"
    );
    expect(detailCopyText(fragment(text("AT25DF")))).toBe("AT25DF");
    expect(detailCopyText(fragment())).toBe("");
  });

  // A link is its cell's text, the button around it left out.
  it("copies a link as its text", () => {
    const link = element("button", "tool-detail-link", text("0x121"));
    expect(
      detailCopyText(
        fragment(
          element(
            "tr",
            undefined,
            element("td", undefined, text("2")),
            element("td", undefined, link)
          )
        )
      )
    ).toBe("2\t0x121");
  });
});
