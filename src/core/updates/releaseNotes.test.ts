import { describe, expect, it } from "vitest";
import { firstParagraph } from "@/core/updates/releaseNotes";

describe("the first paragraph of a release's notes", () => {
  it("returns a plain paragraph, trimmed", () => {
    expect(firstParagraph("  This build adds the Open Recent menu.  ")).toBe(
      "This build adds the Open Recent menu."
    );
  });

  it("joins a paragraph that runs over several lines", () => {
    expect(firstParagraph("First line\nsecond line\nthird line")).toBe(
      "First line second line third line"
    );
  });

  it("stops at the first blank line and leaves the rest", () => {
    expect(firstParagraph("The summary.\n\n### A section\n\n- a change\n- another change")).toBe(
      "The summary."
    );
  });

  it("skips a leading blank line to the first block that has words", () => {
    expect(firstParagraph("\n\nThe summary here.")).toBe("The summary here.");
  });

  it("reads a CRLF body", () => {
    expect(firstParagraph("Summary.\r\n\r\n### Later")).toBe("Summary.");
  });

  it("drops the markers of a heading the block starts with", () => {
    expect(firstParagraph("## The summary words")).toBe("The summary words");
  });

  it("drops a list item's marker", () => {
    expect(firstParagraph("- fix the reader\n- add the writer")).toBe(
      "fix the reader add the writer"
    );
  });

  it("keeps a link's words and not its address", () => {
    expect(firstParagraph("See the [release page](https://github.com) for more.")).toBe(
      "See the release page for more."
    );
  });

  it("keeps an image's label and not its address", () => {
    expect(firstParagraph("Shown here: ![the diagram](/img/diagram.png).")).toBe(
      "Shown here: the diagram."
    );
  });

  it("keeps inline code's text without the backticks", () => {
    expect(firstParagraph("It reads the `SHA256SUMS` file.")).toBe("It reads the SHA256SUMS file.");
  });

  it("keeps bold's words without the markers", () => {
    expect(firstParagraph("Adds **Save in place** and **Open Recent**.")).toBe(
      "Adds Save in place and Open Recent."
    );
  });

  it("says nothing when the body is empty or only blank lines", () => {
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph("\n\n  \n\n")).toBe("");
  });
});
