import { useEffect, useRef } from "react";
import { CloseButton } from "@/ui/shell/CloseButton";

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
  /** @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.titleText */
  readonly title: string;
  /**
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.onCancel
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.handleCancel
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.cancelPressed
   */
  readonly onClose: () => void;
  /** @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.contentStack */
  readonly children: React.ReactNode;
  /** A dialog that needs more room than a question does — a list to pick from. */
  readonly className?: string | undefined;
  /**
   * A cross in the title row, for a dialog with no Cancel of its own because
   * there is nothing to cancel — every change it makes is already applied.
   */
  readonly closeButton?: boolean | undefined;
  /**
   * Asked before Escape closes the dialog; `false` keeps it open. For a form
   * with something inside it that Escape has to close first.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToFormView.escapeHandler
   */
  readonly onCancelRequest?: (() => boolean) | undefined;
}

/**
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController
 * @upstream-differs a <dialog> each form fills with its own fields
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  className,
  closeButton,
  onCancelRequest,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      // `showModal` puts the focus on the first focusable element, which in a
      // dialog closed by its cross is the cross — ringed, and one Return away
      // from closing it. The dialog takes the focus itself instead: the keyboard
      // is inside it, Escape and Tab work, and nothing is picked out.
      if (closeButton === true) element.focus();
    } else if (!open && element.open) element.close();
  }, [open, closeButton]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard's way out is Escape, which <dialog> handles itself
    <dialog
      ref={ref}
      className={className === undefined ? "dialog" : `dialog ${className}`}
      tabIndex={closeButton === true ? -1 : undefined}
      // Escape arrives as `cancel`, and a programmatic close as `close`. React
      // carries both up through the component tree, so a dialog opened from
      // inside this one — the resolver over Settings — would close this one
      // with it: only the element's own events are this dialog's.
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        if (onCancelRequest !== undefined && !onCancelRequest()) {
          event.preventDefault();
          return;
        }
        onClose();
      }}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // A tap outside closes every dialog, the way Escape does: it means the
      // same as Cancel. The backdrop belongs to the dialog element, so a click
      // on it reaches the element too — and so does a click in the gap a
      // child's margin leaves inside it. Only a point outside the box is outside.
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!inside) onClose();
      }}
    >
      {closeButton === true ? (
        <div className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <CloseButton label={`Close ${title}`} onClick={onClose} />
        </div>
      ) : (
        <h2 className="dialog-title">{title}</h2>
      )}
      {children}
    </dialog>
  );
}
