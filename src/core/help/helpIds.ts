/**
 * What the pages and the words of the book are called.
 *
 * Two kinds of identifier that are easy to mistake for one another, so each is
 * a type of its own and the compiler is the cheapest place to catch the
 * mistake. A raw value is also the file the page is loaded from
 * (`Topics/<raw>.md`), so a page and its id cannot drift apart.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift
 */

/**
 * A page of the help book, named once and referred to by that name everywhere
 * — a menu item, a `?` button beside a form, a link inside another page.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpTopicID
 */
export type HelpTopicId = string & { readonly isHelpTopicId: unique symbol };

/**
 * A word the panels show and nobody outside a firmware bench has met: `$FPT`,
 * ARB SVN, a VSS store. One entry per term, keyed by a stable id so a row in a
 * panel can point at it without repeating the text.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpTermID
 */
export type HelpTermId = string & { readonly isHelpTermId: unique symbol };

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpTopicID.init */
export const topicId = (raw: string): HelpTopicId => raw as HelpTopicId;
/** @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpTermID.init */
export const termId = (raw: string): HelpTermId => raw as HelpTermId;

/**
 * Where a link in the help text goes. There are two destinations and no third:
 * another page, or a term's entry in the glossary.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpLink
 */
export type HelpLink =
  | { readonly kind: "topic"; readonly id: HelpTopicId }
  | { readonly kind: "term"; readonly id: HelpTermId };

export const topicLink = (id: HelpTopicId): HelpLink => ({ kind: "topic", id });
export const termLink = (id: HelpTermId): HelpLink => ({ kind: "term", id });

/** Whether two links point at the same thing. */
export const sameLink = (one: HelpLink, other: HelpLink): boolean =>
  one.kind === other.kind && one.id === other.id;

/** A link as one string — a key for a list, and what a history entry is. */
export const linkKey = (link: HelpLink): string => `${link.kind}:${link.id}`;

/**
 * Every page the book holds. Listed here rather than discovered from the
 * content directory so that a page a `?` button points at is a name the
 * compiler knows, and a translation missing a file is a failing test rather
 * than an empty panel.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpIDs.swift#HelpTopicID
 */
export const TOPIC = {
  // Getting started
  overview: topicId("overview"),
  firstComparison: topicId("first-comparison"),
  openingFiles: topicId("opening-files"),
  largeFiles: topicId("large-files"),

  // Reading a dump
  hexView: topicId("hex-view"),
  colors: topicId("colors"),
  navigation: topicId("navigation"),
  minimap: topicId("minimap"),
  search: topicId("search"),
  bookmarks: topicId("bookmarks"),
  segments: topicId("segments"),
  fragments: topicId("fragments"),

  // Changing a dump
  editing: topicId("editing"),
  saving: topicId("saving"),
  joinDuplicate: topicId("join-duplicate"),
  benchSafety: topicId("bench-safety"),
  flashWrites: topicId("flash-writes"),

  // The firmware panels
  toolsOverview: topicId("tools-overview"),
  toolUEFI: topicId("tool-uefi"),
  toolME: topicId("tool-me"),
  toolFIT: topicId("tool-fit"),
  toolZones: topicId("tool-zones"),
  databases: topicId("databases"),
  provenance: topicId("provenance"),

  // On the bench
  recipeDonor: topicId("recipe-donor"),
  recipeBoardData: topicId("recipe-board-data"),
  recipeMECheck: topicId("recipe-me-check"),
  recipeMicrocode: topicId("recipe-microcode"),
  recipeChecksums: topicId("recipe-checksums"),

  // Settings
  settings: topicId("settings"),
} as const;
