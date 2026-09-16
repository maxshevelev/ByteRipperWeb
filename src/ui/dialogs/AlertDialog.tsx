import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * A problem, told in the way upstream tells one: a title, a message, and a
 * button that says the reader has seen it.
 *
 * It is modal, and that is the point rather than a side effect. A message that
 * a file could not be opened belongs to the act that could not be completed —
 * it is not a line to be read later, beside whatever else the window is saying.
 * Upstream presents an `NSAlert` and waits; here `<dialog>` blocks the window
 * and holds the focus, so the next keystroke cannot go to a dump whose file
 * failed to open.
 *
 * One button, not two. There is nothing to cancel — the work has already
 * failed — and a pair of buttons on a message that reports a fact invents a
 * decision that nobody has.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentAlert
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentModal
 * @upstream-differs `alertStyle` has no CSS counterpart; every alert is the
 * same informational plate, where upstream draws a critical one for `presentError`
 */
export interface AlertDialogProps {
  readonly alert: { readonly title: string; readonly message: string } | undefined;
  readonly onDismiss: () => void;
}

export function AlertDialog({ alert, onDismiss }: AlertDialogProps) {
  return (
    <Dialog open={alert !== undefined} title={alert?.title ?? ""} onClose={onDismiss}>
      <div className="dialog-body">
        <p className="dialog-message">{alert?.message ?? ""}</p>
        <div className="dialog-actions">
          {/*
            The first focusable element in the dialog, so `<dialog>`'s own focus
            lands here: a Return pressed out of habit is the one that dismisses
            the alert, which is the only thing there is to do with it.
          */}
          <button type="button" className="toolbar-button" onClick={onDismiss}>
            OK
          </button>
        </div>
      </div>
    </Dialog>
  );
}
