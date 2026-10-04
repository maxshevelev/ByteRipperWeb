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
 * - bold may hold words and links — the book's list idiom is
 *   `- **[[term:fpt|the table]]** — …` — but cannot nest in bold.
 * - `[[web:https://…|the words to show]]` — a link out to a source. https only:
 *   a page of ours will not send a reader over plain http.
 * - `[[key:find]]` — a chord. The page names the command, and the spelling is
 *   the reader's platform's (`⌘F` on a Mac, `Ctrl+F` elsewhere), so one page is
 *   read correctly on every keyboard without the author writing both words.
 * - `[[edition:…]]` — a phrase that reads one way in the browser and another in
 *   the desktop shell, `[[edition:the menu is the way||the panel has a key]]`:
 *   the first half is the browser, the second the shell, and with no `||` the
 *   phrase is the same for both. A half may itself hold links, keys and bold,
 *   which is why the split is made before the line is cut into its runs.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup
 */

import { type HelpLink, termId, termLink, topicId, topicLink } from "@/core/help/helpIds";
import { canonicalKeyResolver, type HelpKeyResolver } from "@/core/help/helpKeys";

/**
 * A run of text inside one block: plain words, something emphasised, a value to
 * be shown in the dump's own typeface, or a link to somewhere else in the book.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpSpan
 */
export type HelpSpan =
  | { readonly kind: "text"; readonly text: string }
  /**
   * Bold is a run of the other forms, not a word: a bolded link stays a link,
   * only the weight changes. Bold cannot nest in bold.
   */
  | { readonly kind: "strong"; readonly spans: readonly HelpSpan[] }
  /** Shown monospaced: an offset, a signature, a menu path typed as it is. */
  | { readonly kind: "code"; readonly text: string }
  /** `text` is what the reader sees; `link` is where it goes. */
  | { readonly kind: "link"; readonly text: string; readonly link: HelpLink }
  /**
   * A link out of the book, to a page on the web. Separate from `link` because
   * the book's own destinations are pages a `?` button or the contents list can
   * also point at, and neither can point at the web.
   *
   * It exists for one job: a page that states something a datasheet does not
   * document has to say where the claim comes from, and a reader who wants to
   * check has to be able to get there.
   */
  | { readonly kind: "web"; readonly text: string; readonly url: string }
  /**
   * A keyboard chord. `command` is the id the page wrote (`find`, `nextDifference`);
   * what is shown and searched is that id's spelling on the reader's platform,
   * which the view and the search each resolve — the span itself holds only the id,
   * so the book is one file and the spelling is decided where the keyboard is.
   */
  | { readonly kind: "key"; readonly command: string };

/**
 * Which edition of the app a page is being read in.
 *
 * The same file is read in a browser and in the desktop shell, and the two are
 * not the same application: a chord the shell binds the browser keeps for its
 * own tabs, and the shell saves in place where a browser downloads. A page may
 * therefore mark a phrase as different for the two, and the loader keeps the
 * one the reader is in. The string is the same `AppEdition` the platform probe
 * returns; it is named here rather than imported so the book stays in `core`,
 * which does not reach into the platform layer to ask where it is running.
 */
export type HelpEdition = "browser" | "desktop";

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
 * `topic:opening-files`, `term:fpt`, `key:find`, `web:https://…`, or a link
 * form with `|the words to show`. Nothing for anything else, which leaves the
 * brackets in the text as written — a page that says `[[` and means it reads as
 * it was typed rather than losing the line.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.linkSpan
 * @upstream-differs upstream's book has no chords and no two editions, so it has
 * no `key:` or `edition:` form; these are the web's answer to being read on two
 * keyboards and in two applications
 */
