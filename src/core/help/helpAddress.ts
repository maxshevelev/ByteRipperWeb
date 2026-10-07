import {
  type HelpLink,
  type HelpTermId,
  type HelpTopicId,
  termLink,
  topicLink,
} from "@/core/help/helpIds";

/**
 * A help page's own address in the page's URL: `#help/opening-files` for a
 * topic, `#help/term/pch` for a glossary entry — what a reader copies and a
 * colleague opens to land on the same page (G65).
 *
 * Built from the ids the book already links by, so a page's address is the name
 * every `[[topic:…]]` and `[[term:…]]` in the book uses for it. An id is lower
 * case letters, digits and hyphens, as all of them are; anything else in a hash
 * is not a page, and is read as none rather than asked of the book.
 *
 * @web-only a Mac app has no address to give a page; this is what a page in a browser can do that it cannot
 */

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The hash that opens `link`, with its `#`. */
export function helpHash(link: HelpLink): string {
  return link.kind === "topic" ? `#help/${link.id}` : `#help/term/${link.id}`;
}

/** The page a hash names, or nothing for a hash that names none. */
export function helpLinkOfHash(hash: string): HelpLink | undefined {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = path.split("/");
  if (parts[0] !== "help") return undefined;
  // `term` is the glossary's prefix, never a topic's id.
  if (parts.length === 2 && parts[1] !== "term" && ID.test(parts[1] ?? "")) {
    return topicLink(parts[1] as HelpTopicId);
  }
  if (parts.length === 3 && parts[1] === "term" && ID.test(parts[2] ?? "")) {
    return termLink(parts[2] as HelpTermId);
  }
  return undefined;
}
