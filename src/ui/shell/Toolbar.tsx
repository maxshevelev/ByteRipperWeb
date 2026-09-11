import { WORD_SIZES, type WordSize, wordSizeTitle } from "@/render/hexGrid/hexLayout";
import { useStore } from "@/state/useStore";
import { setWordSize, workspaceStore } from "@/state/workspaceStore";

/**
 * A web page has no menu bar (D12). The handful of commands worth a permanent
 * button live here; everything else will be reachable from the command palette.
 */
export function Toolbar({ onOpen }: { readonly onOpen: () => void }) {
  const state = useStore(workspaceStore);

  return (
    <header className="toolbar">
      <span className="toolbar-title">ByteRipper</span>
      <button type="button" className="toolbar-button" onClick={onOpen}>
        Open…
      </button>

      {state.paneA === undefined ? null : (
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
      )}

      <span className="toolbar-spacer" />
      <span className="toolbar-subtitle">{state.paneA?.name ?? "No file open"}</span>
    </header>
  );
}
