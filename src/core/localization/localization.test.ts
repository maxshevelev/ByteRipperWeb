/**
 * Ported from `LocalizationTests.swift`: which language the app comes out
 * speaking, what a word comes out as, and what happens when nobody has
 * translated it.
 *
 * The catalogues are installed by the tests themselves — nothing here reads a
 * file or asks the browser what language it is in, so the suite says the same
 * thing in Frankfurt as in Moscow.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  APP_LANGUAGES,
  type LanguageChoice,
  languageOwnName,
  resolveLanguage,
  storedLanguageChoice,
} from "@/core/localization/appLanguage";
import {
  currentLanguage,
  ENGLISH_CATALOGUE,
  formatMessage,
  installCatalogue,
  L,
} from "@/core/localization/localization";
import { parseStringsFile } from "@/core/localization/stringsFile";

afterEach(() => installCatalogue(ENGLISH_CATALOGUE));

describe("which language the app comes out speaking", () => {
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testAFixedChoiceIgnoresTheMac
  it("ignores the browser when the reader has chosen", () => {
    expect(resolveLanguage("de", ["ru", "en"])).toBe("de");
  });

  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testFollowingTheMacTakesItsFirstLanguageTheAppHas
  it("takes the browser's first language the app has", () => {
    expect(resolveLanguage("system", ["ru-RU", "en"])).toBe("ru");
    expect(resolveLanguage("system", ["fr", "de"])).toBe("de");
  });

  /** A region says nothing about which of three translations to show. */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testARegionMatchesThePlainLanguage
  it("matches a regional name to the plain language behind it", () => {
    expect(resolveLanguage("system", ["de-AT"])).toBe("de");
    expect(resolveLanguage("system", ["ru_RU"])).toBe("ru");
  });

  /**
   * A browser reading a language the app does not have gets English, not the
   * app's guess at the nearest thing.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testAnUnknownLanguageFallsBackToEnglish
  it("falls back to English for a language it does not ship", () => {
    expect(resolveLanguage("system", ["ja", "ko"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });

  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testTheChoiceSurvivesBeingWrittenDown
  it("reads back every choice that was written down", () => {
    const choices: LanguageChoice[] = ["system", ...APP_LANGUAGES];
    for (const choice of choices) expect(storedLanguageChoice(choice)).toBe(choice);
    // Anything else that turns up in the settings is "follow the browser",
    // which is the state a reader who has never chosen is in.
    expect(storedLanguageChoice(undefined)).toBe("system");
    expect(storedLanguageChoice("klingon")).toBe("system");
  });

  /**
   * A list of languages names each one in itself: a reader looking for their
   * own language must not have to read another one to find it.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#LanguageChoiceTests.testEachLanguageNamesItselfInItself
  it("names each language in itself", () => {
    expect(languageOwnName("ru")).toBe("Русский");
    expect(languageOwnName("de")).toBe("Deutsch");
    expect(languageOwnName("en")).toBe("English");
  });
});

describe("the catalogue", () => {
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testAKeyWithATranslationIsTranslated
  it("says the translation when there is one", () => {
    installCatalogue({ language: "ru", entries: { "Drop files here": "Перетащите файлы сюда" } });
    expect(L("Drop files here")).toBe("Перетащите файлы сюда");
    installCatalogue({ language: "de", entries: { "Drop files here": "Dateien hierher ziehen" } });
    expect(L("Drop files here")).toBe("Dateien hierher ziehen");
  });

  /**
   * The whole reason the key is the English text: an untranslated string reads
   * as correct English rather than as a key.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testAnUntranslatedKeyReadsAsItself
  it("says the key itself when nobody has translated it", () => {
    installCatalogue({ language: "ru", entries: {} });
    expect(L("A sentence nobody has translated")).toBe("A sentence nobody has translated");
  });

  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testEnglishIsTheKeysThemselves
  it("is the keys themselves in English", () => {
    expect(L("Drop files here")).toBe("Drop files here");
    expect(currentLanguage()).toBe("en");
  });

  /**
   * One English word is two words elsewhere, and without the context the two
   * uses fight over one entry.
   */
  // @upstream Packages/Localization/Sources/Localization/Localization.swift#L
  it("takes the context's entry, and falls back to the plain key without one", () => {
    installCatalogue({
      language: "ru",
      entries: { "menu|Edit": "Правка", Edit: "Изменить", Save: "Сохранить" },
    });
    expect(L("Edit", { context: "menu" })).toBe("Правка");
    expect(L("Edit")).toBe("Изменить");
    // A language that does not need the distinction writes no such entry.
    expect(L("Save", { context: "menu" })).toBe("Сохранить");
    expect(L("Close", { context: "menu" })).toBe("Close");
  });

  it("fills a context's sentence from the arguments after it", () => {
    installCatalogue({ language: "ru", entries: { "menu|Merge %1$@": "Объединить %1$@" } });
    expect(L("Merge %1$@", { context: "menu" }, "chip.bin")).toBe("Объединить chip.bin");
  });
});

