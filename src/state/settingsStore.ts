import { DEFAULT_PLACEHOLDER } from "@/core/text/byteDecoder";
import { BYTE_DECODERS, DEFAULT_DECODER_IDENTIFIER } from "@/core/text/byteDecoderRegistry";
import { type KeyValueStore, openKeyValueStore } from "@/platform/storage/keyValueStore";
import { hexFontStack } from "@/render/hexGrid/fontMetrics";
import { WORD_SIZES, type WordSize } from "@/render/hexGrid/hexLayout";
import { createStore } from "@/state/store";

/**
 * The preferences, remembered between visits.
 *
 * Upstream reads each of these live from `UserDefaults` and posts a
 * notification when one changes. The browser's counterpart is an IndexedDB
 * store (ANALYSIS.md § Settings), which answers asynchronously — so the values
 * are read once, before the first frame, into a store the page subscribes to,
 * and every change is written back the moment it is made. A browser that will
 * not persist keeps them for the life of the page.
 *
 * The keys are upstream's own, so the two editions read alike. The settings a
 * pane draws with every frame — the word size, the layout, the grouping
 * distance, the shifting-edit warning — stay in the workspace store they were
 * already in, and only remember themselves through here.
 */

const DATABASE = "byteripper-settings";

let storage: KeyValueStore | undefined;
const values = (): KeyValueStore => {
  storage ??= openKeyValueStore(DATABASE);
  return storage;
};

/** Points the settings at another store: a test's memory one. */
export function setSettingsStorage(store: KeyValueStore): void {
  storage = store;
}

function remember(key: string, value: unknown): void {
  void values().put(key, value);
}

function forget(...keys: string[]): void {
  for (const key of keys) void values().remove(key);
}

// MARK: - Appearance

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontFamilyKey */
export const FONT_FAMILY_KEY = "HexFontFamily";
/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.rowHeightScaleKey */
export const ROW_HEIGHT_SCALE_KEY = "HexRowHeightScale";
/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontSizeKey */
export const FONT_SIZE_KEY = "HexFontSize";

/**
 * Stored as the family when the user wants the platform's own monospaced font
 * rather than a named one.
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.systemFontSentinel
 */
export const SYSTEM_FONT = "";

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.defaultRowHeightScale */
export const DEFAULT_ROW_HEIGHT_SCALE = 0.8;

/**
 * The span the Row Height slider offers. The lower bound keeps a row taller
 * than the glyph ink, so rows never visibly collide.
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.rowHeightScaleRange
 */
export const ROW_HEIGHT_SCALE_RANGE = { lower: 0.65, upper: 1 } as const;

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.defaultFontSize */
export const DEFAULT_FONT_SIZE = 13;

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontSizeRange */
export const FONT_SIZE_RANGE = { lower: 9, upper: 24 } as const;

/**
 * What one press of the Settings stepper moves the size by. There is no Zoom In
 * or Zoom Out: the browser's page zoom is the zoom (ANALYSIS.md).
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontSizeStep
 */
export const FONT_SIZE_STEP = 1;

// MARK: - Theme

/**
 * Follow the system, or force light or dark.
 *
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.system
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.light
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.dark
 */
export type AppTheme = "system" | "light" | "dark";

/** Every theme, in the order the popup lists them. */
export const APP_THEMES: readonly AppTheme[] = ["system", "light", "dark"];

/** @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.userDefaultsKey */
export const THEME_KEY = "AppTheme";

