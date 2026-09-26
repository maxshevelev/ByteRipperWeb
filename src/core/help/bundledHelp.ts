/**
 * The book as this application ships it.
 *
 * The one file of this module that knows how the content reaches the browser.
 * Everything else — the loader, the parsers, the book — takes the text it is
 * handed, which is what lets the tests read a book of four lines.
 *
 * The pages are code-split, one chunk per file, and asked for only when a
 * reader opens the help: a bench that never presses `?` never downloads the
 * book, and a bench that does downloads the language it reads.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpLoader.swift#HelpLoader.load
 * @upstream-differs the resources are a bundle directory upstream, walked with
 * `FileManager`; here they are modules the bundler knows about at build time,
 * so which languages exist is a fact of the build rather than of a directory
 * read at runtime
 */

import type { HelpContentReader } from "@/core/help/helpLoader";

/** Every content file, by its path under `content/`, as a lazy import. */
const FILES = import.meta.glob<string>("./content/**/*.md", {
  query: "?raw",
  import: "default",
});

/** `./content/en/Topics/saving.md` → `en/Topics/saving.md`. */
const relative = (path: string): string => path.replace("./content/", "");

/**
 * The languages the build actually ships, read off the files rather than
 * listed a second time somewhere a language could be forgotten.
 */
export const BUNDLED_HELP_LANGUAGES: readonly string[] = [
  ...new Set(
    Object.keys(FILES)
      .map((path) => relative(path).split("/")[0])
      .filter((language): language is string => language !== undefined)
  ),
].sort();

/**
 * Reads one file of one language, or nothing when that language has not got to
 * it — which is what makes a half-translated book readable rather than blank.
 */
export const bundledHelpContent: HelpContentReader = async (language, path) => {
  const load = FILES[`./content/${language}/${path}`];
  if (load === undefined) return undefined;
  try {
    return await load();
  } catch {
    // A chunk that will not arrive — an offline reload against a stale service
    // worker, a build half-deployed — is one missing page, not a broken book.
    return undefined;
  }
};
