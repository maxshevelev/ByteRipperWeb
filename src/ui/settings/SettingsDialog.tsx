import { useEffect, useMemo, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import {
  APP_LANGUAGES,
  languageOwnName,
  resolveLanguage,
  storedLanguageChoice,
} from "@/core/localization/appLanguage";
import { L } from "@/core/localization/localization";
import type { ByteDecoder } from "@/core/text/byteDecoder";
import { BYTE_DECODERS } from "@/core/text/byteDecoderRegistry";
import { WORD_SIZES } from "@/render/hexGrid/hexLayout";
import {
  APP_THEMES,
  FONT_SIZE_RANGE,
  FONT_SIZE_STEP,
  GROUPING_GAP_CHOICES,
  groupingGapFrom,
  ROW_HEIGHT_SCALE_RANGE,
  resetTextDecoding,
  SYSTEM_FONT,
  setAppearance,
  setLanguage,
  setTextDecoding,
  setTheme,
  settingsStore,
  themeFrom,
  themeTitle,
  wordSizeFrom,
} from "@/state/settingsStore";
import { useStore } from "@/state/useStore";
import {
  decoderFor,
  setConfirmShiftingEdits,
  setGroupingGap,
  setLayout,
  setWordSize,
  workspaceStore,
} from "@/state/workspaceStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { HelpButton } from "@/ui/help/HelpButton";
import { FavoritesTab } from "@/ui/settings/FavoritesTab";
import { monospacedFontFamilies } from "@/ui/settings/fontFamilies";
import {
  formatFontSize,
  formatScale,
  groupingGapTitle,
  placeholderProblem,
  snapRowHeightScale,
  wordSizeChoiceTitle,
} from "@/ui/settings/settingsText";

export type SettingsTab =
  | "appearance"
  | "layout"
  | "comparison"
  | "editing"
  | "textDecoding"
  | "favorites"
  | "language";

/**
 * The tabs, in upstream's toolbar order. File Types sets which application
 * opens a file, which is the operating system's to decide rather than a web
 * page's.
 */
/**
 * The tabs, in upstream's toolbar order, built when the dialog is drawn.
 *
 * **A function, not a constant.** `L` at module scope is read once, when the
 * module loads, and would keep the language the page started in — which is the
 * one mistake `Design/LOCALIZATION.md` names by hand, and this tab strip is
 * where it was made.
 */
const tabs = (): readonly { readonly id: SettingsTab; readonly label: string }[] => [
  { id: "appearance", label: L("Appearance") },
  { id: "layout", label: L("Layout") },
  { id: "comparison", label: L("Comparison") },
  { id: "editing", label: L("Editing") },
  { id: "textDecoding", label: L("Text Decoding") },
  { id: "favorites", label: L("Favorites") },
  { id: "language", label: L("Language") },
];

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The tab to open on, when the opener names one — Manage Favorites… in the
   * find bar's menu lands on the list it promises.
   *
   * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.showFavorites
   */
  readonly tab?: SettingsTab | undefined;
}

/**
 * The Settings window: a tab per group, every change applied and remembered
 * the moment it is made, so there is nothing to confirm — Escape is simply
 * "done".
 *
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.appearanceController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.layoutController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.comparisonController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.editingController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.textDecodingController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.appearanceItemID
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.layoutItemID
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.comparisonItemID
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.editingItemID
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.textDecodingItemID
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.init
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.showWindow
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.toolbarAllowedItemIdentifiers
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.toolbarDefaultItemIdentifiers
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.toolbar
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.fitWindowToContent
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.selectTab
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.appearanceTabTapped
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.layoutTabTapped
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.comparisonTabTapped
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.editingTabTapped
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.textDecodingTabTapped
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindow
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindow.cancelOperation
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.favoritesController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#SettingsWindowController.favoritesTabTapped
 * @upstream-differs a <dialog> with a tab strip: Escape closes it natively, and it sizes to the tab it shows
 */
