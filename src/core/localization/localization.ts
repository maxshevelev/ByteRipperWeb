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

/** The catalogue the app speaks to the person, whatever `withEnglish` has in force over it. */
let installed: Catalogue = ENGLISH_CATALOGUE;

/**
 * Every catalogue this page has installed, by language: what a word asked for in a named language
 * is looked up in. A language the reader switched away from stays, so its words can still be asked
 * for.
 */
const known = new Map<AppLanguage, Catalogue>();

/**
 * Puts `catalogue` in force. The app calls this once it has loaded the words
 * for the language it resolved, and again when the reader changes it; a test
 * calls it with a catalogue of its own, which is why nothing here reads a file.
 */
export function installCatalogue(catalogue: Catalogue): void {
  current = catalogue;
  installed = catalogue;
  known.set(catalogue.language, catalogue);
}

/**
 * Forgets every catalogue but English and puts English in force: a test's clean slate, so the
 * languages one test installed are not what the next one finds.
 *
 * @web-only module state a test resets; upstream's catalogues are bundle resources
 */
export function forgetCatalogues(): void {
  known.clear();
  installCatalogue(ENGLISH_CATALOGUE);
}

/**
 * The catalogue of `language` as far as this page has it: English is the keys,
 * and a language this page has not installed comes out as the keys too —
 * correct English, never a blank. Every caller asks for the app's language or
 * English, which are always here.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.catalogue
 * @upstream-differs upstream loads any language's catalogue on demand and
 * synchronously; here a catalogue arrives over a promise, and only the ones the
 * app has spoken are held
 */
export const catalogueFor = (language: AppLanguage): Catalogue =>
  language === FALLBACK_LANGUAGE
    ? ENGLISH_CATALOGUE
    : (known.get(language) ?? { language, entries: {} });

/**
 * Runs `work` with English in force, whatever the app speaks, and puts the catalogue back.
 *
 * For the agent service: a tool answers a model with the same field names the panel shows a person,
 * and the model reads them in English — the parsers', the specifications' and the upstream tools'
 * language — while the window beside it goes on speaking Russian. Only for work that does not
 * wait: a catalogue swapped across an `await` would be in force for whatever ran in between, so an
 * asynchronous tool wraps the synchronous stretches that build words.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.override
 * @upstream-differs a scope over synchronous work, where upstream's is a task-local value that
 * follows an `await`
 */
export function withEnglish<T>(work: () => T): T {
  const held = current;
  current = ENGLISH_CATALOGUE;
  try {
    return work();
  } finally {
    current = held;
  }
}

/** The language in force here: the scope's override, else the app's. */
export const currentLanguage = (): AppLanguage => current.language;

/**
 * The language the app speaks to the person, whatever a scope overrides.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.appLanguage
 */
export const appLanguage = (): AppLanguage => installed.language;

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
 * The word for `key` in `language`, whatever the app or the scope is speaking —
 * for a sentence meant for one reader in particular: an agent answered in
 * English while the window speaks Russian, or the undo step an agent's change
 * leaves in the person's Edit menu, in the person's language.
 *
 *     LIn("Update from %1$@", appLanguage(), name)
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#L
 */
export const LIn = (
  key: string,
  language: AppLanguage,
  ...args: readonly LMessageArgument[]
): string => formatMessage(catalogueString(catalogueFor(language), key), args);

/**
 * A sentence kept as its key and what goes into it, not yet in any language:
 * put into words by whoever shows it, in that reader's language. A maker writes
 * the same English literal it would have given `L`, and the catalogue checks see it there.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.key
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.context
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.arguments
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.isVerbatim
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.verbatim
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.text
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#LocalizedText.description
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.texts
 */
export class LocalizedText {
  readonly key: string;
  readonly context: string | undefined;
  readonly args: readonly string[];
  readonly isVerbatim: boolean;

  private constructor(
    key: string,
    context: string | undefined,
    args: readonly string[],
    isVerbatim: boolean
  ) {
    this.key = key;
    this.context = context;
    this.args = args;
    this.isVerbatim = isVerbatim;
  }

  /** A sentence for `key`, with what goes into it. */
  static of(key: string, ...rest: readonly (LContext | LMessageArgument)[]): LocalizedText {
    const first = rest[0];
    const context = isContext(first) ? first.context : undefined;
    const args = (context === undefined ? rest : rest.slice(1)) as readonly LMessageArgument[];
    return new LocalizedText(key, context, args.map(String), false);
  }

  /** Words that have no key — a parser's own English. */
  static verbatim(text: string): LocalizedText {
    return new LocalizedText(text, undefined, [], true);
  }

  /** The sentence in `language`. */
  textIn(language: AppLanguage): string {
    if (this.isVerbatim) return this.key;
    const catalogue = catalogueFor(language);
    const word =
      (this.context === undefined ? undefined : catalogue.entries[`${this.context}|${this.key}`]) ??
      catalogueString(catalogue, this.key);
    return formatMessage(word, this.args);
  }

  /** The sentence in the language in force where it is asked for. */
  get text(): string {
    return this.textIn(currentLanguage());
  }

  toString(): string {
    return this.text;
  }
}

/**
 * A table of words that follows the language.
 *
 * A module-level constant built out of `L` calls is written once, in whatever
 * language was in force when its module was imported — which is English, since
 * the catalogue is installed after the imports have run, and it stays English
 * when the reader changes the language, because nothing rebuilds it. This keeps
 * such a table's shape and re-derives it the first time it is read under a
 * different catalogue, so the cost is one build per language rather than one
 * per lookup.
 *
 * Upstream has no counterpart: a Swift global is built on first use and its app
 * takes a restart to change language, so a table there is never stale.
 *
 * @web-only the language changes under a running page, so a table of words has
 * to be able to change with it
 */
export function localized<T>(build: () => T): () => T {
  let made: { readonly catalogue: Catalogue; readonly value: T } | undefined;
  return () => {
    if (made === undefined || made.catalogue !== current) {
      made = { catalogue: current, value: build() };
    }
    return made.value;
  };
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
