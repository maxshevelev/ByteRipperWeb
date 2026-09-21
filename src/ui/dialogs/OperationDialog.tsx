import { blockingOperationStore } from "@/state/operationStore";
import { useStore } from "@/state/useStore";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * A long operation that has to run to its end with the document left alone:
 * what is being done, how far it has got, and a Cancel.
 *
 * Modal, and that is the point rather than a side effect. The work this is for
 * — putting a part back through the rebuild planner — reads a document, works
 * for seconds and then writes into it, and a second change landing under the
 * first is a plan written over bytes that moved. Upstream presents a sheet on
 * that document's window for exactly this reason; `<dialog>`'s modal is the
 * same guarantee here, and it puts the progress in front of the reader rather
 * than on a status line a panel may be covering.
 *
 * It is driven by the `BackgroundOperation` itself: the phase follows `rename`,
 * the bar follows `report`, `finish` takes the dialog down, and Cancel — which
 * Escape is, as it is on the sheet — calls the operation's own cancellation,
 * whose owner stops the work and finishes the operation.
 *
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.loadView
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.cancelPressed
 */
export function OperationDialog() {
  const shown = useStore(blockingOperationStore);

  return (
    <Dialog
      open={shown !== undefined}
      title={shown?.title ?? ""}
      onClose={() => shown?.operation.cancel()}
    >
      <div className="dialog-body">
        {/* What it is doing now, under the title, as the sheet's phase label. */}
        <p className="dialog-message">{shown?.name ?? ""}</p>
        <progress
          className="dialog-progress"
          max={1}
          value={shown?.progress ?? 0}
          aria-label={shown?.name ?? ""}
        />
        <div className="dialog-actions">
          <button
            type="button"
            className="toolbar-button"
            onClick={() => shown?.operation.cancel()}
          >
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
