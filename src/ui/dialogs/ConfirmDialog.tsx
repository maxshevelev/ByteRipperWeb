import { useEffect, useState } from "react";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * A confirmation that can be told not to come back.
 *
 * `window.confirm` cannot carry a "don't ask again", which is the whole reason
 * this exists: an editor that asks the same question on every insert-mode
 * keystroke session teaches people to dismiss it without reading, and the one
 * time it matters they will dismiss that too.
 */
export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string | undefined;
  /**
   * Marks the confirming button as the one that does the damage — what upstream
   * sets on the three shifting-edit alerts' first button
   * (`hasDestructiveAction`).
   */
  readonly destructive?: boolean | undefined;
  /** Offers the "don't ask again" checkbox when given. */
  readonly rememberLabel?: string | undefined;
  /**
   * A third answer, between confirming and cancelling: what an `NSAlert` gets
   * by adding a button, and the shape a question with two ways forward needs —
   * closing a part that has bytes to put back is "put them back", "close
   * anyway" and "not yet".
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmClosingUnreturnedPart
   */
  readonly otherLabel?: string | undefined;
  readonly onOther?: (() => void) | undefined;
  readonly onConfirm: (remember: boolean) => void;
  /**
   * The answer when the question is declined — by Cancel, by Escape, or by a
   * click outside the box.
   *
   * The checkbox comes with it because upstream reads it after *any* response
   * (`applySuppression`, which runs whichever button dismissed the alert):
   * ticking "Do not ask again" and then cancelling still means "stop asking me",
   * and a port that only read the box on the confirming path would ask again.
   */
  readonly onCancel: (remember: boolean) => void;
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmAlert
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentModal
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.modalResponder
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.applySuppression
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  destructive = false,
  rememberLabel,
  otherLabel,
  onOther,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);

  return (
    <Dialog open={open} title={title} onClose={() => onCancel(remember)}>
      <div className="dialog-body">
        <p className="dialog-message">{message}</p>
        {rememberLabel === undefined ? null : (
          <label className="dialog-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            {rememberLabel}
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={() => onCancel(remember)}>
            Cancel
          </button>
          {otherLabel === undefined || onOther === undefined ? null : (
            <button type="button" className="toolbar-button" onClick={onOther}>
              {otherLabel}
            </button>
          )}
          {/*
            Deliberately not autofocused. `<dialog>` puts the focus on the first
            focusable element, which is Cancel — the right place for a warning,
            since a Return pressed out of habit should not be the one that says
            yes.
          */}
          <button
            type="button"
            className={destructive ? "toolbar-button is-destructive" : "toolbar-button"}
            onClick={() => onConfirm(remember)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
