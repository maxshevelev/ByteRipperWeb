/**
 * The book as it comes off the content files: what a language that has not
 * finished translating falls back to, what a page nobody wrote does, and what a
 * reader's search matches.
 *
 * Ported from `HelpContentTests.swift`'s machinery half — the half that reads a
 * book rather than judging the shipped content. The content's own tests arrive
 * with the content (`Design/GAPS.md` G63).
 */

import { describe, expect, it } from "vitest";
import {
  glossaryName,
  helpDestinationExists,
  helpIsEmpty,
  helpTerm,
  helpTermsIn,
  helpTopic,
  helpTopics,
  resultTitle,
  searchHelp,
  UNAVAILABLE_HELP,
} from "@/core/help/helpBook";
import { ALL_HELP_TOPICS } from "@/core/help/helpContents";
import { TOPIC, termId, topicId } from "@/core/help/helpIds";
import { type HelpContentReader, loadHelpBook } from "@/core/help/helpLoader";

/** A book of a few files, the way a test would write one. */
const reader = (files: Readonly<Record<string, string>>): HelpContentReader => {
  return async (language, path) => files[`${language}/${path}`];
};

/** Every page the contents names, so a load has no holes to report. */
const everyPage = (language: string, body = "The body."): Record<string, string> =>
  Object.fromEntries(
    ALL_HELP_TOPICS.map((id) => [
      `${language}/Topics/${id}.md`,
      `# ${id}\n\n> A summary.\n\n${body}`,
    ])
  );

describe("loading the book", () => {
  it("reads the pages the contents names, in its order", async () => {
    const book = await loadHelpBook("en", reader(everyPage("en")));
    expect(book.missing).toEqual([]);
    expect(helpTopics(book).map((topic) => topic.id)).toEqual([...ALL_HELP_TOPICS]);
    expect(helpTopic(book, TOPIC.overview)?.summary).toBe("A summary.");
  });

  /**
   * A language the book has not been written in yet falls back to English
   * rather than failing: the interface may be translated before the help is,
   * and an English page beats no page.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpMarkupTests.swift#HelpFileFormatTests.testALanguageTheBookLacksFallsBackToEnglish
  it("falls back to English for a language it has nothing of", async () => {
    const book = await loadHelpBook("ja", reader({ ...everyPage("en"), "en/Sections.md": "" }));
    expect(book.language).toBe("en");
    expect(helpIsEmpty(book)).toBe(false);
  });

  /** The fallback is file by file, so a half-translated book is readable. */
  it("takes each file from the reader's language, or English for the rest", async () => {
    const book = await loadHelpBook(
      "de",
      reader({
        ...everyPage("en"),
        "de/Sections.md": "@section getting-started\n@name Erste Schritte",
        [`de/Topics/${TOPIC.overview}.md`]: "# Überblick\n\n> Eine Zeile.\n\nDer Text.",
      })
    );
    expect(book.language).toBe("de");
    expect(book.sections[0]?.name).toBe("Erste Schritte");
    expect(helpTopic(book, TOPIC.overview)?.title).toBe("Überblick");
    // Not yet translated, and so still readable.
    expect(helpTopic(book, TOPIC.saving)?.title).toBe(TOPIC.saving);
  });

  /**
   * A page the contents names and nobody wrote is reported and left out — the
   * reader keeps the other thirty-nine.
   */
  it("reports a page nobody wrote rather than losing the book", async () => {
    const files = everyPage("en");
    delete files[`en/Topics/${TOPIC.minimap}.md`];
    const book = await loadHelpBook("en", reader(files));
    expect(book.missing).toEqual([TOPIC.minimap]);
    expect(helpTopic(book, TOPIC.minimap)).toBeUndefined();
    expect(helpTopics(book).length).toBe(ALL_HELP_TOPICS.length - 1);
  });

  it("names a section by its id when nobody named it", async () => {
    const book = await loadHelpBook("en", reader(everyPage("en")));
    expect(book.sections[0]?.name).toBe("getting-started");
  });

  it("keeps each glossary in the order its file listed it", async () => {
    const book = await loadHelpBook(
      "en",
      reader({
        ...everyPage("en"),
        "en/Sections.md": "@section glossary-me\n@name ME words",
        "en/Terms/me.md": "@term svn\n@name SVN\n@short A version.\n\n@term fpt\n@name $FPT",
      })
    );
    expect(helpTermsIn(book, "me").map((term) => term.id)).toEqual([termId("svn"), termId("fpt")]);
    expect(glossaryName(book, "me")).toBe("ME words");
    // A glossary nobody named reads as its key, visibly rather than blankly.
    expect(glossaryName(book, "uefi")).toBe("uefi");
  });

  it("knows whether a link has anywhere to go", async () => {
    const book = await loadHelpBook(
      "en",
      reader({ ...everyPage("en"), "en/Terms/general.md": "@term dump\n@name Dump" })
    );
    expect(helpDestinationExists(book, { kind: "topic", id: TOPIC.saving })).toBe(true);
    expect(helpDestinationExists(book, { kind: "term", id: termId("dump") })).toBe(true);
    expect(helpDestinationExists(book, { kind: "term", id: termId("nothing") })).toBe(false);
    expect(helpDestinationExists(book, { kind: "topic", id: topicId("nothing") })).toBe(false);
  });

  it("is empty when there is nothing to read", async () => {
    expect(helpIsEmpty(UNAVAILABLE_HELP)).toBe(true);
    const book = await loadHelpBook("en", async () => undefined);
    expect(book.missing.length).toBe(ALL_HELP_TOPICS.length);
    expect(helpIsEmpty(book)).toBe(true);
  });
});

describe("searching the book", () => {
  const book = async () =>
    loadHelpBook(
      "en",
      reader({
        ...everyPage("en", "Nothing to find here."),
        [`en/Topics/${TOPIC.saving}.md`]:
          "# Saving\n\n> Writing a dump back.\n\nChromium writes in place.",
        [`en/Topics/${TOPIC.colors}.md`]: "# Colours\n\n> What a byte's colour says.\n\nGrün.",
        "en/Terms/me.md":
          "@term fpt\n@name Flash Partition Table\n@short What is in the ME region.",
      })
    );

  it("matches title, summary and body, pages before terms", async () => {
    const hits = searchHelp(await book(), "region");
    expect(hits.map(resultTitle)).toEqual(["Flash Partition Table"]);
    expect(searchHelp(await book(), "Chromium").map(resultTitle)).toEqual(["Saving"]);
    expect(searchHelp(await book(), "a").length).toBeGreaterThan(1);
  });

  it("ignores case and the accents a keyboard may not have", async () => {
    expect(searchHelp(await book(), "SAVING").map(resultTitle)).toEqual(["Saving"]);
    expect(searchHelp(await book(), "grun").map(resultTitle)).toEqual(["Colours"]);
  });

  it("finds a term by the id a panel points at it with", async () => {
    expect(searchHelp(await book(), "fpt").map(resultTitle)).toEqual(["Flash Partition Table"]);
  });

  it("answers nothing for a query that is nothing", async () => {
    expect(searchHelp(await book(), "   ")).toEqual([]);
    expect(searchHelp(await book(), "")).toEqual([]);
  });

  it("finds a term the reader asked for by name", async () => {
    const found = helpTerm(await book(), termId("fpt"));
    expect(found?.summary).toBe("What is in the ME region.");
  });
});
