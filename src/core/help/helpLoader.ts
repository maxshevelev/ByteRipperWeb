/**
 * Reading the book out of the content files.
 *
 * The language is a *directory*: `en/Topics/…`, `de/Topics/…`. Adding German
 * is adding `de/` with the same file names in it — no manifest to edit, no
 * build setting — and a file that has not been translated yet falls back to the
 * one in `en/` rather than leaving a blank page.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpLoader
 * @upstream-differs upstream reads the bundle with `FileManager`, which answers
 * at once; a browser's file arrives over a promise, so the reader is handed in
 * and the load is asynchronous. It is also what lets a test give the loader a
 * book of four lines without a directory anywhere
 */

import { type HelpBook, makeHelpBook } from "@/core/help/helpBook";
import { ALL_HELP_TOPICS, HELP_SECTIONS } from "@/core/help/helpContents";
import type { HelpLink, HelpTopicId } from "@/core/help/helpIds";
import { termId } from "@/core/help/helpIds";
import { parseHelpLink, parseHelpMarkup } from "@/core/help/helpMarkup";
import {
  HELP_TERM_GROUPS,
  type HelpSection,
  type HelpTerm,
  type HelpTermGroup,
  type HelpTopic,
} from "@/core/help/helpTopic";

/**
 * The language every file exists in, and what a half-translated book falls back
 * to word by word.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpLoader.fallbackLanguage
 */
export const HELP_FALLBACK_LANGUAGE = "en";

/**
 * Where the content comes from: one file of one language, or nothing when that
 * language has not got to it.
 *
 * An interface because the app reads bundled modules, a test reads a literal,
 * and neither should have to know about the other.
 */
export type HelpContentReader = (language: string, path: string) => Promise<string | undefined>;

/**
 * The book in `language`.
 *
 * A language with no content of its own falls back to English rather than
 * failing: the app may ship a translated interface before its help has caught
 * up, and an English page is worth more than no page.
 *
 * A page the contents names and nobody wrote is left out of the book rather
 * than thrown, because a browser is not a build: the panel says the page is
 * missing, the coverage script says so louder, and the reader keeps the other
 * thirty-nine.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpLoader.load
 * @upstream-differs upstream throws `missingTopic`; here a missing page is left
 * out and reported, a thrown error in a browser costing the reader the book
 */
export async function loadHelpBook(
  language: string,
  read: HelpContentReader
): Promise<HelpBook & { readonly missing: readonly HelpTopicId[] }> {
  /**
   * One file, from the reader's language or — when that language has not got to
   * it yet — from English.
   */
  const readWithFallback = async (path: string): Promise<string | undefined> =>
    (await read(language, path)) ?? (await read(HELP_FALLBACK_LANGUAGE, path));

  const spoken =
    (await read(language, "Sections.md")) === undefined ? HELP_FALLBACK_LANGUAGE : language;

  const sectionNames = parseHelpSections((await readWithFallback("Sections.md")) ?? "");
  const sections: HelpSection[] = HELP_SECTIONS.map((section) => ({
    id: section.id,
    // A section whose name nobody wrote reads as its id: ugly, and visibly so,
    // which is the point — the tests catch it first.
    name: sectionNames[section.id] ?? section.id,
    topics: section.topics,
  }));

  const topics: HelpTopic[] = [];
  const missing: HelpTopicId[] = [];
  for (const id of ALL_HELP_TOPICS) {
    const text = await readWithFallback(`Topics/${id}.md`);
    if (text === undefined) {
      missing.push(id);
      continue;
    }
    topics.push(parseHelpTopicFile(text, id));
  }

  const terms: HelpTerm[] = [];
  for (const group of HELP_TERM_GROUPS) {
    terms.push(...parseHelpTermFile((await readWithFallback(`Terms/${group}.md`)) ?? "", group));
  }

  const glossaryNames: Partial<Record<HelpTermGroup, string>> = {};
  for (const group of HELP_TERM_GROUPS) {
    const name = sectionNames[`glossary-${group}`];
    if (name !== undefined) glossaryNames[group] = name;
  }

  return {
    ...makeHelpBook(spoken, sections, topics, terms, glossaryNames),
    missing,
  };
}