describe("the placeholders a sentence is poured into", () => {
  /**
   * A translation must be free to reorder what is put into it, which is what
   * the positional placeholders are for.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testArgumentsCanBeReorderedByATranslation
  it("lets a translation reorder them", () => {
    expect(formatMessage("%1$@ into %2$@", ["S1", "S0"])).toBe("S1 into S0");
    expect(formatMessage("%2$@ enthält %1$@", ["S1", "S0"])).toBe("S0 enthält S1");
  });

  /**
   * Whatever a call site used to interpolate, it can still pass: a count, an
   * offset, a name. Interpolation is what this replaces, so it behaves the way
   * interpolation did.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testAnyArgumentIsPutInTheWayInterpolationWouldHave
  it("puts an argument in the way interpolation would have", () => {
    expect(formatMessage("%1$@ bytes", [4096])).toBe("4096 bytes");
    expect(formatMessage("at %1$@", ["0x1000"])).toBe("at 0x1000");
  });

  /** A language may need to say the same thing twice, and may need none of it. */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testAPlaceholderMayRepeatOrBeLeftOut
  it("repeats one, and leaves out what the sentence does not want", () => {
    expect(formatMessage("%1$@ and %1$@", ["it"])).toBe("it and it");
    expect(formatMessage("nothing here", ["unused"])).toBe("nothing here");
  });

  /**
   * A placeholder with no argument behind it stays visible. A translator's
   * mistake that can be seen is one that gets fixed; a silently swallowed one
   * is a sentence missing a word in one language only.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testAPlaceholderWithNoArgumentIsLeftAsWritten
  it("leaves a placeholder with no argument as written", () => {
    expect(formatMessage("%1$@ then %3$@", ["a", "b"])).toBe("a then %3$@");
  });

  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testADoubledPercentIsALiteralOne
  it("reads a doubled percent as a literal one", () => {
    expect(formatMessage("100%% of %1$@", ["it"])).toBe("100% of it");
  });
});

describe("the .strings file", () => {
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testTheStringsFormatIsRead
  it("is read, comments and escapes and all", () => {
    const parsed = parseStringsFile(`
      /* a comment */
      "one" = "eins";
      // and the other kind
      "two \\"quoted\\"" = "zwei";
      "three" = "drei\\nmit einer Zeile";
    `);
    expect(parsed.one).toBe("eins");
    expect(parsed['two "quoted"']).toBe("zwei");
    expect(parsed.three).toBe("drei\nmit einer Zeile");
  });

  /**
   * A file that will not parse is reported as empty rather than as half a
   * language.
   */
  // @upstream Packages/Localization/Tests/LocalizationTests/LocalizationTests.swift#CatalogueTests.testABrokenFileIsEmpty
  it("is empty when it will not parse", () => {
    expect(parseStringsFile('"one" = ')).toEqual({});
    expect(parseStringsFile('"one" = "eins"')).toEqual({});
    expect(parseStringsFile('"one" = "eins"; "two" = "zwei')).toEqual({});
    expect(parseStringsFile('/* nobody closed this "one" = "eins";')).toEqual({});
  });

  it("is empty when there is nothing in it", () => {
    expect(parseStringsFile("")).toEqual({});
    expect(parseStringsFile("/* only a comment */")).toEqual({});
  });
});
