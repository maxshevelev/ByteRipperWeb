import { describe, expect, it } from "vitest";
import { firstParagraph, releaseSummary } from "@/core/updates/releaseNotes";

const release = (body?: string) => ({
  version: { text: "0.8.5-2", parts: [0, 8, 5, 2] },
  page: "https://github.com/maxshevelev/ByteRipperWeb/releases/tag/v0.8.5-2",
  assets: [],
  body,
});

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

  it("joins the opening's wrapped lines and stops at the blank line", () => {
    const body =
      "A release about the structure tree reading what was padding before: the\n" +
      "variable stores of every vendor the bench meets. And the ME Analyzer\n" +
      "shows its summary the moment the region is read.\n\n" +
      "### Smaller things\n\n" +
      "- One more thing.";
    expect(firstParagraph(body)).toBe(
      "A release about the structure tree reading what was padding before: the " +
        "variable stores of every vendor the bench meets. And the ME Analyzer " +
        "shows its summary the moment the region is read."
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

  it("keeps a link's words and not its address", () => {
    expect(firstParagraph("See the [release page](https://github.com) for more.")).toBe(
      "See the release page for more."
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

  it("reduces the marks the prose carries to the prose", () => {
    const body =
      "Reads the **variable stores** and the `FSEG` header, as [the book](https://github.com/maxshevelev/ByteRipper) says.";
    expect(firstParagraph(body)).toBe(
      "Reads the variable stores and the FSEG header, as the book says."
    );
  });

  it("says nothing when the body is empty or only blank lines", () => {
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph("\n\n  \n\n")).toBe("");
  });
});

describe("the release's summary", () => {
  it("is the first paragraph of the notes it carries", () => {
    expect(
      releaseSummary(
        release("A release about the structure tree.\n\n### Smaller things\n\n- One more thing.")
      )
    ).toBe("A release about the structure tree.");
  });

  it("is nothing when the release has no notes, or none to read", () => {
    expect(releaseSummary(release(undefined))).toBe("");
    expect(releaseSummary(release("\n\n  \n\n"))).toBe("");
  });
});
