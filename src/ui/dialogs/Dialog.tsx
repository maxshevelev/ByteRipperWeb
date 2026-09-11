import { useEffect, useRef } from "react";

/**
 * A modal, on the browser's own `<dialog>`.
 *
 * `showModal()` brings the focus trap, the backdrop, Escape-to-dismiss and the
 * top layer with it — all of which a hand-rolled overlay gets subtly wrong, and
 * none of which is this application's subject.
 *
 * The one thing it does not bring is a reason to use it. `window.prompt` blocks
 * the whole page, cannot be styled, cannot validate as you type, and cannot
 * carry a "don't ask again" — which is precisely what an editor's dialogs need.
 */
export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      // Escape and the backdrop both close it, and both arrive as `cancel` or
      // `close` rather than as a click this component can see.
      onCancel={onClose}
      onClose={onClose}
    >
      <h2 className="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
