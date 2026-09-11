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
  readonly confirmLabel?: string;
  /** Offers the "don't ask again" checkbox when given. */
  readonly rememberLabel?: string;
  readonly onConfirm: (remember: boolean) => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  rememberLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);

  return (
    <Dialog open={open} title={title} onClose={onCancel}>
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
          <button type="button" className="toolbar-button" onClick={onCancel}>
            Cancel
          </button>
          {/*
            Deliberately not autofocused. `<dialog>` puts the focus on the first
            focusable element, which is Cancel — the right place for a warning,
            since a Return pressed out of habit should not be the one that says
            yes.
          */}
          <button type="button" className="toolbar-button" onClick={() => onConfirm(remember)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
