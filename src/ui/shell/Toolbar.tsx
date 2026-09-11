import { WORD_SIZES, type WordSize, wordSizeTitle } from "@/render/hexGrid/hexLayout";
import { diffStore } from "@/state/diffStore";
import { useStore } from "@/state/useStore";
import {
  GROUPING_GAP_CHOICES,
  type PaneId,
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
  onNavigate,
}: {
  readonly onOpen: (into?: PaneId) => void;
  readonly onNavigate: (what: "difference" | "same", direction: 1 | -1) => void;
}) {
  const state = useStore(workspaceStore);
  const diff = useStore(diffStore);

  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;
  const canNavigate = diff.status === "ready" && diff.hunks !== undefined;

  return (
    <header className="toolbar">
      <span className="toolbar-title">ByteRipper</span>

      <button type="button" className="toolbar-button" onClick={() => onOpen()}>
        Open…
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

      {state.panes.a === undefined ? null : (
        <>
          <span className="toolbar-divider" />
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
