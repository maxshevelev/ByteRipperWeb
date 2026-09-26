/**
 * The markup the content files are written in, parsed into blocks.
 *
 * A deliberate handful of Markdown: headings, paragraphs, two kinds of list, a
 * caution line, and four inline forms. Not a Markdown library — the book needs
 * `[[term:fpt]]` to come out as a link a *panel* can act on, and it needs the
 * result to be a value the pure tests can read.
 *
 * Every rule here is one a translator has to keep, so there are as few as there
 * can be:
 *
 * - `## text` — a sub-heading.
 * - `- text` — a bullet; `1. text` (any number) — a step.
 * - `! text` — a caution.
 * - a blank line ends a block; consecutive lines of prose are one paragraph.
 * - `**bold**`, `` `code` ``, `[[topic:id]]`, `[[term:id]]`, and either link
 *   form with `|` and the words to show: `[[term:fpt|the partition table]]`.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup
 */

import { type HelpLink, termId, termLink, topicId, topicLink } from "@/core/help/helpIds";

/**
 * A run of text inside one block: plain words, something emphasised, a value to
 * be shown in the dump's own typeface, or a link to somewhere else in the book.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpSpan
 */
export type HelpSpan =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  /** Shown monospaced: an offset, a signature, a menu path typed as it is. */
  | { readonly kind: "code"; readonly text: string }
  /** `text` is what the reader sees; `link` is where it goes. */
  | { readonly kind: "link"; readonly text: string; readonly link: HelpLink };

/**
 * One block of a page. A page is a list of these, in the order they were
 * written.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpBlock
 */
export type HelpBlock =
  /** A sub-heading inside the page. The page's own title is not a block. */
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "paragraph"; readonly spans: readonly HelpSpan[] }
  /** An unordered list. Each item is its own run of spans. */
  | { readonly kind: "bullets"; readonly items: readonly (readonly HelpSpan[])[] }
  /**
   * A numbered list — a procedure, which is most of what the bench pages are.
   * Numbered by the view, so a step inserted in the middle renumbers itself.
   */
  | { readonly kind: "steps"; readonly items: readonly (readonly HelpSpan[])[] }
  /** Something to be careful about, drawn apart from the prose around it. */
  | { readonly kind: "caution"; readonly spans: readonly HelpSpan[] };

/**
 * The text after the number of a step line (`1. Open the dump.`), or nothing
 * when the line is not one. The number itself is thrown away: the view numbers
 * the steps, so a step added in the middle of a translated page cannot be given
 * the wrong number.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.stepBody
 */
function stepBody(line: string): string | undefined {
  const digits = /^\d+/.exec(line)?.[0];
  if (digits === undefined) return undefined;
  const rest = line.slice(digits.length);
  return rest.startsWith(". ") ? rest.slice(2) : undefined;
}

/**
 * `topic:opening-files`, `term:fpt`, or either with `|the words to show`.
 * Nothing for anything else, which leaves the brackets in the text as written —
 * a page that says `[[` and means it reads as it was typed rather than losing
 * the line.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.linkSpan
 */
function linkSpan(body: string): HelpSpan | undefined {
  const bar = body.indexOf("|");
  const target = (bar === -1 ? body : body.slice(0, bar)).trim();
  const shown = bar === -1 ? "" : body.slice(bar + 1).trim();
  const link = parseHelpLink(target);
  if (link === undefined) return undefined;
  return { kind: "link", text: shown === "" ? link.id : shown, link };
}

/**
 * `term:fpt` / `topic:tool-me`, the form a `@see` line and an inline link share.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpTermFile.parseLink
 */
export function parseHelpLink(text: string): HelpLink | undefined {
  const colon = text.indexOf(":");
  if (colon === -1) return undefined;
  const id = text.slice(colon + 1).trim();
  if (id === "") return undefined;
  switch (text.slice(0, colon)) {
    case "topic":
      return topicLink(topicId(id));
    case "term":
      return termLink(termId(id));
    default:
      return undefined;
  }
}