/** @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.title */
export function themeTitle(theme: AppTheme): string {
  switch (theme) {
    case "system":
      return "System";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}

/**
 * The appearance a theme forces — none for System, which leaves the page to
 * `prefers-color-scheme`.
 *
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.appearance
 * @upstream-differs the value of the root's data-theme attribute rather than an NSAppearance
 */
export function themeAppearance(theme: AppTheme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

// MARK: - Layout, comparison and editing

/** @upstream ByteRipperApp/Hex/WordSize.swift#WordSize.userDefaultsKey */
export const WORD_SIZE_KEY = "HexWordSize";

/** @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.layoutDirectionKey */
export const LAYOUT_DIRECTION_KEY = "ComparisonPaneLayoutIsVertical";

/** @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.groupingGapKey */
export const GROUPING_GAP_KEY = "DifferenceGroupingGap";

/**
 * How far apart differing bytes may sit and still count as one change. One,
 * two, four and sixteen hex rows, as upstream offers.
 *
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.groupingGapChoices
 */
export const GROUPING_GAP_CHOICES: readonly number[] = [16, 32, 64, 256];

/**
 * Four rows: close enough that a press moves to a change you were not already
 * looking at, without folding neighbouring changes into one.
 *
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.defaultGroupingGap
 */
export const DEFAULT_GROUPING_GAP = 64;

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.warnsBeforeShiftingEditsKey */
export const WARNS_BEFORE_SHIFTING_EDITS_KEY = "WarnsBeforeShiftingEdits";

// MARK: - Text decoding

/**
 * The table the text column decodes through, and the character it shows for a
 * byte that has none.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettings
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettings.identifier
 */
export interface TextDecodingSettings {
  readonly identifier: string;
  readonly placeholder: string;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettings.default */
export const DEFAULT_TEXT_DECODING: TextDecodingSettings = {
  identifier: DEFAULT_DECODER_IDENTIFIER,
  placeholder: DEFAULT_PLACEHOLDER,
};

/**
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.identifierKey
 */
export const DECODER_IDENTIFIER_KEY = "TextDecodingIdentifier";
/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.placeholderKey */
export const PLACEHOLDER_KEY = "TextDecodingPlaceholder";

// MARK: - Reading what was stored

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontFamily */
export function fontFamilyFrom(stored: unknown): string {
  return typeof stored === "string" ? stored : SYSTEM_FONT;
}

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.rowHeightScale */
export function rowHeightScaleFrom(stored: unknown): number {
  return typeof stored === "number" && stored > 0 ? stored : DEFAULT_ROW_HEIGHT_SCALE;
}

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.fontSize */
export function fontSizeFrom(stored: unknown): number {
  return typeof stored === "number" && stored > 0 ? stored : DEFAULT_FONT_SIZE;
}

/**
 * System is stored as the empty string, as upstream stores it, and anything
 * that is not a theme reads as System.
 *
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.current
 */
export function themeFrom(stored: unknown): AppTheme {
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** @upstream ByteRipperApp/Hex/WordSize.swift#WordSize.current */
export function wordSizeFrom(stored: unknown): WordSize {
  return WORD_SIZES.find((size) => size === stored) ?? 1;
}

/**
 * True is side by side, false stacked; side by side until chosen otherwise.
 *
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.isVertical
 */
export function layoutIsVerticalFrom(stored: unknown): boolean {
  return typeof stored === "boolean" ? stored : true;
}

/**
 * A value the popup no longer offers — an older build, a hand-edited store —
 * must not leave navigation grouping by something arbitrary.
 *
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.groupingGap
 */
export function groupingGapFrom(stored: unknown): number {
  return typeof stored === "number" && GROUPING_GAP_CHOICES.includes(stored)
    ? stored
    : DEFAULT_GROUPING_GAP;
}

/**
 * On until switched off — and "switched off" has to survive being read back,
 * rather than reading the same as never set.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.warnsBeforeShiftingEdits
 */
export function warnsBeforeShiftingEditsFrom(stored: unknown): boolean {
  return typeof stored === "boolean" ? stored : true;
}

/**
 * Each field falls back on its own: a table nobody knows does not discard a
 * perfectly good placeholder.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.settings
 * @upstream-differs a character is a code point here, where Swift counts grapheme clusters
 */
export function textDecodingFrom(identifier: unknown, placeholder: unknown): TextDecodingSettings {
  const known = BYTE_DECODERS.some((one) => one.identifier === identifier);
  return {
    identifier:
      known && typeof identifier === "string" ? identifier : DEFAULT_TEXT_DECODING.identifier,
    placeholder:
      typeof placeholder === "string" && [...placeholder].length === 1
        ? placeholder
        : DEFAULT_TEXT_DECODING.placeholder,
  };
}

// MARK: - The store

export interface SettingsState {
  readonly fontFamily: string;
  readonly rowHeightScale: number;
  readonly fontSize: number;
  readonly theme: AppTheme;
  readonly textDecoding: TextDecodingSettings;
}

export const DEFAULT_SETTINGS: SettingsState = {
  fontFamily: SYSTEM_FONT,
  rowHeightScale: DEFAULT_ROW_HEIGHT_SCALE,
  fontSize: DEFAULT_FONT_SIZE,
  theme: "system",
  textDecoding: DEFAULT_TEXT_DECODING,
};

/**
 * What the page draws with. Subscribing is how a view hears a change.
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.didChangeNotification
 * @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.didChangeNotification
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.didChangeNotification
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.userDefaults
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.init
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.layoutDirectionDidChangeNotification
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.didChangeNotification
 * @upstream-differs one store the views subscribe to, in place of a notification per setting
 */
export const settingsStore = createStore<SettingsState>(DEFAULT_SETTINGS);

/** The settings the workspace store holds, as they were remembered. */
export interface WorkspaceSettings {
  readonly wordSize: WordSize;
  readonly layoutIsVertical: boolean;
  readonly groupingGap: number;
  readonly warnsBeforeShiftingEdits: boolean;
}

/**
 * Reads every remembered preference: the page's own into this store, and the
 * workspace's back to the caller that holds them.
 */
export async function loadSettings(): Promise<WorkspaceSettings> {
  const store = values();
  const [
    fontFamily,
    rowHeightScale,
    fontSize,
    theme,
    identifier,
    placeholder,
    wordSize,
    layoutIsVertical,
    groupingGap,
    warns,
  ] = await Promise.all(
    [
      FONT_FAMILY_KEY,
      ROW_HEIGHT_SCALE_KEY,
      FONT_SIZE_KEY,
      THEME_KEY,
      DECODER_IDENTIFIER_KEY,
      PLACEHOLDER_KEY,
      WORD_SIZE_KEY,
      LAYOUT_DIRECTION_KEY,
      GROUPING_GAP_KEY,
      WARNS_BEFORE_SHIFTING_EDITS_KEY,
    ].map((key) => store.get<unknown>(key))
  );

  settingsStore.update(() => ({
    fontFamily: fontFamilyFrom(fontFamily),
    rowHeightScale: rowHeightScaleFrom(rowHeightScale),
    fontSize: fontSizeFrom(fontSize),
    theme: themeFrom(theme),
    textDecoding: textDecodingFrom(identifier, placeholder),
  }));
  applyAppearance(settingsStore.getSnapshot());
  applyTheme(settingsStore.getSnapshot().theme);

  return {
    wordSize: wordSizeFrom(wordSize),
    layoutIsVertical: layoutIsVerticalFrom(layoutIsVertical),
    groupingGap: groupingGapFrom(groupingGap),
    warnsBeforeShiftingEdits: warnsBeforeShiftingEditsFrom(warns),
  };
}

// MARK: - Appearance

/**
 * Hands the chrome the dump's font: the results list and the tool panels are
 * set in it, and follow its size the way the dump does.
 */
function applyAppearance(settings: SettingsState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  root.setProperty("--hex-font-size", `${settings.fontSize}px`);
  root.setProperty("--hex-font-family", hexFontStack(settings.fontFamily));
}

/**
 * Remembers the three appearance settings and re-lays out every open view.
 * The size defaults to the current one, so a caller changing only the family
 * or the row height leaves it where it was.
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.set
 */
export function setAppearance(
  fontFamily: string,
  rowHeightScale: number,
  fontSize = settingsStore.getSnapshot().fontSize
): void {
  remember(FONT_FAMILY_KEY, fontFamily);
  remember(ROW_HEIGHT_SCALE_KEY, rowHeightScale);
  remember(FONT_SIZE_KEY, fontSize);
  settingsStore.update((state) => ({ ...state, fontFamily, rowHeightScale, fontSize }));
  applyAppearance(settingsStore.getSnapshot());
}

/** @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.resetToDefaults */
export function resetAppearance(): void {
  forget(FONT_FAMILY_KEY, ROW_HEIGHT_SCALE_KEY, FONT_SIZE_KEY);
  settingsStore.update((state) => ({
    ...state,
    fontFamily: SYSTEM_FONT,
    rowHeightScale: DEFAULT_ROW_HEIGHT_SCALE,
    fontSize: DEFAULT_FONT_SIZE,
  }));
  applyAppearance(settingsStore.getSnapshot());
}

// MARK: - Theme

/**
 * Puts the chosen theme on the page. Every surface reads its colours from the
 * variables `theme.css` swaps on the attribute, so the whole app follows —
 * including the canvases, which watch the attribute and re-read their inks.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applyTheme
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.themeObserver
 * @upstream-differs a data-theme attribute on the root element, not NSApp.appearance
 */
export function applyTheme(theme: AppTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const appearance = themeAppearance(theme);
  if (appearance === undefined) delete root.dataset.theme;
  else root.dataset.theme = appearance;
}

/** @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.set */
export function setTheme(theme: AppTheme): void {
  remember(THEME_KEY, theme === "system" ? "" : theme);
  settingsStore.update((state) => ({ ...state, theme }));
  applyTheme(theme);
}

/** @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.resetToDefaults */
export function resetTheme(): void {
  forget(THEME_KEY);
  settingsStore.update((state) => ({ ...state, theme: "system" }));
  applyTheme("system");
}

// MARK: - Text decoding

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.apply */
export function setTextDecoding(textDecoding: TextDecodingSettings): void {
  remember(DECODER_IDENTIFIER_KEY, textDecoding.identifier);
  remember(PLACEHOLDER_KEY, textDecoding.placeholder);
  settingsStore.update((state) => ({ ...state, textDecoding }));
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.resetToDefaults */
export function resetTextDecoding(): void {
  forget(DECODER_IDENTIFIER_KEY, PLACEHOLDER_KEY);
  settingsStore.update((state) => ({ ...state, textDecoding: DEFAULT_TEXT_DECODING }));
}

// MARK: - What the workspace holds

/** @upstream ByteRipperApp/Hex/WordSize.swift#WordSize.set */
export function rememberWordSize(wordSize: WordSize): void {
  remember(WORD_SIZE_KEY, wordSize);
}

/** @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.set */
export function rememberLayoutIsVertical(isVertical: boolean): void {
  remember(LAYOUT_DIRECTION_KEY, isVertical);
}

/** @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.set */
export function rememberGroupingGap(groupingGap: number): void {
  remember(GROUPING_GAP_KEY, groupingGap);
}

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.set */
export function rememberWarnsBeforeShiftingEdits(warns: boolean): void {
  remember(WARNS_BEFORE_SHIFTING_EDITS_KEY, warns);
}

export function forgetGroupingGap(): void {
  forget(GROUPING_GAP_KEY);
}

export function forgetWarnsBeforeShiftingEdits(): void {
  forget(WARNS_BEFORE_SHIFTING_EDITS_KEY);
}
