/**
 * Ported from `HelpMarkupTests.swift`: the markup the content is written in —
 * the one format a translator has to keep, so each of its rules is pinned here
 * — and the file formats around it.
 */

import { describe, expect, it } from "vitest";
import { TOPIC, termId, topicId } from "@/core/help/helpIds";
import { parseHelpSections, parseHelpTermFile, parseHelpTopicFile } from "@/core/help/helpLoader";
import {
  type HelpBlock,
  type HelpSpan,
  helpPlainText,
  helpSpans,
  parseHelpMarkup,
} from "@/core/help/helpMarkup";

const text = (value: string): HelpSpan => ({ kind: "text", text: value });
const strong = (value: string): HelpSpan => ({ kind: "strong", text: value });
const code = (value: string): HelpSpan => ({ kind: "code", text: value });
const paragraph = (...spans: HelpSpan[]): HelpBlock => ({ kind: "paragraph", spans });

describe("the markup a translator has to keep", () => {
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testParagraphsAreJoinedUntilABlankLine
  it("joins prose until a blank line", () => {
    expect(parseHelpMarkup("one\ntwo\n\nthree")).toEqual([
      paragraph(text("one two")),
      paragraph(text("three")),
    ]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testHeadingBulletsStepsAndCaution
  it("reads a heading, both lists and a caution", () => {
    const blocks = parseHelpMarkup(
      [
        "## Heading",
        "",
        "- first",
        "- second",
        "",
        "1. step one",
        "2. step two",
        "",
        "! careful",
      ].join("\n")
    );
    expect(blocks).toEqual([
      { kind: "heading", text: "Heading" },
      { kind: "bullets", items: [[text("first")], [text("second")]] },
      { kind: "steps", items: [[text("step one")], [text("step two")]] },
      { kind: "caution", spans: [text("careful")] },
    ]);
  });

  /**
   * A step's own number is thrown away: the view numbers them, so a step
   * inserted in the middle of a translated page cannot be misnumbered.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testStepsKeepOrderNotTheWrittenNumbers
  it("keeps a step's order and not the number it was written with", () => {
    expect(parseHelpMarkup("7. a\n9. b")).toEqual([
      { kind: "steps", items: [[text("a")], [text("b")]] },
    ]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testAListEndsAtProse
  it("ends a list at prose", () => {
    expect(parseHelpMarkup("- item\nprose")).toEqual([
      { kind: "bullets", items: [[text("item")]] },
      paragraph(text("prose")),
    ]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testInlineForms
  it("reads the inline forms", () => {
    expect(helpSpans("a **b** c `0xFF` d")).toEqual([
      text("a "),
      strong("b"),
      text(" c "),
      code("0xFF"),
      text(" d"),
    ]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testLinksWithAndWithoutTheirOwnWords
  it("reads a link with and without its own words", () => {
    expect(helpSpans("see [[topic:hex-view]] and [[term:fpt|the table]]")).toEqual([
      text("see "),
      { kind: "link", text: "hex-view", link: { kind: "topic", id: TOPIC.hexView } },
      text(" and "),
      { kind: "link", text: "the table", link: { kind: "term", id: termId("fpt") } },
    ]);
  });

  /**
   * Brackets that are not a link stay as they were typed. A page that loses a
   * line because of a stray `[[` is worse than one that prints it.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testUnrecognisedBracketsAreLeftAlone
  it("leaves brackets that are not a link alone", () => {
    expect(helpSpans("[[nonsense]]")).toEqual([text("[[nonsense]]")]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpMarkupTests.testPlainTextReadsLinksAsTheirWords
  it("reads a link as its words when the page is flattened", () => {
    expect(helpPlainText(parseHelpMarkup("go to [[topic:settings|Settings]] now"))).toBe(
      "go to Settings now"
    );
  });

  /** An emphasis or a quote nobody closed is prose, not a swallowed line. */
  it("leaves an unclosed form as the characters it is", () => {
    expect(helpSpans("**unclosed and `also this")).toEqual([text("**unclosed and `also this")]);
  });
});

describe("the file formats around the markup", () => {
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpFileFormatTests.testTopicFileHeader
  it("reads a page's header", () => {
    const topic = parseHelpTopicFile(
      ["# The Title", "", "> The one-line summary.", "", "The body."].join("\n"),
      TOPIC.overview
    );
    expect(topic.title).toBe("The Title");
    expect(topic.summary).toBe("The one-line summary.");
    expect(topic.blocks).toEqual([paragraph(text("The body."))]);
  });

  /**
   * A page with no `#` line still has a title — its id — rather than a blank
   * row in the contents.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpFileFormatTests.testTopicWithoutATitleFallsBackToItsID
  it("falls back to the id when a page has no title", () => {
    expect(parseHelpTopicFile("body", TOPIC.overview).title).toBe("overview");
  });

  /** `@covers` is bookkeeping for the coverage script, and never prose. */
  it("takes the metadata out of the prose", () => {
    const topic = parseHelpTopicFile(
      ["# Title", "@covers ui.help.button", "@source-sha abc123", "", "The body."].join("\n"),
      TOPIC.overview
    );
    expect(topic.covers).toEqual(["ui.help.button"]);
    expect(topic.blocks).toEqual([paragraph(text("The body."))]);
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpFileFormatTests.testTermFileFields
  it("reads a glossary's fields", () => {
    const terms = parseHelpTermFile(
      [
        "@term fpt",
        "@name Flash Partition Table",
        "@short One sentence.",
        "",
        "The body.",
        "",
        "@see term:cpd",
        "@see topic:tool-me",
        "",
        "@term cpd",
        "@name Code Partition Directory",
      ].join("\n"),
      "me"
    );
    expect(terms).toHaveLength(2);
    expect(terms[0]?.id).toBe(termId("fpt"));
    expect(terms[0]?.name).toBe("Flash Partition Table");
    expect(terms[0]?.summary).toBe("One sentence.");
    expect(terms[0]?.blocks).toEqual([paragraph(text("The body."))]);
    expect(terms[0]?.seeAlso).toEqual([
      { kind: "term", id: termId("cpd") },
      { kind: "topic", id: TOPIC.toolME },
    ]);
    expect(terms[0]?.group).toBe("me");
    expect(terms[1]?.id).toBe(termId("cpd"));
  });

  /** A term with no name of its own is visibly its id, not a blank row. */
  it("falls back to the id when a term has no name", () => {
    expect(parseHelpTermFile("@term svn", "me")[0]?.name).toBe("svn");
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpFileFormatTests.testSectionNames
  it("reads the section names", () => {
    expect(parseHelpSections("@section reading\n@name Reading a Dump").reading).toBe(
      "Reading a Dump"
    );
  });

  it("gives a glossary its own name from the same file", () => {
    const names = parseHelpSections("@section glossary-me\n@name ME words");
    expect(names["glossary-me"]).toBe("ME words");
  });

  /** Prose before the first `@term` belongs to no term and is dropped. */
  it("ignores what is written before the first term", () => {
    expect(parseHelpTermFile("A note to translators.\n\n@term fpt", "me")).toHaveLength(1);
  });

  it("knows an id that is not a topic of the book", () => {
    expect(topicId("not-a-page")).not.toBe(TOPIC.overview);
  });
});