/**
 * One line of text, cut into its runs.
 *
 * Scanned once, left to right, rather than run through a chain of regular
 * expressions: the four forms cannot nest — a link's text is words, an emphasis
 * holds no code — so a single pass is both the simplest reading and the one
 * with no order-of-application surprises.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.spans
 */
export function helpSpans(line: string): HelpSpan[] {
  const result: HelpSpan[] = [];
  let plain = "";
  let at = 0;

  const flushPlain = () => {
    if (plain === "") return;
    result.push({ kind: "text", text: plain });
    plain = "";
  };

  while (at < line.length) {
    if (line.startsWith("**", at)) {
      const end = line.indexOf("**", at + 2);
      if (end !== -1) {
        flushPlain();
        result.push({ kind: "strong", text: line.slice(at + 2, end) });
        at = end + 2;
        continue;
      }
    }
    if (line[at] === "`") {
      const end = line.indexOf("`", at + 1);
      if (end !== -1) {
        flushPlain();
        result.push({ kind: "code", text: line.slice(at + 1, end) });
        at = end + 1;
        continue;
      }
    }
    if (line.startsWith("[[", at)) {
      const end = line.indexOf("]]", at + 2);
      if (end !== -1) {
        const span = linkSpan(line.slice(at + 2, end));
        if (span !== undefined) {
          flushPlain();
          result.push(span);
          at = end + 2;
          continue;
        }
      }
    }
    plain += line[at];
    at += 1;
  }
  flushPlain();
  return result;
}

/**
 * The blocks a page is written as.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.parse
 */
export function parseHelpMarkup(source: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  // The paragraph being gathered: prose lines join up until a blank line or a
  // line that starts a block of another kind.
  let paragraph: string[] = [];
  let bullets: HelpSpan[][] = [];
  let steps: HelpSpan[][] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: helpSpans(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushLists = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
    if (steps.length > 0) {
      blocks.push({ kind: "steps", items: steps });
      steps = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushLists();
  };

  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      flushAll();
      continue;
    }
    if (line.startsWith("##")) {
      flushAll();
      blocks.push({ kind: "heading", text: line.replace(/^#+/, "").trim() });
      continue;
    }
    if (line.startsWith("! ")) {
      flushAll();
      blocks.push({ kind: "caution", spans: helpSpans(line.slice(2)) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      if (steps.length > 0) flushLists();
      bullets.push(helpSpans(line.slice(2)));
      continue;
    }
    const step = stepBody(line);
    if (step !== undefined) {
      flushParagraph();
      if (bullets.length > 0) flushLists();
      steps.push(helpSpans(step));
      continue;
    }
    // Prose. A list item's continuation line would land here, so a list in
    // progress ends first — items are one line each, which is a rule worth
    // keeping because it is the one that makes translating a list a
    // line-for-line job.
    flushLists();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}

/**
 * The blocks as running text, for searching and for a one-line preview. Links
 * read as the words they show — what the reader sees is what a search over the
 * book matches.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText
 */
export function helpPlainText(blocks: readonly HelpBlock[]): string {
  return blocks.map(blockPlainText).join("\n");
}

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText */
export function blockPlainText(block: HelpBlock): string {
  switch (block.kind) {
    case "heading":
      return block.text;
    case "paragraph":
    case "caution":
      return spansPlainText(block.spans);
    case "bullets":
    case "steps":
      return block.items.map(spansPlainText).join("\n");
  }
}

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText */
export const spansPlainText = (spans: readonly HelpSpan[]): string =>
  spans.map((span) => span.text).join("");

/**
 * Everywhere the blocks point. What the tests walk to prove the book has no
 * link into nothing.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.links
 */
export function helpLinksIn(blocks: readonly HelpBlock[]): HelpLink[] {
  const links: HelpLink[] = [];
  const fromSpans = (spans: readonly HelpSpan[]) => {
    for (const span of spans) if (span.kind === "link") links.push(span.link);
  };
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        break;
      case "paragraph":
      case "caution":
        fromSpans(block.spans);
        break;
      case "bullets":
      case "steps":
        for (const item of block.items) fromSpans(item);
        break;
    }
  }
  return links;
}
