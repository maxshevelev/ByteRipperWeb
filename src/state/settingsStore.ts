import { setCurrentUndoLimits, type UndoLimits } from "@/core/edit/undoJournal";
import {
  type LanguageChoice,
  resolveLanguage,
  storedLanguageChoice,
} from "@/core/localization/appLanguage";
import { loadCatalogue } from "@/core/localization/bundledCatalogues";
import { installCatalogue, L } from "@/core/localization/localization";
import { DEFAULT_PLACEHOLDER } from "@/core/text/byteDecoder";
import { BYTE_DECODERS, DEFAULT_DECODER_IDENTIFIER } from "@/core/text/byteDecoderRegistry";
import { inDesktopShell } from "@/platform/desktop/desktopFiles";
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
  written(values().put(key, value));
}

function forget(...keys: string[]): void {
  for (const key of keys) written(values().remove(key));
}

// MARK: - Other windows

/**
 * Where a change is announced to the app's other windows and the browser's other tabs of this
 * edition, which hold the settings in a store of their own and would otherwise draw with what
 * they read when they opened.
 *
 * @web-only upstream's notifications reach every window of the one process; here each
 * window is a page, so the change is announced and each page reads the settings again
 */
const CHANNEL = "byteripper-settings";
let channel: BroadcastChannel | undefined;
let writes: Promise<unknown>[] | undefined;

/**
 * Collects the writes one change makes and announces them once they have all landed, so a page
 * that hears of it reads what was written rather than what was there before.
 */
function written(write: Promise<unknown>): void {
  if (writes === undefined) {
    const batch: Promise<unknown>[] = [];
    writes = batch;
    queueMicrotask(() => {
      writes = undefined;
      void Promise.allSettled(batch).then(() => channel?.postMessage("changed"));
    });
  }
  writes.push(write);
}

const otherWindowListeners = new Set<(settings: WorkspaceSettings) => void>();

/**
 * Calls `listener` with the workspace's settings each time another window has changed a
 * setting — once this page's own store has been read again, and its theme, its font and its
 * language put in force.
 */
export function onSettingsFromOtherWindows(
  listener: (settings: WorkspaceSettings) => void
): () => void {
  listenToOtherWindows();
  otherWindowListeners.add(listener);
  return () => otherWindowListeners.delete(listener);
}

function listenToOtherWindows(): void {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  let reading = Promise.resolve();
  channel.onmessage = () => {
    // One reading at a time, in the order they were announced: the last one read is the last
    // one written.
    reading = reading.then(readAgain).catch(() => undefined);
  };
  (channel as { unref?: () => void }).unref?.();
}

