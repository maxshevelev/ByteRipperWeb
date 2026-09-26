/**
 * A language the app ships, or the decision to follow the browser.
 *
 * Three codes and no `Intl.Locale`: what the app has is a small closed set of
 * translations, and a language it has not been translated into is not a choice
 * a reader can usefully make. The code is also the directory the words are
 * read from, so a language and its files cannot drift apart.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#AppLanguage
 */
export type AppLanguage = "en" | "ru" | "de";

/**
 * Every language the app ships, in the order a list offers them.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#AppLanguage.allCases
 */
export const APP_LANGUAGES: readonly AppLanguage[] = ["en", "ru", "de"];

/**
 * The language everything falls back to, word by word: every key exists in it,
 * because the key *is* the English text.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#AppLanguage.fallback
 */
export const FALLBACK_LANGUAGE: AppLanguage = "en";

/**
 * What the language is called **in itself** — a list of languages that names
 * them in the language the reader is currently *not* reading is a list they
 * have to translate before they can use it.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#AppLanguage.ownName
 */
export function languageOwnName(language: AppLanguage): string {
  switch (language) {
    case "en":
      return "English";
    case "ru":
      return "Русский";
    case "de":
      return "Deutsch";
  }
}

/** Whether `code` is one of the three, so an unknown string cannot become one. */
export const isAppLanguage = (code: string): code is AppLanguage =>
  (APP_LANGUAGES as readonly string[]).includes(code);

/**
 * What the reader chose in Settings: a language, or the browser's own.
 *
 * `"system"` is a choice, not the absence of one — it means "follow the
 * browser", and it keeps following it when the browser's language changes. A
 * bench whose browser is German and whose tools are English is a real
 * arrangement, and so is the reverse, which is why the override exists at all.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#LanguageChoice
 * @upstream-differs upstream's is an enum with a payload and a `storedValue`
 * that spells it; here the choice *is* that spelling, the two raw forms not
 * colliding, so what is written down and what is held are one value
 */
export type LanguageChoice = "system" | AppLanguage;

/**
 * The choice as it comes back from wherever it was written down. Anything else
 * that turns up there is "follow the browser", which is the state a reader who
 * has never chosen is in.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#LanguageChoice.init
 */
export function storedLanguageChoice(stored: string | undefined | null): LanguageChoice {
  if (stored === undefined || stored === null) return "system";
  return isAppLanguage(stored) ? stored : "system";
}

/**
 * The language this choice comes out as, given what the browser reads.
 *
 * The browser's list is asked in order, and a regional name matches the plain
 * language behind it: `de-AT` is German, because the region says nothing about
 * which of three translations to show. A browser set to a language the app does
 * not have falls back to English rather than to its own next choice.
 *
 * @upstream Packages/Localization/Sources/Localization/AppLanguage.swift#LanguageChoice.resolve
 */
export function resolveLanguage(choice: LanguageChoice, preferred: readonly string[]): AppLanguage {
  if (choice !== "system") return choice;
  for (const wanted of preferred) {
    if (isAppLanguage(wanted)) return wanted;
    const plain = wanted.split(/[-_]/, 1)[0] ?? "";
    if (isAppLanguage(plain)) return plain;
  }
  return FALLBACK_LANGUAGE;
}
