import { saveVerb } from "@/platform/files/capabilities";
import { WORD_SIZES, type WordSize, wordSizeTitle } from "@/render/hexGrid/hexLayout";
import { diffStore } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { useStore } from "@/state/useStore";
import {
  DEFAULT_FONT_SIZE_PX,
  GROUPING_GAP_CHOICES,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  type PaneId,
  setFontSize,
  setGroupingGap,
  setLayout,
  setWordSize,
  swapPanes,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * A web page has no menu bar (D12). The handful of commands worth a permanent
 * button live here; everything else will be reachable from the command palette.
 */
export function Toolbar({
  onOpen,
  onNew,
  onNavigate,
  onSave,
  onSaveAs,
  onRevert,
  onFill,
  onDeleteBytes,
  onGoTo,
}: {
  readonly onOpen: (into?: PaneId) => void;
  readonly onNew: () => void;
  readonly onNavigate: (what: "difference" | "same", direction: 1 | -1) => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  readonly onRevert: () => void;
  readonly onFill: () => void;
  readonly onDeleteBytes: () => void;
  readonly onGoTo: () => void;
}) {
  const state = useStore(workspaceStore);
  const diff = useStore(diffStore);
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
  const active = state.panes[state.activePane];
  // The verb follows the pane, not only the browser: a file opened without a
  // handle is downloaded however capable the browser is.
  const verb = saveVerb(state.capabilities, active?.file.handle !== undefined);

  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;
  const canNavigate = diff.status === "ready" && diff.hunks !== undefined;

  return (
    <header className="toolbar">
      <span className="toolbar-title">ByteRipper</span>

      <button type="button" className="toolbar-button" onClick={() => onOpen()}>
        Open…
      </button>
      <button type="button" className="toolbar-button" onClick={onNew}>
        New
      </button>
      {state.panes.a !== undefined && state.panes.b === undefined ? (
        <button type="button" className="toolbar-button" onClick={() => onOpen("b")}>
          Compare with…
        </button>
      ) : null}

      {bothOpen ? (
        <>
          <span className="toolbar-divider" />
          {/*
            A fieldset rather than a div with role="group": these four buttons
            are one control with four directions, and a screen reader should
            hear them that way.
          */}
          <fieldset className="toolbar-group">
            <legend className="visually-hidden">Difference navigation</legend>
            <button
              type="button"
              className="toolbar-button"
              disabled={!canNavigate}
              onClick={() => onNavigate("difference", -1)}
              title="Previous difference"
            >
              ◀ Diff
            </button>
            <button
              type="button"
              className="toolbar-button"
              disabled={!canNavigate}
              onClick={() => onNavigate("difference", 1)}
              title="Next difference"
            >
              Diff ▶
            </button>
            <button
              type="button"
              className="toolbar-button"
              disabled={!canNavigate}
              onClick={() => onNavigate("same", -1)}
              title="Previous matching block"
            >
              ◀ Same
            </button>
            <button
              type="button"
              className="toolbar-button"
              disabled={!canNavigate}
              onClick={() => onNavigate("same", 1)}
              title="Next matching block"
            >
              Same ▶
            </button>
          </fieldset>
          <button type="button" className="toolbar-button" onClick={swapPanes} title="Swap A and B">
            Swap
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => setLayout(state.layout === "sideBySide" ? "stacked" : "sideBySide")}
          >
            {state.layout === "sideBySide" ? "Stacked" : "Side by side"}
          </button>
        </>
      ) : null}

      {active === undefined ? null : (
        <>
          <span className="toolbar-divider" />
          {/*
            The button says what will actually happen. In a browser that cannot
            write back to a file, "Save" would be a lie — it downloads a copy,
            and the file on disk is untouched.
          */}
          <button
            type="button"
            className="toolbar-button"
            onClick={onSave}
            disabled={!active.document.isDirty && verb === "Save"}
            title={verb === "Save" ? "Write the edits back to the file" : "Download a copy"}
          >
            {verb}
          </button>
          <button type="button" className="toolbar-button" onClick={onSaveAs}>
            {verb === "Save" ? "Save As…" : "Download As…"}
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={onRevert}
            disabled={!active.document.isDirty}
            title="Throw away every unsaved edit"
          >
            Revert
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="toolbar-button" onClick={onGoTo} title="Go to position">
            Go To…
          </button>
          <button type="button" className="toolbar-button" onClick={onFill}>
            Fill…
          </button>
          <button type="button" className="toolbar-button" onClick={onDeleteBytes}>
            Delete Bytes
          </button>
          {/*
            Our own zoom steps the hex font only. It deliberately does not use
            Cmd/Ctrl +/− : the browser owns those for page zoom, which the user
            also wants, and a page this app fought over would be worse than no
            zoom at all.
          */}
          <div className="toolbar-group">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setFontSize(state.fontSizePx - 1)}
              disabled={state.fontSizePx <= MIN_FONT_SIZE_PX}
              title="Smaller hex font"
              aria-label="Smaller hex font"
            >
              A−
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setFontSize(DEFAULT_FONT_SIZE_PX)}
              title={`Reset the hex font to ${DEFAULT_FONT_SIZE_PX}px`}
            >
              {state.fontSizePx}px
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setFontSize(state.fontSizePx + 1)}
              disabled={state.fontSizePx >= MAX_FONT_SIZE_PX}
              title="Larger hex font"
              aria-label="Larger hex font"
            >
              A+
            </button>
          </div>

          <label className="toolbar-field">
            Word size
            <select
              value={state.wordSize}
              onChange={(event) => setWordSize(Number(event.target.value) as WordSize)}
            >
              {WORD_SIZES.map((size) => (
                <option key={size} value={size}>
                  {wordSizeTitle(size)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {bothOpen ? (
        <label
          className="toolbar-field"
          title="How far apart differences may sit and still count as one change"
        >
          Grouping
          <select
            value={state.groupingGap}
            onChange={(event) => setGroupingGap(Number(event.target.value))}
          >
            {GROUPING_GAP_CHOICES.map((gap) => (
              <option key={gap} value={gap}>
                {gap} bytes
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <span className="toolbar-spacer" />
    </header>
  );
}
