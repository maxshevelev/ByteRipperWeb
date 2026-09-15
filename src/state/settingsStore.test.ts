import { beforeEach, describe, expect, it } from "vitest";
import { type KeyValueStore, memoryKeyValueStore } from "@/platform/storage/keyValueStore";
import {
  APP_THEMES,
  DECODER_IDENTIFIER_KEY,
  DEFAULT_FONT_SIZE,
  DEFAULT_GROUPING_GAP,
  DEFAULT_ROW_HEIGHT_SCALE,
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_DECODING,
  FONT_FAMILY_KEY,
  FONT_SIZE_KEY,
  fontSizeFrom,
  GROUPING_GAP_CHOICES,
  GROUPING_GAP_KEY,
  groupingGapFrom,
  LAYOUT_DIRECTION_KEY,
  layoutIsVerticalFrom,
  loadSettings,
  PLACEHOLDER_KEY,
  ROW_HEIGHT_SCALE_KEY,
  resetAppearance,
  resetTextDecoding,
  resetTheme,
  rowHeightScaleFrom,
  setAppearance,
  setSettingsStorage,
  setTextDecoding,
  setTheme,
  settingsStore,
  THEME_KEY,
  textDecodingFrom,
  themeAppearance,
  themeFrom,
  themeTitle,
  WARNS_BEFORE_SHIFTING_EDITS_KEY,
  WORD_SIZE_KEY,
  warnsBeforeShiftingEditsFrom,
  wordSizeFrom,
} from "@/state/settingsStore";
import {
  resetComparisonSettings,
  resetEditingSettings,
  restoreSettings,
  setConfirmShiftingEdits,
  setGroupingGap,
  setLayout,
  setWordSize,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The remembered preferences — upstream's `AppThemeTests`,
 * `ComparisonSettingsTests` and `EditingSettingsTests` where they are about the
 * stored value, and `TextDecoderTests`' store cases. What they assert about
 * windows and menus is the app flow's.
 */

let storage: KeyValueStore;

beforeEach(() => {
  storage = memoryKeyValueStore();
  setSettingsStorage(storage);
  resetAppearance();
  resetTheme();
  resetTextDecoding();
  resetComparisonSettings();
  resetEditingSettings();
});

/** Counts the changes a store announces from here on. */
function changes(store: { subscribe(listener: () => void): () => void }) {
  let count = 0;
  const stop = store.subscribe(() => {
    count++;
  });
  return {
    get count() {
      return count;
    },
    stop,
  };
}

const appearance = () => settingsStore.getSnapshot();

describe("the appearance", () => {
  it("reads nothing stored as the built-in defaults", () => {
    expect(fontSizeFrom(undefined)).toBe(DEFAULT_FONT_SIZE);
    expect(fontSizeFrom(0)).toBe(DEFAULT_FONT_SIZE);
    expect(rowHeightScaleFrom(undefined)).toBe(DEFAULT_ROW_HEIGHT_SCALE);
    expect(rowHeightScaleFrom("tall")).toBe(DEFAULT_ROW_HEIGHT_SCALE);
  });

  it("comes back as it was set on the next visit", async () => {
    setAppearance("Menlo", 0.7, 16);
    settingsStore.update(() => DEFAULT_SETTINGS);

    await loadSettings();

    expect(appearance()).toMatchObject({ fontFamily: "Menlo", rowHeightScale: 0.7, fontSize: 16 });
  });
});

describe("the theme", () => {
  // @upstream ByteRipperTests/AppThemeTests.swift#AppThemeTests.testThemeDefaultsToSystem
  it("follows the system until chosen", () => {
    expect(appearance().theme).toBe("system");
  });

  // @upstream ByteRipperTests/AppThemeTests.swift#AppThemeTests.testSetPersistsAndNotifies
  it("remembers a choice and announces it", async () => {
    const heard = changes(settingsStore);

    setTheme("dark");

    expect(appearance().theme).toBe("dark");
    expect(await storage.get(THEME_KEY)).toBe("dark");
    expect(heard.count).toBe(1);
    heard.stop();
  });

  // @upstream ByteRipperTests/AppThemeTests.swift#AppThemeTests.testResetRestoresSystem
  it("goes back to the system's on a reset", () => {
    setTheme("light");
    resetTheme();
    expect(appearance().theme).toBe("system");
  });

  // System forces nothing; the other two force different appearances.
  // @upstream ByteRipperTests/AppThemeTests.swift#AppThemeTests.testAppearanceMapping
  it("forces an appearance only when it is not the system's", () => {
    expect(themeAppearance("system")).toBeUndefined();
    expect(themeAppearance("light")).toBe("light");
    expect(themeAppearance("dark")).toBe("dark");
  });

  // @upstream ByteRipperTests/AppThemeTests.swift#AppThemeTests.testTitles
  it("is titled as the popup lists it", () => {
    expect(APP_THEMES.map(themeTitle)).toEqual(["System", "Light", "Dark"]);
  });

  it("stores the system's as nothing, and reads anything else as the system's", async () => {
    setTheme("system");
    expect(await storage.get(THEME_KEY)).toBe("");
    expect(themeFrom("")).toBe("system");
    expect(themeFrom("sepia")).toBe("system");
  });
});

describe("the comparison's grouping distance", () => {
  // @upstream ByteRipperTests/ComparisonSettingsTests.swift#ComparisonSettingsTests.testDefaultsToFourRows
  it("is four rows until chosen", () => {
    expect(workspaceStore.getSnapshot().groupingGap).toBe(64);
    expect(DEFAULT_GROUPING_GAP).toBe(64);
    expect(GROUPING_GAP_CHOICES).toEqual([16, 32, 64, 256]);
  });

  // @upstream ByteRipperTests/ComparisonSettingsTests.swift#ComparisonSettingsTests.testSetPersistsAndNotifies
  it("remembers a choice and announces it", async () => {
    const heard = changes(workspaceStore);

    setGroupingGap(32);

    expect(workspaceStore.getSnapshot().groupingGap).toBe(32);
    expect(await storage.get(GROUPING_GAP_KEY)).toBe(32);
    expect(heard.count).toBe(1);
    heard.stop();
  });

  // @upstream ByteRipperTests/ComparisonSettingsTests.swift#ComparisonSettingsTests.testAnUnrecognisedStoredValueFallsBackToTheDefault
  it("reads a distance it does not offer as the default", () => {
    expect(groupingGapFrom(7)).toBe(DEFAULT_GROUPING_GAP);
    expect(groupingGapFrom("64")).toBe(DEFAULT_GROUPING_GAP);
  });

  // @upstream ByteRipperTests/ComparisonSettingsTests.swift#ComparisonSettingsTests.testResetRestoresTheDefault
  it("goes back to the default on a reset", async () => {
    setGroupingGap(256);
    resetComparisonSettings();
    expect(workspaceStore.getSnapshot().groupingGap).toBe(DEFAULT_GROUPING_GAP);
    expect(await storage.get(GROUPING_GAP_KEY)).toBeUndefined();
  });
});

describe("the shifting-edit warning", () => {
  // On for a fresh start, and off has to survive being read back rather than
  // reading the same as never set.
  // @upstream ByteRipperTests/EditingSettingsTests.swift#EditingSettingsTests.testWarningsAreOnUntilSwitchedOff
  it("is on until switched off", async () => {
    expect(warnsBeforeShiftingEditsFrom(await storage.get(WARNS_BEFORE_SHIFTING_EDITS_KEY))).toBe(
      true
    );

    setConfirmShiftingEdits(false);
    expect(warnsBeforeShiftingEditsFrom(await storage.get(WARNS_BEFORE_SHIFTING_EDITS_KEY))).toBe(
      false
    );

    setConfirmShiftingEdits(true);
    expect(warnsBeforeShiftingEditsFrom(await storage.get(WARNS_BEFORE_SHIFTING_EDITS_KEY))).toBe(
      true
    );
  });
});

describe("the layout and the word size", () => {
  it("read nothing stored as side by side, one byte", () => {
    expect(layoutIsVerticalFrom(undefined)).toBe(true);
    expect(wordSizeFrom(undefined)).toBe(1);
    expect(wordSizeFrom(3)).toBe(1);
    expect(wordSizeFrom(8)).toBe(8);
  });

  it("come back into the workspace on the next visit", async () => {
    setLayout("stacked");
    setWordSize(4);
    setGroupingGap(256);
    setConfirmShiftingEdits(false);
    expect(await storage.get(LAYOUT_DIRECTION_KEY)).toBe(false);
    expect(await storage.get(WORD_SIZE_KEY)).toBe(4);
    workspaceStore.update((state) => ({
      ...state,
      layout: "sideBySide",
      wordSize: 1,
      groupingGap: DEFAULT_GROUPING_GAP,
      confirmShiftingEdits: true,
    }));

    await restoreSettings();

    expect(workspaceStore.getSnapshot()).toMatchObject({
      layout: "stacked",
      wordSize: 4,
      groupingGap: 256,
      confirmShiftingEdits: false,
    });
  });
});

describe("the text decoding", () => {
  // A fresh read of the same store sees what was applied.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testStorePersistsAndRestores
  it("is remembered and restored", async () => {
    expect(appearance().textDecoding).toEqual(DEFAULT_TEXT_DECODING);

    setTextDecoding({ identifier: "isoLatin1", placeholder: "·" });
    expect(appearance().textDecoding).toEqual({ identifier: "isoLatin1", placeholder: "·" });

    settingsStore.update(() => DEFAULT_SETTINGS);
    await loadSettings();
    expect(appearance().textDecoding).toEqual({ identifier: "isoLatin1", placeholder: "·" });
  });

  // Each field falls back on its own.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testStoreFallsBackOnUnusableValues
  it("falls back on values it cannot use, field by field", async () => {
    expect(textDecodingFrom("bogus-table", "??")).toEqual(DEFAULT_TEXT_DECODING);
    expect(textDecodingFrom("", "")).toEqual(DEFAULT_TEXT_DECODING);
    expect(textDecodingFrom("bogus-table", "·")).toEqual({
      identifier: DEFAULT_TEXT_DECODING.identifier,
      placeholder: "·",
    });

    await storage.put(DECODER_IDENTIFIER_KEY, "bogus-table");
    await storage.put(PLACEHOLDER_KEY, "·");
    await loadSettings();
    expect(appearance().textDecoding).toEqual({
      identifier: DEFAULT_TEXT_DECODING.identifier,
      placeholder: "·",
    });
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testStoreResetToDefaults
  it("goes back to the defaults on a reset", () => {
    setTextDecoding({ identifier: "strictASCII", placeholder: "×" });
    resetTextDecoding();
    expect(appearance().textDecoding).toEqual(DEFAULT_TEXT_DECODING);
  });
});

describe("the appearance, set and reset", () => {
  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testSetPersistsAndNotifies
  it("remembers a family and a row height, and announces them once", async () => {
    const heard = changes(settingsStore);

    setAppearance("Menlo", 0.9);

    expect(appearance().fontFamily).toBe("Menlo");
    expect(appearance().rowHeightScale).toBe(0.9);
    expect(await storage.get(FONT_FAMILY_KEY)).toBe("Menlo");
    expect(await storage.get(ROW_HEIGHT_SCALE_KEY)).toBe(0.9);
    expect(heard.count).toBe(1);
    heard.stop();
  });

  // Written out rather than read back from the constants under test: with the
  // default on both sides, a default of 3 would pass and triple every row.
  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testResetRestoresDefaults
  it("goes back to the built-in font, pitch and size on a reset", () => {
    setAppearance("Menlo", 0.7, 20);

    resetAppearance();

    expect(appearance().fontFamily).toBe("");
    expect(appearance().rowHeightScale).toBeCloseTo(0.8);
    expect(appearance().fontSize).toBe(13);
  });

  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testFontSizeDefaultsTo13
  it("is 13 points until chosen", () => {
    expect(appearance().fontSize).toBe(13);
  });

  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testSetFontSizePersistsAndNotifies
  it("remembers a size and announces it once", async () => {
    const heard = changes(settingsStore);

    setAppearance(appearance().fontFamily, appearance().rowHeightScale, 18);

    expect(appearance().fontSize).toBe(18);
    expect(await storage.get(FONT_SIZE_KEY)).toBe(18);
    expect(heard.count).toBe(1);
    heard.stop();
  });

  // The size the pane measures its font at is the setting's. A caller with a
  // size of its own passes it to the measurement, as upstream's does to font().
  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testFontFollowsConfiguredSize
  // @upstream-differs the pane's measurement is a canvas's, so what is checked here is the size it is handed
  it("is the size the dump is drawn at", () => {
    setAppearance(appearance().fontFamily, appearance().rowHeightScale, 20);
    expect(appearance().fontSize).toBe(20);
  });
});