export function SettingsDialog({ open, onClose, tab: requested }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  useEffect(() => {
    if (open && requested !== undefined) setTab(requested);
  }, [open, requested]);

  return (
    <Dialog
      open={open}
      title={L("ByteRipper Settings")}
      onClose={onClose}
      className="settings-dialog"
      closeButton
    >
      <div className="settings-tabs" role="tablist" aria-label={L("Settings")}>
        {tabs().map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            className="settings-tab"
            aria-selected={tab === one.id}
            onClick={() => setTab(one.id)}
          >
            {one.label}
          </button>
        ))}
      </div>
      {/* Mounted only while open: the Appearance tab measures the machine's
          fonts, which is nothing to do at every page load. */}
      {open ? (
        <div className="settings-pane" role="tabpanel">
          {tab === "appearance" ? <AppearanceTab /> : null}
          {tab === "layout" ? <LayoutTab /> : null}
          {tab === "comparison" ? <ComparisonTab /> : null}
          {tab === "editing" ? <EditingTab /> : null}
          {tab === "textDecoding" ? <TextDecodingTab /> : null}
          {tab === "favorites" ? <FavoritesTab /> : null}
          {tab === "language" ? <LanguageTab /> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * The font and its size, the row pitch, and the theme. It follows the store
 * rather than only its own clicks, so a change made elsewhere is what it
 * shows.
 *
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.fontPopup
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.fontStepper
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.fontSizeValueLabel
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.scaleSlider
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.scaleValueLabel
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.themePopup
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.viewWillAppear
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.viewDidAppear
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.viewWillDisappear
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.appearanceObserver
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.syncControls
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.fontChanged
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.fontSizeChanged
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.themeChanged
 * @upstream-differs a React tab over the settings store; the stepper is two buttons beside the value
 */
// help: settings.appearance
function AppearanceTab() {
  const { fontFamily, fontSize, rowHeightScale, theme } = useStore(settingsStore);
  const families = useMemo(() => monospacedFontFamilies(), []);
  // A family chosen on another machine stays chosen, even where this one does
  // not have it to list.
  const listed =
    fontFamily === SYSTEM_FONT || families.includes(fontFamily)
      ? families
      : [...families, fontFamily].sort();
  const stepTo = (size: number) =>
    setAppearance(
      fontFamily,
      rowHeightScale,
      Math.min(FONT_SIZE_RANGE.upper, Math.max(FONT_SIZE_RANGE.lower, size))
    );

  return (
    <section>
      <h3 className="settings-heading">{L("Appearance")}</h3>
      <div className="settings-grid">
        <label htmlFor="settings-font">{L("Font:")}</label>
        <div className="settings-row">
          <select
            id="settings-font"
            className="settings-select"
            value={fontFamily}
            onChange={(event) => setAppearance(event.target.value, rowHeightScale)}
          >
            <option value={SYSTEM_FONT}>System</option>
            {listed.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          <span className="settings-stepper">
            <button
              type="button"
              aria-label={L("Larger")}
              disabled={fontSize >= FONT_SIZE_RANGE.upper}
              onClick={() => stepTo(fontSize + FONT_SIZE_STEP)}
            >
              ▴
            </button>
            <button
              type="button"
              aria-label={L("Smaller")}
              disabled={fontSize <= FONT_SIZE_RANGE.lower}
              onClick={() => stepTo(fontSize - FONT_SIZE_STEP)}
            >
              ▾
            </button>
          </span>
          <span className="settings-value">{formatFontSize(fontSize)}</span>
        </div>

        <label htmlFor="settings-row-height">{L("Row Height:")}</label>
        <div className="settings-row">
          <input
            id="settings-row-height"
            className="settings-slider"
            type="range"
            min={ROW_HEIGHT_SCALE_RANGE.lower}
            max={ROW_HEIGHT_SCALE_RANGE.upper}
            step={0.05}
            value={rowHeightScale}
            onChange={(event) =>
              setAppearance(fontFamily, snapRowHeightScale(Number(event.target.value)))
            }
          />
          <span className="settings-value">{formatScale(rowHeightScale)}</span>
        </div>

        <label htmlFor="settings-theme">{L("Theme:")}</label>
        <select
          id="settings-theme"
          className="settings-select"
          value={theme}
          onChange={(event) => setTheme(themeFrom(event.target.value))}
        >
          {APP_THEMES.map((one) => (
            <option key={one} value={one}>
              {themeTitle(one)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-caption">
        {L(
          "The hex dump's font and row pitch. A smaller Row Height packs more rows onto the screen. Theme applies to the whole app."
        )}
      </p>
    </section>
  );
}

/**
 * How the panes sit and how many bytes a hex word groups.
 *
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.layoutDirectionPopup
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.wordSizePopup
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.viewWillAppear
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.syncControls
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.layoutDirectionChanged
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettingsViewController.wordSizeChanged
 * @upstream-differs the direction applies to the panes already open, since a tab holds one comparison
 */
// help: settings.layout
function LayoutTab() {
  const { layout, wordSize } = useStore(workspaceStore);

  return (
    <section>
      <h3 className="settings-heading">{L("Layout")}</h3>
      <div className="settings-grid">
        <label htmlFor="settings-layout">{L("Layout Direction:")}</label>
        <select
          id="settings-layout"
          className="settings-select"
          value={layout}
          onChange={(event) =>
            setLayout(event.target.value === "stacked" ? "stacked" : "sideBySide")
          }
        >
          <option value="sideBySide">Left / Right</option>
          <option value="stacked">Top / Bottom</option>
        </select>

        <label htmlFor="settings-word-size">{L("Word Size:")}</label>
        <select
          id="settings-word-size"
          className="settings-select"
          value={wordSize}
          onChange={(event) => setWordSize(wordSizeFrom(Number(event.target.value)))}
        >
          {WORD_SIZES.map((size) => (
            <option key={size} value={size}>
              {wordSizeChoiceTitle(size)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-caption">
        {L("Both apply to the hex views already open, and are what the next visit opens with.")}
      </p>
    </section>
  );
}

/**
 * The distance difference navigation steps by.
 *
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.groupingPopup
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.viewWillAppear
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.syncControls
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.groupingChanged
 */
// help: settings.comparison
function ComparisonTab() {
  const { groupingGap } = useStore(workspaceStore);

  return (
    <section>
      <h3 className="settings-heading">{L("Comparison")}</h3>
      <div className="settings-grid">
        <label htmlFor="settings-grouping">{L("Group Differences Within:")}</label>
        <select
          id="settings-grouping"
          className="settings-select"
          value={groupingGap}
          onChange={(event) => setGroupingGap(groupingGapFrom(Number(event.target.value)))}
        >
          {GROUPING_GAP_CHOICES.map((gap) => (
            <option key={gap} value={gap}>
              {groupingGapTitle(gap)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-caption">
        {L(
          "Next / Previous Difference steps between changes, not bytes: differing bytes closer together than this belong to one change. A smaller value stops more often. Byte highlighting is always per byte."
        )}
      </p>
    </section>
  );
}

/**
 * Whether the edits that shift the file ask first — the same switch the
 * warning's own "Do not ask again" flips, which is why it reads the store.
 *
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.warnCheckbox
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.viewWillAppear
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.refresh
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.warnsBeforeShiftingEdits
 * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettingsViewController.warnChanged
 */
/**
 * Settings ▸ Language: the browser's own, or one of the three, each named in
 * itself — a reader hunting for their own language must not have to read
 * another one to find it.
 *
 * **No relaunch.** Upstream's tab offers one, because a Mac app reopens its
 * documents; a reload here would ask for every open dump again, so the words
 * change where they stand and the tab says so rather than offering a button
 * that would cost the reader their files (`Design/LOCALIZATION.md`).
 *
 * @upstream ByteRipperApp/Settings/LanguageSettings.swift#LanguageSettingsViewController
 * @upstream-differs no Relaunch Now, and the caption says why
 */
// help: settings.language
function LanguageTab() {
  const { language } = useStore(settingsStore);
  const follows = resolveLanguage(
    "system",
    typeof navigator === "undefined" ? [] : navigator.languages
  );

  return (
    <section>
      <h3 className="settings-heading">{L("Language")}</h3>
      <label className="settings-row">
        <span className="settings-label">{L("Language:")}</span>
        <select
          className="settings-select"
          value={language}
          onChange={(event) => void setLanguage(storedLanguageChoice(event.target.value))}
        >
          {/* Naming what it currently resolves to, so "the browser's own" is
              not a choice a reader has to guess the outcome of. */}
          <option value="system">
            {L("Same as the browser (%1$@)", languageOwnName(follows))}
          </option>
          {APP_LANGUAGES.map((one) => (
            <option key={one} value={one}>
              {languageOwnName(one)}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-caption">
        {L(
          "The words change at once — there is no relaunch, because reloading the page would ask you to open every dump again. The help is translated with the rest, and a page that has not been translated yet is shown in English rather than left blank."
        )}
      </p>
    </section>
  );
}

// help: settings.editing
function EditingTab() {
  const { confirmShiftingEdits } = useStore(workspaceStore);

  return (
    <section>
      {/* The only settings tab with a `?`, and upstream's reason holds: this is
          the one switch with consequences on a bench, turning off the dialogs
          that stand between a flash dump and a length-changing edit.
          @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.standard */}
      <h3 className="settings-heading">
        Editing
        <HelpButton link={topicLink(TOPIC.editing)} shape="inline" />
      </h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={confirmShiftingEdits}
          onChange={(event) => setConfirmShiftingEdits(event.target.checked)}
        />
        {L("Ask before edits that shift the file")}
      </label>
      <p className="settings-caption">
        {L(
          "Insert mode, Paste Insert and Delete Bytes move every byte after the edit, so they ask first. Turn this off to edit without the dialog — the edits stay undoable, and insert mode still shows INS in the pane's status line."
        )}
      </p>
    </section>
  );
}

/**
 * The decoding table and the placeholder, with every byte value decoded
 * beside them. A change applies at once; a placeholder that is not one
 * character says so and applies nothing.
 *
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.store
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.tablePopup
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.placeholderField
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.validationLabel
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.previewView
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.settingsObserver
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.viewWillAppear
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.viewDidLoad
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.deinit
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.syncControls
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.tableChanged
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.resetTapped
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.apply
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.showValidationError
 */
// help: settings.text-decoding
function TextDecodingTab() {
  const { textDecoding } = useStore(settingsStore);
  const [text, setText] = useState(textDecoding.placeholder);

  // The field is only overwritten while it does not hold one character: the
  // user in the middle of typing keeps what they typed.
  useEffect(() => {
    setText((current) =>
      placeholderProblem(current) === undefined ? current : textDecoding.placeholder
    );
  }, [textDecoding.placeholder]);

  const problem = placeholderProblem(text);

  return (
    <section className="settings-decoding">
      <div className="settings-decoding-controls">
        <h3 className="settings-heading">{L("Text Decoding")}</h3>
        <div className="settings-grid">
          <label htmlFor="settings-table">{L("Decoding table:")}</label>
          <select
            id="settings-table"
            className="settings-select"
            value={textDecoding.identifier}
            onChange={(event) =>
              setTextDecoding({
                identifier: event.target.value,
                placeholder: textDecoding.placeholder,
              })
            }
          >
            {BYTE_DECODERS.map((descriptor) => (
              <option key={descriptor.identifier} value={descriptor.identifier}>
                {descriptor.displayName}
              </option>
            ))}
          </select>

          <label htmlFor="settings-placeholder">{L("Placeholder character:")}</label>
          <div className="settings-row">
            <input
              id="settings-placeholder"
              className="settings-placeholder"
              value={text}
              placeholder="."
              spellCheck={false}
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                if (placeholderProblem(next) === undefined) {
                  setTextDecoding({ identifier: textDecoding.identifier, placeholder: next });
                }
              }}
            />
            {problem === undefined ? null : (
              <span className="settings-problem" role="alert">
                {problem}
              </span>
            )}
          </div>
        </div>
        <p className="settings-caption">
          {L(
            "All 256 byte values decoded with the current table. Row headers are the byte value in hex."
          )}
        </p>
        <button type="button" className="toolbar-button" onClick={resetTextDecoding}>
          Reset to Defaults
        </button>
      </div>
      <TextDecodingPreview decoder={decoderFor(textDecoding)} />
    </section>
  );
}

const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
const SIXTEEN = Array.from({ length: 16 }, (_, index) => index);

/**
 * All 256 byte values through the decoder, under the dump's own rules:
 * monospaced, the placeholder and the fill bytes dimmed, the row headers in
 * ink blue.
 *
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.decoder
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.font
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.charWidth
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.lineHeight
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.baseline
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.padding
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.headerInset
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.rowHeaderWidth
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.init
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.isFlipped
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.intrinsicContentSize
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.draw
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingPreviewView.hex2
 * @upstream-differs a grid of spans in CSS rather than glyphs drawn into a view
 */
function TextDecodingPreview({ decoder }: { readonly decoder: ByteDecoder }) {
  return (
    <div className="settings-preview" role="img" aria-label={L("Every byte value, decoded")}>
      {SIXTEEN.map((row) => (
        <div key={row} className="settings-preview-row">
          <span className="settings-preview-header">{hex2(row * 16)}</span>
          {SIXTEEN.map((column) => {
            const byte = row * 16 + column;
            const muted = !decoder.isDisplayable(byte) || byte === 0x00 || byte === 0xff;
            return (
              <span
                key={column}
                className={muted ? "settings-preview-cell is-muted" : "settings-preview-cell"}
              >
                {decoder.decode(byte)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