async function readAgain(): Promise<void> {
  const language = settingsStore.getSnapshot().language;
  const stored = await loadSettings();
  await loadRestoresWorkspace();
  const now = settingsStore.getSnapshot().language;
  if (now !== language) await applyLanguage(now);
  for (const listener of otherWindowListeners) listener(stored);
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

/**
 * Where the language choice is kept — upstream's own defaults key, so a reader
 * who uses both editions on one bench finds the same name in both.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.choiceKey
 * @upstream-differs no defaults key: the choice is a field of this store, which owns its own persistence
 */
export const LANGUAGE_KEY = "AppLanguage";

/** @upstream ByteRipperApp/App/AppTheme.swift#AppTheme.title */
export function themeTitle(theme: AppTheme): string {
  switch (theme) {
    case "system":
      return L("System", { context: "theme" });
    case "light":
      return L("Light", { context: "theme" });
    case "dark":
      return L("Dark", { context: "theme" });
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

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoHistoryMiBKey */
export const UNDO_HISTORY_MIB_KEY = "UndoHistoryMiB";
/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoStepsKey */
export const UNDO_STEPS_KEY = "UndoSteps";

/**
 * What the size menu offers, in MiB. Large: dumps are large, and a replace of a 1 GB region keeps
 * 2 GB — its bytes before and after.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoHistoryChoicesMiB
 */
export const UNDO_HISTORY_CHOICES_MIB: readonly number[] = [512, 1024, 2048, 4096, 8192, 16384];
/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.defaultUndoHistoryMiB */
export const DEFAULT_UNDO_HISTORY_MIB = 4096;
/**
 * What the steps menu offers; 0 is no bound. A typed byte is one step, and in practice 10 000 is
 * already more than anyone reaches.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoStepChoices
 */
export const UNDO_STEP_CHOICES: readonly number[] = [1000, 10_000, 100_000, 0];
/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.defaultUndoSteps */
export const DEFAULT_UNDO_STEPS = 0;

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
 * The bytes of changes each document's history keeps, in MiB.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoHistoryMiB
 */
export function undoHistoryMiBFrom(stored: unknown): number {
  return typeof stored === "number" && UNDO_HISTORY_CHOICES_MIB.includes(stored)
    ? stored
    : DEFAULT_UNDO_HISTORY_MIB;
}

/**
 * The changes each document's history keeps; 0 is no bound.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoSteps
 */
export function undoStepsFrom(stored: unknown): number {
  return typeof stored === "number" && UNDO_STEP_CHOICES.includes(stored)
    ? stored
    : DEFAULT_UNDO_STEPS;
}

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoLimits */
export const undoLimitsOf = (
  settings: Pick<SettingsState, "undoHistoryMiB" | "undoSteps">
): UndoLimits => ({
  bytes: settings.undoHistoryMiB * 2 ** 20,
  transactions: settings.undoSteps === 0 ? undefined : settings.undoSteps,
});

/**
 * Each field falls back on its own: a table nobody knows does not discard a
 * perfectly good placeholder.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/TextDecodingSettings.swift#TextDecodingSettingsStore.settings
 * @upstream-differs a character is a code point here, where Swift counts grapheme clusters
 */
export function textDecodingFrom(identifier: unknown, placeholder: unknown): TextDecodingSettings {
  const known = BYTE_DECODERS().some((one) => one.identifier === identifier);
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
  /**
   * The language the app speaks, or the decision to follow the browser.
   *
   * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.choice
   */
  readonly language: LanguageChoice;
  readonly textDecoding: TextDecodingSettings;
  /**
   * Whether the workspace comes back when the page is opened again (`Design/WORKSPACE.md`). Off by
   * default: a hex editor that reopens last week's dumps unasked is a surprise on a repair bench,
   * where every job is a different board.
   *
   * @upstream ByteRipperApp/Settings/GeneralSettings.swift#WorkspaceSettings.restoresWorkspace
   */
  readonly restoresWorkspace: boolean;
  /** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoHistoryMiB */
  readonly undoHistoryMiB: number;
  /** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.undoSteps */
  readonly undoSteps: number;
}

export const DEFAULT_SETTINGS: SettingsState = {
  fontFamily: SYSTEM_FONT,
  rowHeightScale: DEFAULT_ROW_HEIGHT_SCALE,
  fontSize: DEFAULT_FONT_SIZE,
  theme: "system",
  language: "system",
  textDecoding: DEFAULT_TEXT_DECODING,
  restoresWorkspace: false,
  undoHistoryMiB: DEFAULT_UNDO_HISTORY_MIB,
  undoSteps: DEFAULT_UNDO_STEPS,
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
    language,
    identifier,
    placeholder,
    wordSize,
    layoutIsVertical,
    groupingGap,
    warns,
    undoHistoryMiB,
    undoSteps,
  ] = await Promise.all(
    [
      FONT_FAMILY_KEY,
      ROW_HEIGHT_SCALE_KEY,
      FONT_SIZE_KEY,
      THEME_KEY,
      LANGUAGE_KEY,
      DECODER_IDENTIFIER_KEY,
      PLACEHOLDER_KEY,
      WORD_SIZE_KEY,
      LAYOUT_DIRECTION_KEY,
      GROUPING_GAP_KEY,
      WARNS_BEFORE_SHIFTING_EDITS_KEY,
      UNDO_HISTORY_MIB_KEY,
      UNDO_STEPS_KEY,
    ].map((key) => store.get<unknown>(key))
  );

  settingsStore.update((state) => {
    const read: SettingsState = {
      restoresWorkspace: state.restoresWorkspace,
      fontFamily: fontFamilyFrom(fontFamily),
      rowHeightScale: rowHeightScaleFrom(rowHeightScale),
      fontSize: fontSizeFrom(fontSize),
      theme: themeFrom(theme),
      language: storedLanguageChoice(typeof language === "string" ? language : undefined),
      textDecoding: textDecodingFrom(identifier, placeholder),
      undoHistoryMiB: undoHistoryMiBFrom(undoHistoryMiB),
      undoSteps: undoStepsFrom(undoSteps),
    };
    // Read again for another window's change, what that change left alone is not redrawn.
    return JSON.stringify(read) === JSON.stringify(state) ? state : read;
  });
  applyAppearance(settingsStore.getSnapshot());
  applyTheme(settingsStore.getSnapshot().theme);
  // Every document's undo history keeps to the bounds the settings name, read at each edit.
  // @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.applyUndoLimits
  setCurrentUndoLimits(undoLimitsOf(settingsStore.getSnapshot()));

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

/**
 * Records the language and puts its words in force.
 *
 * Nothing is reloaded: upstream offers *Relaunch Now* because a Mac app reopens
 * its documents, and a reload here would ask for every open dump again
 * (`Design/LOCALIZATION.md`). So the catalogue is fetched, installed, and the
 * chrome rebuilt around it, with the workspace's own stores untouched.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.set
 */
export async function setLanguage(language: LanguageChoice): Promise<void> {
  if (settingsStore.getSnapshot().language === language) return;
  remember(LANGUAGE_KEY, language);
  settingsStore.update((state) => ({ ...state, language }));
  await applyLanguage(language);
}

/**
 * Loads the words for `choice` and puts them in force, announcing the change so
 * everything built from words is built again.
 *
 * @upstream Packages/Localization/Sources/Localization/Localization.swift#Localization.reload
 */
export async function applyLanguage(choice: LanguageChoice): Promise<void> {
  const language = resolveLanguage(
    choice,
    typeof navigator === "undefined" ? [] : navigator.languages
  );
  installCatalogue(await loadCatalogue(language));
  if (typeof document !== "undefined") document.documentElement.lang = language;
  languageStore.update((version) => version + 1);
}

/**
 * How many times the language has changed. A view reads it to be rebuilt when
 * it does — the one thing every view has in common being that its words were
 * read when it was built.
 *
 * @web-only upstream posts `Localization.didChange` and rebuilds the menu bar;
 * a React tree needs something it can subscribe to
 */
export const languageStore = createStore<number>(0);

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

// MARK: - The agent service

/**
 * Where the service's switch is kept: whether the endpoint an agent's client reaches the app on
 * is open. Off after an install.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.enabledKey
 */
export const AGENT_ENABLED_KEY = "AgentServiceEnabled";
/**
 * Where the edit switch is kept: whether an agent may change an open file. Off after an install,
 * and independent of the service's switch.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.editsKey
 */
export const AGENT_EDITS_KEY = "AgentEditsAllowed";

/**
 * Where the launch switch is kept: whether the configuration handed out lets the relay start the
 * app. Off until the person turns it on.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.launchesAppKey
 */
export const AGENT_LAUNCHES_APP_KEY = "AgentClientLaunchesApp";

/**
 * Where the bounds on the files an agent opened by path are kept: how many, and how many MiB
 * between them (`AgentBackgroundLimits`).
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundFilesKey
 */
export const AGENT_BACKGROUND_FILES_KEY = "AgentBackgroundFileLimit";
/** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundMemoryKey */
export const AGENT_BACKGROUND_MEMORY_KEY = "AgentBackgroundMemoryLimitMiB";

/** What the service's switches were left at; all off for a visit that remembers nothing. */
export async function loadAgentSettings(): Promise<{
  readonly enabled: boolean;
  readonly editsAllowed: boolean;
  readonly launchesApp: boolean;
  /** As kept, before it is brought inside the choices offered; nothing when none was. */
  readonly backgroundFiles: number | undefined;
  readonly backgroundMemoryMiB: number | undefined;
}> {
  const store = values();
  const [enabled, editsAllowed, launchesApp, backgroundFiles, backgroundMemoryMiB] =
    await Promise.all([
      store.get<boolean>(AGENT_ENABLED_KEY).catch(() => undefined),
      store.get<boolean>(AGENT_EDITS_KEY).catch(() => undefined),
      store.get<boolean>(AGENT_LAUNCHES_APP_KEY).catch(() => undefined),
      store.get<unknown>(AGENT_BACKGROUND_FILES_KEY).catch(() => undefined),
      store.get<unknown>(AGENT_BACKGROUND_MEMORY_KEY).catch(() => undefined),
    ]);
  const count = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) ? value : undefined;
  return {
    enabled: enabled === true,
    editsAllowed: editsAllowed === true,
    launchesApp: launchesApp === true,
    backgroundFiles: count(backgroundFiles),
    backgroundMemoryMiB: count(backgroundMemoryMiB),
  };
}

/** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundFileLimit */
export function rememberAgentBackgroundFiles(count: number): void {
  remember(AGENT_BACKGROUND_FILES_KEY, count);
}

/** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundMemoryLimitMiB */
export function rememberAgentBackgroundMemoryMiB(mib: number): void {
  remember(AGENT_BACKGROUND_MEMORY_KEY, mib);
}

export function rememberAgentEnabled(enabled: boolean): void {
  remember(AGENT_ENABLED_KEY, enabled);
}

export function rememberAgentEditsAllowed(allowed: boolean): void {
  remember(AGENT_EDITS_KEY, allowed);
}

/** @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.launchesApp */
export function rememberAgentLaunchesApp(launches: boolean): void {
  remember(AGENT_LAUNCHES_APP_KEY, launches);
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

/**
 * Remembers the undo history's bounds and hands them to every document's history, which reads
 * them at its next edit.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.set
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.applyUndoLimits
 */
export function setUndoLimits(
  bounds: Partial<Pick<SettingsState, "undoHistoryMiB" | "undoSteps">>
): void {
  if (bounds.undoHistoryMiB !== undefined) remember(UNDO_HISTORY_MIB_KEY, bounds.undoHistoryMiB);
  if (bounds.undoSteps !== undefined) remember(UNDO_STEPS_KEY, bounds.undoSteps);
  settingsStore.update((state) => ({ ...state, ...bounds }));
  setCurrentUndoLimits(undoLimitsOf(settingsStore.getSnapshot()));
}

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.resetToDefaults */
export function resetUndoLimits(): void {
  forget(UNDO_HISTORY_MIB_KEY, UNDO_STEPS_KEY);
  settingsStore.update((state) => ({
    ...state,
    undoHistoryMiB: DEFAULT_UNDO_HISTORY_MIB,
    undoSteps: DEFAULT_UNDO_STEPS,
  }));
  setCurrentUndoLimits(undoLimitsOf(settingsStore.getSnapshot()));
}

// MARK: - The workspace

/** @upstream ByteRipperApp/Settings/GeneralSettings.swift#WorkspaceSettings.restoresWorkspaceKey */
export const RESTORES_WORKSPACE_KEY = "RestoresWorkspaceOnLaunch";

/** Whether the switch was left on; off for a visit that remembers nothing. */
export async function loadRestoresWorkspace(): Promise<boolean> {
  // The workspace comes back in the desktop shell only (`inDesktopShell`).
  const on =
    inDesktopShell() &&
    (await values()
      .get<boolean>(RESTORES_WORKSPACE_KEY)
      .catch(() => undefined)) === true;
  settingsStore.update((state) =>
    state.restoresWorkspace === on ? state : { ...state, restoresWorkspace: on }
  );
  return on;
}

/** @upstream ByteRipperApp/Settings/GeneralSettings.swift#WorkspaceSettings.set */
export function setRestoresWorkspace(on: boolean): void {
  remember(RESTORES_WORKSPACE_KEY, on);
  settingsStore.update((state) => ({ ...state, restoresWorkspace: on }));
}
