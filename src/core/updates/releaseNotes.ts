/**
 * The first paragraph of a release's notes, as the landing screen prints it
 * under the version: the build's own summary, not the whole body.
 *
 * A release body is markdown, so the reading strips what a reader would not
 * read — the heading markers, the link and image addresses, the emphasis — and
 * leaves the words. A block is a run of lines the body sets off from its
 * neighbours with a blank line; the first block that is not empty is the
 * paragraph, and the rest is not wanted, so the reading stops there.
 *
 * @web-only the notes are the web edition's own; the macOS app links to the
 * release's page and prints no text of it
 */
export function firstParagraph(body: string): string {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block
      .split(/\r?\n/)
      .map((line) => line.replace(HEADING, "").replace(LIST, ""))
      .join(" ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) return text;
  }
  return "";
}

/** The start of a heading line: its markers, so what is left is the line's words. */
const HEADING = /^\s*#{1,6}\s+/;
/** The start of a list item line: its marker, so what is left is the item's words. */
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
