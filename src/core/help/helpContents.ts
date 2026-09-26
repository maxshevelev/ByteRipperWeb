/**
 * The shape of the book: which pages there are and in what order.
 *
 * In code, not in a content file, and that is the whole division this module
 * rests on — **structure is code, words are resources**. A translator who
 * reorders a list cannot drop a page the app links to, and a page added here is
 * a page every language is then measured against: the tests fail until the file
 * exists in each.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpContents.swift#HelpContents
 */

import { type HelpTopicId, TOPIC } from "@/core/help/helpIds";

/** A group of pages in the contents list, as the code names it. */
export interface HelpSectionShape {
  /** The key `Sections.md` gives a name to. */
  readonly id: string;
  readonly topics: readonly HelpTopicId[];
}

/**
 * The sections, in the order the contents list shows them.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpContents.swift#HelpContents.sections
 */
export const HELP_SECTIONS: readonly HelpSectionShape[] = [
  {
    id: "getting-started",
    topics: [TOPIC.overview, TOPIC.firstComparison, TOPIC.openingFiles, TOPIC.largeFiles],
  },
  {
    id: "reading",
    topics: [
      TOPIC.hexView,
      TOPIC.colors,
      TOPIC.navigation,
      TOPIC.search,
      TOPIC.minimap,
      TOPIC.bookmarks,
      TOPIC.segments,
      TOPIC.fragments,
    ],
  },
  {
    id: "changing",
    topics: [
      TOPIC.editing,
      TOPIC.saving,
      TOPIC.joinDuplicate,
      TOPIC.benchSafety,
      TOPIC.flashWrites,
    ],
  },
  {
    id: "firmware",
    topics: [
      TOPIC.toolsOverview,
      TOPIC.toolUEFI,
      TOPIC.toolME,
      TOPIC.toolFIT,
      TOPIC.toolZones,
      TOPIC.databases,
      TOPIC.provenance,
    ],
  },
  {
    id: "bench",
    topics: [
      TOPIC.recipeDonor,
      TOPIC.recipeBoardData,
      TOPIC.recipeMECheck,
      TOPIC.recipeMicrocode,
      TOPIC.recipeChecksums,
    ],
  },
  { id: "settings", topics: [TOPIC.settings] },
];

/**
 * Every page the book holds, in contents order — what the loader reads and what
 * the tests count.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpContents.swift#HelpContents.allTopics
 */
export const ALL_HELP_TOPICS: readonly HelpTopicId[] = HELP_SECTIONS.flatMap(
  (section) => section.topics
);
