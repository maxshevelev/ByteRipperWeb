/**
 * What every help popover does around its words: shows itself off the button
 * the reader pressed, closes when the reader is done with it, and lets go of
 * everything it held once it has closed.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController
 * @upstream-differs upstream's is an `NSPopover` off a view; here it is a
 * popover in the browser's top layer, placed under the button that opened it —
 * a browser has no popover with an arrow. Following the size needs nothing
 * here: the words are set by the stylesheet, which lays an open popover out
 * again by itself
 */

import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

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
  const popover = useRef<HTMLDivElement>(null);

  // Shown in the browser's top layer, as an NSPopover is a window of its own over everything:
  // nothing it opens inside — a panel's scroller, the microcode form, which is modal — cuts it
  // off at its own edges. Modeless: the reader keeps what is behind it.
  //
  // @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverController.swift#HelpPopoverController.present
  useLayoutEffect(() => {
    const element = popover.current;
    if (element === null) return;
    if (typeof element.showPopover === "function" && !element.matches(":popover-open")) {
      element.showPopover();
      // The reader asked for the word they were on and wants to read it from the top: the
      // focus lands on the popover itself, and the words start at theirs.
      element.focus({ preventScroll: true });
      element.querySelector(".help-popover-body")?.scrollTo(0, 0);
    }
    const follow = () => {
      if (anchor !== null) place(element, anchor);
    };
    follow();
    // It stands in the window's coordinates, so it follows its button when what holds the
    // button scrolls or the window changes size.
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    const release = holdHelpPopover(
      document,
      (target) =>
        target instanceof Node && (element.contains(target) || anchor?.contains(target) === true),
      onClose
    );
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      release();
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={popover}
      role="dialog"
      popover="manual"
      className="help-popover"
      // Escape is taken here, and kept from the panel behind, whose own Escape would fold it.
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
    </div>
  );
}

/** The gap kept between the popover and the window's edges. */
const EDGE = 8;

/**
 * Under the button that opened it — or over it, where the window has more room above the
 * button than under it and the words do not fit under — and pulled back inside the window
 * when the button is near its right edge: a popover half off the window is one whose
 * sentence cannot be read. The room it is given is the room on its side of the button, which
 * the stylesheet takes into the cap beside its own 80%.
 */
function place(element: HTMLElement, anchor: HTMLElement): void {
  const at = anchor.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const below = height - at.bottom - 4 - EDGE;
  const above = at.top - 4 - EDGE;
  // As tall as its words ask, held only by the stylesheet's own cap: the height it wants.
  element.style.removeProperty("--help-popover-room");
  const wanted = element.offsetHeight;
  const up = wanted > below && above > below;
  element.style.setProperty("--help-popover-room", `${Math.max(0, up ? above : below)}px`);
  const tall = element.offsetHeight;
  element.style.top = `${up ? at.top - 4 - tall : at.bottom + 4}px`;
  // The width comes from the box itself, not from a number in here that a change to the
  // stylesheet would forget.
  element.style.left = `${Math.max(EDGE, Math.min(at.left, width - element.offsetWidth - EDGE))}px`;
}
