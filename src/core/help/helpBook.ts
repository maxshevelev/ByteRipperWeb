/**
 * The help, loaded: every page, every term, and the contents that order them.
 *
 * Built once and held — the whole book is a few dozen small files, and the
 * parse of all of them is well under the time it takes the panel to open, so
 * there is no lazier arrangement worth its complexity.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook
 */

import type { HelpLink, HelpTermId, HelpTopicId } from "@/core/help/helpIds";
import {
  HELP_TERM_GROUPS,
  type HelpSection,
  type HelpTerm,
  type HelpTermGroup,
  type HelpTopic,
  termSearchText,
  topicSearchText,
} from "@/core/help/helpTopic";

export interface HelpBook {
  /**
   * The language the pages were loaded from — `en`, or whichever directory
   * under the content root matched what the reader reads.
   */
  readonly language: string;
  readonly sections: readonly HelpSection[];
  /**
   * What each glossary is called in the contents list. From `Sections.md` under
   * `glossary-<group>`, so it translates with the rest of the words.
   */
  readonly glossaryNames: Readonly<Partial<Record<HelpTermGroup, string>>>;
  readonly topicsById: ReadonlyMap<HelpTopicId, HelpTopic>;
  readonly termsById: ReadonlyMap<HelpTermId, HelpTerm>;
  /** The terms of each glossary, in the order their file listed them. */
  readonly termsByGroup: ReadonlyMap<HelpTermGroup, readonly HelpTermId[]>;
}

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.init */
export function makeHelpBook(
  language: string,
  sections: readonly HelpSection[],
  topics: readonly HelpTopic[],
  terms: readonly HelpTerm[],
  glossaryNames: Readonly<Partial<Record<HelpTermGroup, string>>> = {}
): HelpBook {
  const topicsById = new Map<HelpTopicId, HelpTopic>();
  for (const topic of topics) if (!topicsById.has(topic.id)) topicsById.set(topic.id, topic);
  const termsById = new Map<HelpTermId, HelpTerm>();
  const termsByGroup = new Map<HelpTermGroup, HelpTermId[]>();
  for (const term of terms) {
    if (!termsById.has(term.id)) termsById.set(term.id, term);
    const group = termsByGroup.get(term.group) ?? [];
    group.push(term.id);
    termsByGroup.set(term.group, group);
  }
  return { language, sections, glossaryNames, topicsById, termsById, termsByGroup };
}

/**
 * The book with nothing in it — what a build with broken resources hands the
 * panel, which then says the help is unavailable.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/Help.swift#HelpBook.unavailable
 */
export const UNAVAILABLE_HELP: HelpBook = makeHelpBook("en", [], [], []);

/** @upstream Packages/HelpBook/Sources/HelpBook/Help.swift#HelpBook.isEmpty */
export const helpIsEmpty = (book: HelpBook): boolean =>
  book.topicsById.size === 0 && book.termsById.size === 0;

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.topic */
export const helpTopic = (book: HelpBook, id: HelpTopicId): HelpTopic | undefined =>
  book.topicsById.get(id);

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.term */
export const helpTerm = (book: HelpBook, id: HelpTermId): HelpTerm | undefined =>
  book.termsById.get(id);

/**
 * Every page, in contents order.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.topics
 */
export const helpTopics = (book: HelpBook): HelpTopic[] =>
  book.sections.flatMap((section) =>
    section.topics
      .map((id) => helpTopic(book, id))
      .filter((topic): topic is HelpTopic => topic !== undefined)
  );

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.terms */
export const helpTermsIn = (book: HelpBook, group: HelpTermGroup): HelpTerm[] =>
  (book.termsByGroup.get(group) ?? [])
    .map((id) => helpTerm(book, id))
    .filter((term): term is HelpTerm => term !== undefined);

/**
 * Every term, in glossary order.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.terms
 */
export const helpTerms = (book: HelpBook): HelpTerm[] =>
  HELP_TERM_GROUPS.flatMap((group) => helpTermsIn(book, group));

/**
 * What a glossary is called, falling back to its key so a name nobody wrote is
 * visibly missing rather than blank.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.glossaryName
 */
export const glossaryName = (book: HelpBook, group: HelpTermGroup): string =>
  book.glossaryNames[group] ?? group;

/**
 * What a link points at, as something to show. False when the book has nothing
 * under that id — which the tests make sure never happens for a link the book
 * itself wrote, but can happen for one a panel names.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.destinationExists
 */
export const helpDestinationExists = (book: HelpBook, link: HelpLink): boolean =>
  link.kind === "topic" ? book.topicsById.has(link.id) : book.termsById.has(link.id);

/**
 * A hit: the page or the term itself, so the list can show its own title and
 * summary without looking anything up again.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpSearchResult
 */
export type HelpSearchResult =
  | { readonly kind: "topic"; readonly topic: HelpTopic }
  | { readonly kind: "term"; readonly term: HelpTerm };

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpSearchResult.title */
export const resultTitle = (result: HelpSearchResult): string =>
  result.kind === "topic" ? result.topic.title : result.term.name;

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpSearchResult.summary */
export const resultSummary = (result: HelpSearchResult): string =>
  result.kind === "topic" ? result.topic.summary : result.term.summary;

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpSearchResult.link */
export const resultLink = (result: HelpSearchResult): HelpLink =>
  result.kind === "topic"
    ? { kind: "topic", id: result.topic.id }
    : { kind: "term", id: result.term.id };

/**
 * Folded for comparison: case and accents off, so a reader who types `fur`
 * finds «für» and one who types `FPT` finds `$FPT`.
 *
 * @upstream-differs upstream asks `String.range(of:options:)` for a
 * case- and diacritic-insensitive match; a browser has no such comparison, so
 * the fold is done to both sides before an ordinary `includes`
 */
const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Pages and terms whose text holds `query`, pages first, each in the order the
 * book lists it.
 *
 * A plain case-insensitive, accent-insensitive substring match over the whole
 * of an entry — title, summary and body. Ranking a bench tool's help would be
 * inventing a problem: the book is forty pages, and what the reader typed is
 * nearly always a term that appears in two of them.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.search
 */
export function searchHelp(book: HelpBook, query: string): HelpSearchResult[] {
  const needle = folded(query.trim());
  if (needle === "") return [];
  const topics: HelpSearchResult[] = helpTopics(book)
    .filter((topic) => folded(topicSearchText(topic)).includes(needle))
    .map((topic) => ({ kind: "topic", topic }));
  const terms: HelpSearchResult[] = helpTerms(book)
    .filter((term) => folded(termSearchText(term)).includes(needle))
    .map((term) => ({ kind: "term", term }));
  return [...topics, ...terms];
}
