import { useEffect, useState } from "react";
import { L } from "@/core/localization/localization";
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
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.viewDidLoad
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.phaseLabel
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.cancelButton
 */
export function OperationDialog() {
  const shown = useStore(blockingOperationStore);
  // Cancel was pressed for this operation: the button is spent, and the phase says why nothing
  // moves until the owner has stopped.
  const [cancelling, setCancelling] = useState<unknown>(undefined);
  const operation = shown?.operation;
  useEffect(() => {
    if (operation === undefined) setCancelling(undefined);
  }, [operation]);
  const isCancelling = operation !== undefined && cancelling === operation;
  const cancel = () => {
    if (operation === undefined || isCancelling) return;
    setCancelling(operation);
    operation.cancel();
  };

  return (
    <Dialog open={shown !== undefined} title={shown?.title ?? ""} onClose={cancel}>
      <div className="dialog-body">
        {/* What it is doing now, under the title, as the sheet's phase label. */}
        <p className="dialog-message">{isCancelling ? L("Cancelling…") : (shown?.name ?? "")}</p>
        <progress
          className="dialog-progress"
          max={1}
          value={shown?.isIndeterminate === true ? undefined : (shown?.progress ?? 0)}
          aria-label={shown?.name ?? ""}
        />
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" disabled={isCancelling} onClick={cancel}>
            {L("Cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
