/**
 * A page of the book and a word of the glossary, as they were written and as a
 * view lays them out.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift
 */

import type { HelpLink, HelpTermId, HelpTopicId } from "@/core/help/helpIds";
import { type HelpBlock, helpPlainText } from "@/core/help/helpMarkup";

/**
 * One page of the book.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTopic
 */
export interface HelpTopic {
  readonly id: HelpTopicId;
  /** The heading of the page, and the row in the contents list. */
  readonly title: string;
  /**
   * The one line a list shows under the title, and the sentence the page opens
   * with. Written as the `> ` line at the top of the file; empty when the page
   * did not bother.
   */
  readonly summary: string;
  readonly blocks: readonly HelpBlock[];
  /**
   * The pieces of functionality this page explains, by the anchor the code
   * declares them under (`Skills/help-coverage`). Metadata, never shown — what
   * it is for is the check that new functionality did not ship without a page.
   */
  readonly covers: readonly string[];
}

/**
 * Which glossary a term belongs to — which is also which file it was written
 * in (`Terms/<raw>.md`). Three, because a reader arrives with one of three
 * questions: what does this app mean by that, what does the UEFI panel mean by
 * that, what does the ME panel mean by that.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTermGroup
 */
export type HelpTermGroup = "general" | "uefi" | "me";

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTermGroup */
export const HELP_TERM_GROUPS: readonly HelpTermGroup[] = ["general", "uefi", "me"];

/**
 * One word the panels show, explained.
 *
 * A term is not a small page: it has a *name* (what the panel writes on the
 * row) and a *short* (one sentence, which is all a popover beside that row has
 * room for), and only then a body. That shape is what lets the same entry serve
 * a tooltip, a popover and a page of the glossary without being written three
 * times.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTerm
 */
export interface HelpTerm {
  readonly id: HelpTermId;
  /** What the term is called, spelled out: "Flash Partition Table (`$FPT`)". */
  readonly name: string;
  /** One sentence. The whole of what a popover shows above the fold. */
  readonly summary: string;
  readonly blocks: readonly HelpBlock[];
  /** Where else to look, in the order the author put them. */
  readonly seeAlso: readonly HelpLink[];
  /** The glossary this term is listed under. */
  readonly group: HelpTermGroup;
}

/**
 * A group of pages in the contents list, with the name the reader sees.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpContents.swift#HelpSection
 */
export interface HelpSection {
  readonly id: string;
  /** The row the reader sees. Comes from `Sections.md`, so it translates. */
  readonly name: string;
  readonly topics: readonly HelpTopicId[];
}

/**
 * Title, summary and body as one string — what a search over the book matches
 * against.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTopic.searchText
 */
export const topicSearchText = (topic: HelpTopic): string =>
  [topic.title, topic.summary, helpPlainText(topic.blocks)].join("\n");

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpTopic.swift#HelpTerm.searchText */
export const termSearchText = (term: HelpTerm): string =>
  [term.id, term.name, term.summary, helpPlainText(term.blocks)].join("\n");