/**
 * The text after a `@keyword` on its own line, or nothing when the line is
 * something else.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpSectionFile.value
 */
const keywordValue = (keyword: string, line: string): string | undefined =>
  line.startsWith(`${keyword} `) ? line.slice(keyword.length + 1).trim() : undefined;

const lines = (source: string): string[] => source.split(/\r\n|\r|\n/);

/**
 * `Sections.md`: the contents' group names, which are words and so translate,
 * keyed by the ids `helpContents` holds.
 *
 *     @section getting-started
 *     @name Getting started
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpSectionFile.parse
 */
export function parseHelpSections(source: string): Record<string, string> {
  const names: Record<string, string> = {};
  let current: string | undefined;
  for (const raw of lines(source)) {
    const line = raw.trim();
    const id = keywordValue("@section", line);
    if (id !== undefined) {
      current = id;
      continue;
    }
    const name = keywordValue("@name", line);
    if (name !== undefined && current !== undefined) names[current] = name;
  }
  return names;
}

/**
 * A page: `# Title` on the first line, an optional `> ` summary, then markup.
 *
 * Lines beginning `@` are **metadata, not prose** — `@covers` names the piece of
 * functionality this page explains (`Skills/help-coverage`) and `@source-sha`
 * records the English a translation was made from. They are read out here and
 * never reach the reader: a page is judged on what it says, and the bookkeeping
 * that keeps it honest is not part of that.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpTopicFile.parse
 */
export function parseHelpTopicFile(source: string, id: HelpTopicId): HelpTopic {
  let title = "";
  let summary = "";
  const body: string[] = [];
  const covers: string[] = [];
  let inHeader = true;

  for (const raw of lines(source)) {
    const line = raw.trim();
    const anchor = keywordValue("@covers", line);
    if (anchor !== undefined) {
      covers.push(anchor);
      continue;
    }
    if (line.startsWith("@")) continue;
    if (inHeader) {
      if (line === "") continue;
      if (title === "" && line.startsWith("# ")) {
        title = line.slice(2);
        continue;
      }
      if (summary === "" && line.startsWith("> ")) {
        summary = line.slice(2);
        continue;
      }
      inHeader = false;
    }
    body.push(raw);
  }
  return {
    id,
    title: title === "" ? id : title,
    summary,
    blocks: parseHelpMarkup(body.join("\n")),
    covers,
  };
}

/**
 * A glossary file: one `@term` block per word.
 *
 *     @term fpt
 *     @name Flash Partition Table (`$FPT`)
 *     @short The list of what is in the ME region and where.
 *
 *     Body, in the same markup as a page.
 *
 *     @see term:cpd
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpTermFile.parse
 */
export function parseHelpTermFile(source: string, group: HelpTermGroup): HelpTerm[] {
  const terms: HelpTerm[] = [];
  let id: string | undefined;
  let name = "";
  let short = "";
  let seeAlso: HelpLink[] = [];
  let body: string[] = [];

  const flush = () => {
    if (id === undefined) return;
    terms.push({
      id: termId(id),
      name: name === "" ? id : name,
      summary: short,
      blocks: parseHelpMarkup(body.join("\n")),
      seeAlso,
      group,
    });
    id = undefined;
    name = "";
    short = "";
    seeAlso = [];
    body = [];
  };

  for (const raw of lines(source)) {
    const line = raw.trim();
    const next = keywordValue("@term", line);
    if (next !== undefined) {
      flush();
      id = next;
      continue;
    }
    const written = keywordValue("@name", line);
    if (written !== undefined) {
      name = written;
      continue;
    }
    const sentence = keywordValue("@short", line);
    if (sentence !== undefined) {
      short = sentence;
      continue;
    }
    const see = keywordValue("@see", line);
    if (see !== undefined) {
      const link = parseHelpLink(see);
      if (link !== undefined) seeAlso.push(link);
      continue;
    }
    // Metadata (`@covers`, `@source-sha`): read by the coverage script, never
    // shown to a reader.
    if (line.startsWith("@")) continue;
    if (id !== undefined) body.push(raw);
  }
  flush();
  return terms;
}
