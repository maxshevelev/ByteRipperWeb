/**
 * Ported from `HelpContentTests.swift`: the content itself, as shipped.
 *
 * These are the tests that make the book maintainable — a page renamed, a term
 * deleted, a link mistyped or a language half-translated is a failure here
 * rather than a dead end in the panel.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_HELP_LANGUAGES, bundledHelpContent } from "@/core/help/bundledHelp";
import {
  glossaryName,
  type HelpBook,
  helpDestinationExists,
  helpIsEmpty,
  helpTerm,
  helpTerms,
  helpTermsIn,
  helpTopic,
  helpTopics,
  resultLink,
  searchHelp,
} from "@/core/help/helpBook";
import { ALL_HELP_TOPICS, HELP_SECTIONS } from "@/core/help/helpContents";
import { linkKey, TOPIC, termId } from "@/core/help/helpIds";
import { loadHelpBook } from "@/core/help/helpLoader";
import { helpLinksIn, helpPlainText } from "@/core/help/helpMarkup";
import { HELP_TERM_GROUPS } from "@/core/help/helpTopic";

let book: HelpBook & { readonly missing: readonly string[] };

beforeAll(async () => {
  book = await loadHelpBook("en", bundledHelpContent);
});

describe("the book as it ships", () => {
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testTheBookLoads
  it("loads", () => {
    expect(helpIsEmpty(book), "the help content did not load").toBe(false);
    expect(book.language).toBe("en");
    expect(book.missing, "a page the contents names is not written").toEqual([]);
  });

  /** Every page the contents names exists, has a title, a summary and a body. */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEveryTopicIsWritten
  it("has every page written", () => {
    for (const id of ALL_HELP_TOPICS) {
      const topic = helpTopic(book, id);
      expect(topic, `no page for ${id}`).toBeDefined();
      if (topic === undefined) continue;
      expect(topic.title, `${id} has no \`# \` title line`).not.toBe(String(id));
      expect(topic.summary, `${id} has no \`> \` summary`).not.toBe("");
      expect(topic.blocks.length, `${id} has no body`).toBeGreaterThan(0);
    }
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEverySectionIsNamed
  it("names every section", () => {
    expect(book.sections).toHaveLength(HELP_SECTIONS.length);
    for (const section of book.sections) {
      expect(section.name, `section ${section.id} has no name in Sections.md`).not.toBe(section.id);
      expect(section.topics.length).toBeGreaterThan(0);
    }
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEveryTermIsWritten
  it("has every glossary entry written", () => {
    expect(helpTerms(book).length).toBeGreaterThan(0);
    for (const term of helpTerms(book)) {
      expect(term.name, `${term.id} has no @name`).not.toBe(String(term.id));
      expect(term.summary, `${term.id} has no @short`).not.toBe("");
      expect(term.blocks.length, `${term.id} has no body`).toBeGreaterThan(0);
    }
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testTermIDsAreUnique
  it("gives every glossary entry its own id", () => {
    const ids = helpTerms(book).map((term) => String(term.id));
    expect(new Set(ids).size, "two glossary entries share an id").toBe(ids.length);
  });

  /**
   * A group with nothing in it is a file that failed to parse rather than a
   * deliberate choice.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEveryGlossaryHasEntriesAndAName
  it("fills and names every glossary", () => {
    for (const group of HELP_TERM_GROUPS) {
      expect(helpTermsIn(book, group).length, `the ${group} glossary is empty`).toBeGreaterThan(0);
      expect(glossaryName(book, group), `the ${group} glossary has no name`).not.toBe(group);
    }
  });

  /** No link in the book leads anywhere but into the book. */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEveryLinkResolves
  it("resolves every link it writes", () => {
    for (const topic of helpTopics(book)) {
      for (const link of helpLinksIn(topic.blocks)) {
        expect(
          helpDestinationExists(book, link),
          `${topic.id} links to ${linkKey(link)}, which does not exist`
        ).toBe(true);
      }
    }
    for (const term of helpTerms(book)) {
      for (const link of [...helpLinksIn(term.blocks), ...term.seeAlso]) {
        expect(
          helpDestinationExists(book, link),
          `the term ${term.id} links to ${linkKey(link)}, which does not exist`
        ).toBe(true);
      }
    }
  });

  /**
   * Every language ships the same pages. Adding `de` without translating a page
   * is fine — the loader falls back word by word — but a page that exists in
   * *no* language is a page nobody can read.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testEveryShippedLanguageLoads
  it("loads every language the build ships", async () => {
    expect(BUNDLED_HELP_LANGUAGES).toContain("en");
    for (const language of BUNDLED_HELP_LANGUAGES) {
      const loaded = await loadHelpBook(language, bundledHelpContent);
      expect(helpTopics(loaded).length, `${language} is missing pages`).toBe(
        ALL_HELP_TOPICS.length
      );
    }
  });

  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testSearchFindsPagesAndTerms
  it("finds pages and terms by one word", () => {
    const hits = searchHelp(book, "checksum").map((hit) => linkKey(resultLink(hit)));
    expect(hits).toContain(`topic:${TOPIC.recipeChecksums}`);
    expect(hits).toContain("term:checksum");
    expect(searchHelp(book, "   ")).toEqual([]);
  });

  /**
   * The whole point of a glossary on a bench: a word typed as the panel writes
   * it finds its entry.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testTheAcronymsThePanelsShowAreAllExplained
  it("explains every acronym the panels show", () => {
    const expected = [
      "fpt",
      "cpd",
      "manifest",
      "mfs",
      "efs",
      "svn",
      "arb-svn",
      "vcn",
      "utok",
      "huffman",
      "iup",
      "rbe-pm",
      "integrity-table",
      "anti-replay",
      "oem-config",
      "bpdt",
      "cse-layout-table",
      "sku",
      "flash-descriptor",
      "region",
      "volume",
      "ffs-file",
      "section",
      "guid",
      "nvram",
      "vss",
      "fit",
      "microcode",
      "boot-guard",
    ];
    for (const id of expected) {
      expect(helpTerm(book, termId(id)), `no glossary entry for ${id}`).toBeDefined();
    }
  });
});

describe("the anchors a page declares", () => {
  /**
   * Metadata is read out of the page, not shown in it. A reader must never meet
   * `@covers menu.file.append` in the middle of a paragraph.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testCoverageAnchorsAreNotPartOfWhatTheReaderSees
  it("keeps the bookkeeping out of what the reader sees", () => {
    for (const topic of helpTopics(book)) {
      const text = helpPlainText(topic.blocks) + topic.summary + topic.title;
      expect(text, `${topic.id} shows its own bookkeeping`).not.toContain("@covers");
      expect(text, `${topic.id} shows its own fingerprint`).not.toContain("@source-sha");
    }
    for (const term of helpTerms(book)) {
      expect(helpPlainText(term.blocks), `${term.id} shows its own bookkeeping`).not.toContain(
        "@covers"
      );
    }
  });

  /**
   * The pages do carry anchors — a book that covers nothing would pass the test
   * above by saying nothing at all.
   */
  // @upstream Packages/HelpBook/Tests/HelpBookTests/HelpContentTests.swift#HelpContentTests.testThePagesDeclareWhatTheyCover
  it("declares what it covers", () => {
    const covered = new Set(helpTopics(book).flatMap((topic) => topic.covers));
    expect(covered.size, "the help covers almost no declared functionality").toBeGreaterThan(40);
    // An anchor is a lowercase dotted path; anything else is a typo that the
    // coverage script would report as both uncovered and orphaned.
    for (const anchor of covered) {
      expect(anchor, `${anchor} is not lowercase`).toBe(anchor.toLowerCase());
      expect(anchor, `${anchor} is not a dotted path`).toContain(".");
    }
  });
});
