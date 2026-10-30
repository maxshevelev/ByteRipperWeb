/**
 * What every help popover does around its words: shows itself off the button
 * the reader pressed, closes when the reader is done with it, and lets go of
 * everything it held once it has closed.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController
 * @upstream-differs upstream's is an `NSPopover` off a view; here it is a
 * `<dialog>` positioned under the button that opened it — a browser has no
 * popover with an arrow, and the element that does have the platform's own
 * Escape is the one to use. Following the size needs nothing here: the words
 * are set by the stylesheet, which lays an open popover out again by itself
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * Closes the popover on a press anywhere outside it, from the next turn of the
 * event loop on — the press that opened it is still on its way up, and would
 * otherwise close it again at once. Returns what lets go of the listener, which
 * the popover calls when it closes: left listening, every popover a reader had
 * opened would still be answering presses after it had gone.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController.popoverDidClose
 * @upstream-differs what is let go of is the light dismiss's listener rather than
 * a Zoom observer and the controller: React drops the component itself
 */
export function holdHelpPopover(
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  isInside: (target: EventTarget | null) => boolean,
  onClose: () => void
): () => void {
  const dismiss = (event: Event) => {
    if (!isInside(event.target)) onClose();
  };
  const timer = setTimeout(() => events.addEventListener("pointerdown", dismiss), 0);
  return () => {
    clearTimeout(timer);
    events.removeEventListener("pointerdown", dismiss);
  };
}

export function HelpPopover({
  anchor,
  label,
  onClose,
  children,
}: {
  /** The button it hangs from, so it opens where the reader clicked. */
  readonly anchor: HTMLElement | null;
  /** What the popover is about, for a reader who cannot see it. */
  readonly label: string;
  /**
   * Closes the popover: the owner stops rendering it.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController.close
   */
  readonly onClose: () => void;
  /**
   * The popover's words, a `HelpPopoverLayout`.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController.makeContent
   */
  readonly children: ReactNode;
}) {
  const popover = useRef<HTMLDialogElement>(null);

  // Shown as a modeless dialog: the reader keeps the panel behind it, and the
  // browser's own Escape closes it. A modal would take the panel away, which
  // is the one thing a popover must not do.
  //
  // @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController.present
  useEffect(() => {
    const element = popover.current;
    if (element === null) return;
    const opened = !element.open;
    if (opened) element.show();
    if (anchor !== null) place(element, anchor);
    // A dialog that appears takes the focus of its first link on the way in,
    // and the browser scrolls the words to that link — their opening goes out.
    // The reader asked for the word they were on and wants to read it from the
    // top: the focus lands on the dialog itself, and the words start at theirs.
    if (opened) {
      element.focus({ preventScroll: true });
      element.querySelector(".help-popover-body")?.scrollTo(0, 0);
    }
    return holdHelpPopover(
      document,
      (target) =>
        target instanceof Node && (element.contains(target) || anchor?.contains(target) === true),
      onClose
    );
  }, [anchor, onClose]);

  return (
    <dialog
      ref={popover}
      className="help-popover"
      onCancel={onClose}
      // A dialog shown modelessly is sent no `cancel` for Escape (measured in
      // Chromium), so the key is taken here, and kept from the panel behind,
      // whose own Escape would fold it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      tabIndex={-1}
      aria-label={label}
    >
      {children}
    </dialog>
  );
}

/**
 * Under the button that opened it, and pulled back inside the box it stands in
 * when the button is near its right edge — a popover half off the panel is one
 * whose sentence cannot be read.
 *
 * The dialog stands in the box's own coordinates, which scroll with it: its
 * `top` is measured from the box's content, not from the part of the box that
 * is visible, so what has been scrolled out is added back in.
 */
function place(element: HTMLDialogElement, anchor: HTMLElement): void {
  const at = anchor.getBoundingClientRect();
  const parent = element.offsetParent?.getBoundingClientRect();
  const left = at.left - (parent?.left ?? 0) + (element.offsetParent?.scrollLeft ?? 0);
  const top = at.bottom - (parent?.top ?? 0) + (element.offsetParent?.scrollTop ?? 0) + 4;
  element.style.top = `${top}px`;
  // Pulled back so the box, as wide as it has ended up, still fits — the width
  // comes from the box itself, not from a number in here that a change to the
  // stylesheet would forget.
  element.style.left = `${Math.max(
    4,
    Math.min(left, (parent?.width ?? left) - element.offsetWidth - 8)
  )}px`;
  // The button is at the top of the box it stands in, so the room the dialog
  // may take is the room left below it, which the stylesheet takes into the
  // cap beside its own 80%. A dialog that reaches for more is one the browser
  // answers by scrolling the box down to the link it focuses on the way in —
  // the title out above, the way out under the box's bottom.
  const below = (parent?.height ?? 0) - (at.bottom - (parent?.top ?? 0)) - 8;
  if (below > 0) element.style.setProperty("--help-popover-room", `${below}px`);
}