function linkSpan(body: string): HelpSpan | undefined {
  const bar = body.indexOf("|");
  const target = (bar === -1 ? body : body.slice(0, bar)).trim();
  const shown = bar === -1 ? "" : body.slice(bar + 1).trim();

  if (target.startsWith("web:")) {
    // https only, and an address the browser can actually open. A source link
    // that silently renders as prose is better than one that renders as a link
    // and goes nowhere.
    const url = webUrl(target.slice("web:".length));
    return url === undefined ? undefined : { kind: "web", text: shown === "" ? url : shown, url };
  }

  if (target.startsWith("key:")) {
    // A chord has no words of its own to show: its spelling on the platform is
    // what reads, so `|` is not read here. The id is kept as written; how it is
    // spelled is the resolver's, and one the table does not carry reads as its id.
    const command = target.slice("key:".length).trim();
    return command === "" ? undefined : { kind: "key", command };
  }

  const link = parseHelpLink(target);
  if (link === undefined) return undefined;
  return { kind: "link", text: shown === "" ? link.id : shown, link };
}

/**
 * The address as something the browser will open, or nothing.
 *
 * @upstream-differs upstream builds a `URL` and asks it for its scheme; the
 * domain half keeps no browser type in scope, so the scheme is checked first and
 * the host is read off by hand: the address up to the first `/`, `?` or `#` must
 * be more than a bare port
 */
