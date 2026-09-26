/**
 * The words this application ships, by language.
 *
 * The one file of this module that knows how a catalogue reaches the browser,
 * as `bundledHelp` is for the book. A language is one file, asked for only when
 * it is the language in force: a reader who never leaves English never
 * downloads Russian.
 *
 * English ships no file — the keys are the English — which is why the catalogue
 * for it is empty rather than a thousand lines mapping every string to itself.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Catalogue.load
 * @upstream-differs upstream reads `Resources/<lang>.lproj/Localizable.strings`
 * out of the bundle at once; here the file is a module the bundler code-splits,
 * so loading is asynchronous and which languages exist is a fact of the build
 */

import type { AppLanguage } from "@/core/localization/appLanguage";
import { FALLBACK_LANGUAGE } from "@/core/localization/appLanguage";
import { type Catalogue, ENGLISH_CATALOGUE } from "@/core/localization/localization";
import { parseStringsFile } from "@/core/localization/stringsFile";

/** Every catalogue the build ships, by its path, as a lazy import. */
const FILES = import.meta.glob<string>("./catalogues/*.strings", {
  query: "?raw",
  import: "default",
});

/** The languages a catalogue actually exists for, English aside. */
export const BUNDLED_CATALOGUE_LANGUAGES: readonly string[] = Object.keys(FILES)
  .map((path) => path.replace("./catalogues/", "").replace(".strings", ""))
  .sort();

/**
 * The words for `language`.
 *
 * A language with no file — English, or one whose translation has not started —
 * comes back as the keys themselves, which is correct English rather than a
 * blank interface.
 */
export async function loadCatalogue(language: AppLanguage): Promise<Catalogue> {
  if (language === FALLBACK_LANGUAGE) return ENGLISH_CATALOGUE;
  const load = FILES[`./catalogues/${language}.strings`];
  if (load === undefined) return { language, entries: {} };
  try {
    return { language, entries: parseStringsFile(await load()) };
  } catch {
    // A chunk that will not arrive is an interface in English, not a broken
    // one: every key is its own English text.
    return { language, entries: {} };
  }
}
