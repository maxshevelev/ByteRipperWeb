/**
 * The word the app says for a key, in the language it is currently speaking.
 *
 * The key is the English text, so a site is localized by wrapping the literal
 * it already had, and a key nobody has translated comes back as itself — which
 * is correct English, never a blank label and never `settings.language.caption`
 * (`Design/LOCALIZATION.md`).
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization
 * @upstream-differs upstream's catalogue loads itself from the bundle on the
 * first word asked for, which a browser cannot do: a file arrives over a
 * promise. So the catalogue is *installed* — awaited once at startup and again
 * when the language changes — and `L` stays the synchronous call a render is
 * allowed to make
 */

import type { AppLanguage } from "@/core/localization/appLanguage";
import { FALLBACK_LANGUAGE } from "@/core/localization/appLanguage";

/**
 * One language's words: a flat map from the English text to the translation.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Catalogue
 */
export interface Catalogue {
  readonly language: AppLanguage;
  readonly entries: Readonly<Record<string, string>>;
}

/**
 * English is the keys themselves: shipping a file that maps every string to
 * itself would be a file nobody can ever get wrong, and 1200 lines of it.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Catalogue.empty
 */
export const ENGLISH_CATALOGUE: Catalogue = { language: FALLBACK_LANGUAGE, entries: {} };

/**
 * The catalogue in force. Module state rather than a store, because `L` is
 * called from everywhere — a render, a worker, a canvas's status line — and
 * threading a catalogue through all of it would be a second argument on every
 * function that says a word.
 */
let current: Catalogue = ENGLISH_CATALOGUE;

/**
 * Puts `catalogue` in force. The app calls this once it has loaded the words
 * for the language it resolved, and again when the reader changes it; a test
 * calls it with a catalogue of its own, which is why nothing here reads a file.
 */
export function installCatalogue(catalogue: Catalogue): void {
  current = catalogue;
}

/** The language the app is speaking now. */
export const currentLanguage = (): AppLanguage => current.language;

/** The catalogue in force, for the few readers that need it whole. */
export const currentCatalogue = (): Catalogue => current;

/**
 * The word for `key`, or the key itself — which is the English text, so an
 * untranslated string reads correctly rather than reading as a key.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Catalogue.string
 */
export const catalogueString = (catalogue: Catalogue, key: string): string =>
  catalogue.entries[key] ?? key;

/**
 * Every key a catalogue holds — what the coverage script compares against the
 * keys the code asks for.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.keys
 */
export const catalogueKeys = (catalogue: Catalogue): ReadonlySet<string> =>
  new Set(Object.keys(catalogue.entries));

/** What a call site may pour into a sentence: whatever it used to interpolate. */
export type LMessageArgument = string | number | bigint | boolean;

/** The second argument that asks for a context rather than filling a placeholder. */
export interface LContext {
  /**
   * The context this key is said in, for the cases where one English word is
   * two words in another language: `L("Edit", { context: "menu" })` is Правка,
   * `L("Edit")` is Изменить. The catalogue's key is `"menu|Edit"`, and a
   * language that does not need the distinction simply does not write that
   * entry — the lookup falls back to the plain key, and then to the English.
   */
  readonly context: string;
}

const isContext = (value: unknown): value is LContext =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { context?: unknown }).context === "string";

/**
 * The word for `key`, with anything the sentence has in it.
 *
 *     L("Drop files here")
 *     L("Close “%1$@”?", name)
 *     L("Edit", { context: "menu" })
 *     L("Merge %1$@ into %2$@", { context: "menu" }, piece, neighbour)
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#L
 */
export function L(key: string, ...args: readonly LMessageArgument[]): string;
export function L(key: string, context: LContext, ...args: readonly LMessageArgument[]): string;
export function L(key: string, ...rest: readonly (LContext | LMessageArgument)[]): string {
  const first = rest[0];
  const context = isContext(first) ? first.context : undefined;
  const args = (context === undefined ? rest : rest.slice(1)) as readonly LMessageArgument[];
  const word =
    context === undefined
      ? catalogueString(current, key)
      : (current.entries[`${context}|${key}`] ?? catalogueString(current, key));
  return formatMessage(word, args);
}

/**
 * Puts `args` into `format` at its positional placeholders.
 *
 * `%1$@` takes the first, `%2$@` the second, in whatever order the sentence
 * needs them and however many times each appears — a language that has to say
 * the file's name twice may. `%%` is a literal percent. A placeholder with no
 * argument behind it is left as written rather than swallowed: a visible
 * `%3$@` in a sentence is a translator's mistake that can be seen and fixed,
 * and a silently dropped one is not.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.format
 */
export function formatMessage(format: string, args: readonly LMessageArgument[]): string {
  if (args.length === 0) return format;
  const texts = args.map((argument) => String(argument));
  let result = "";
  let at = 0;
  for (;;) {
    const percent = format.indexOf("%", at);
    if (percent === -1) return result + format.slice(at);
    result += format.slice(at, percent);
    at = percent + 1;
    if (format[at] === "%") {
      result += "%";
      at += 1;
      continue;
    }
    const digits = /^\d+/.exec(format.slice(at))?.[0];
    if (digits === undefined || !format.startsWith("$@", at + digits.length)) {
      result += "%";
      continue;
    }
    const index = Number.parseInt(digits, 10);
    const text = texts[index - 1];
    if (text === undefined) {
      result += "%";
      continue;
    }
    result += text;
    at += digits.length + 2;
  }
}