function webUrl(address: string): string | undefined {
  if (!address.startsWith("https://")) return undefined;
  const host = address.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
  if (host === "" || host.startsWith(":")) return undefined;
  return address;
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
 * expressions: the forms cannot nest, except that emphasis is a run of the
 * other forms — a bolded link stays a link, only the weight changes. A single
 * pass is both the simplest reading and the one with no order-of-application
 * surprises.
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
        // The bold is a run of the other forms, so the pass goes in again:
        // a `**[[…]]**` comes out as a link wearing weight, not as words.
        result.push({ kind: "strong", spans: helpSpans(line.slice(at + 2, end)) });
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
 * `edition` chooses which half of every `[[edition:…]]` phrase the page keeps:
 * it is done before the line is cut into its runs, because a half may itself
 * hold links and keys that the pass then parses as if the author had written
 * that half directly. A page with no such phrase reads the same on either
 * edition, which is why the default is the one the book was written for.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.parse
 * @upstream-differs upstream has one edition, so its parse has no such parameter
 */
export function parseHelpMarkup(source: string, edition: HelpEdition = "browser"): HelpBlock[] {
  source = applyEdition(source, edition);
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
 * Every `[[edition:…]]` in the source, replaced by the half the reader's edition
 * keeps.
 *
 * The split is textual, before the line is cut into its runs: a half may itself
 * hold links and keys, and those are parsed on the ordinary pass over the
 * result as if the author had written that half directly. The closing `]]` is
 * found by balancing the inner `[[` and `]]` the phrase carries, so a half that
 * holds `[[key:tool1]]` does not end the phrase early. The two halves are split
 * on the first `||` that sits outside any `[[ … ]]` — a single `|` inside a
 * half's own link is not the split — and with no such `||` the phrase is the
 * same for both editions and is kept whole.
 *
 * @web-only upstream has one edition; there is nothing here to choose
 */
export function applyEdition(source: string, edition: HelpEdition): string {
  if (!source.includes("[[edition:")) return source;
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = source.indexOf("[[edition:", at);
    if (start === -1) {
      out.push(source.slice(at));
      break;
    }
    out.push(source.slice(at, start));
    const close = editionClose(source, start + "[[edition:".length);
    if (close === -1) {
      // An unbalanced phrase: keep it as written rather than eating the line,
      // and stop — there is nothing after a phrase that has no close.
      out.push(source.slice(start));
      break;
    }
    out.push(editionBranch(source.slice(start + "[[edition:".length, close), edition));
    at = close + 2;
  }
  return out.join("");
}

/** The index of the `]]` that closes the phrase begun at `from`, or -1. */
function editionClose(source: string, from: number): number {
  let depth = 1;
  let at = from;
  while (at < source.length) {
    if (source.startsWith("[[", at)) {
      depth += 1;
      at += 2;
    } else if (source.startsWith("]]", at)) {
      depth -= 1;
      at += 2;
      if (depth === 0) return at - 2;
    } else {
      at += 1;
    }
  }
  return -1;
}

/** The half of a phrase's body that `edition` keeps. */
function editionBranch(body: string, edition: HelpEdition): string {
  const bar = topLevelEditionBar(body);
  const chosen =
    edition === "desktop"
      ? bar === -1
        ? body
        : body.slice(bar + 2)
      : bar === -1
        ? body
        : body.slice(0, bar);
  return chosen.trim();
}

/**
 * The `||` that splits a phrase's halves, or -1: the first double pipe that is
 * not inside a `[[ … ]]` a half carries.
 */
function topLevelEditionBar(body: string): number {
  let depth = 0;
  let at = 0;
  while (at < body.length) {
    if (body.startsWith("[[", at)) {
      depth += 1;
      at += 2;
    } else if (body.startsWith("]]", at)) {
      depth -= 1;
      at += 2;
    } else {
      if (depth === 0 && body[at] === "|" && body[at + 1] === "|") return at;
      at += 1;
    }
  }
  return -1;
}

/**
 * The blocks as running text, for searching and for a one-line preview. Links
 * read as the words they show, and a chord reads as the spelling `resolveKey`
 * gives it — so a search matches what the reader sees. With no resolver in hand
 * a chord reads as the book wrote it: the Mac's spelling, the one form the book
 * was authored in.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText
 * @upstream-differs upstream's book has no chords, so its plainText has no resolver;
 * `resolveKey` is the web's way of keeping a search on the platform its reader is on
 */
export function helpPlainText(
  blocks: readonly HelpBlock[],
  resolveKey: HelpKeyResolver = canonicalKeyResolver
): string {
  return blocks.map((block) => blockPlainText(block, resolveKey)).join("\n");
}

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText */
export function blockPlainText(
  block: HelpBlock,
  resolveKey: HelpKeyResolver = canonicalKeyResolver
): string {
  switch (block.kind) {
    case "heading":
      return block.text;
    case "paragraph":
    case "caution":
      return spansPlainText(block.spans, resolveKey);
    case "bullets":
    case "steps":
      return block.items.map((item) => spansPlainText(item, resolveKey)).join("\n");
  }
}

/** @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.plainText */
export const spansPlainText = (
  spans: readonly HelpSpan[],
  resolveKey: HelpKeyResolver = canonicalKeyResolver
): string =>
  spans
    .map((span) => {
      switch (span.kind) {
        case "strong":
          return spansPlainText(span.spans, resolveKey);
        case "key":
          return resolveKey(span.command);
        default:
          return span.text;
      }
    })
    .join("");

/** Bold may hold a link, so a flat walk flattens it one level first. */
function flattened(spans: readonly HelpSpan[]): HelpSpan[] {
  return spans.flatMap((span) => (span.kind === "strong" ? span.spans : [span]));
}

/**
 * Every link out of the book a page carries — what the tests check for shape
 * rather than for a destination inside the book.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.webLinks
 */
export function helpWebLinks(blocks: readonly HelpBlock[]): string[] {
  const urls: string[] = [];
  const fromSpans = (spans: readonly HelpSpan[]) => {
    for (const span of flattened(spans)) if (span.kind === "web") urls.push(span.url);
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
  return urls;
}

/**
 * Everywhere the blocks point. What the tests walk to prove the book has no
 * link into nothing.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpMarkup.swift#HelpMarkup.links
 */
export function helpLinksIn(blocks: readonly HelpBlock[]): HelpLink[] {
  const links: HelpLink[] = [];
  const fromSpans = (spans: readonly HelpSpan[]) => {
    for (const span of flattened(spans)) if (span.kind === "link") links.push(span.link);
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
