import { operationStore } from "@/state/operationStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";

/**
 * The status line's strip for a long operation: its name, a bar, and a (×)
 * that cancels it. Absent until the operation has outlasted the debounce.
 *
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.nameLabel
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.progressBar
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.cancelButton
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.onCancel
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.init
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.setUp
 * @upstream ByteRipperApp/Pane/OperationStatusView.swift#OperationStatusView.cancelPressed
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.operationView
 */
export function OperationStrip({ pane }: { readonly pane: PaneId }) {
  const shown = useStore(operationStore)[pane];
  if (shown === undefined || !shown.revealed) return null;
  return (
    // Off the readout's live region: a bar moving every percent is not news.
    <span className="operation-strip" aria-live="off">
      <span className="operation-strip-name">{shown.name}</span>
      <progress
        className="operation-strip-bar"
        max={1}
        value={shown.progress}
        aria-label={shown.name}
      />
      <button
        type="button"
        className="operation-strip-cancel"
        aria-label="Cancel operation"
        title="Cancel operation"
        onClick={() => shown.operation.cancel()}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path
            d="M2 2l6 6M8 2l-6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}
