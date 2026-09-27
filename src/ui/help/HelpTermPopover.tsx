/**
 * One term, explained where it is being read: a popover off the `?` beside a
 * panel's detail list.
 *
 * This is the affordance the firmware panels needed. A reader looking at a row
 * called `UTFL` has one question and wants one paragraph — not a book, not a
 * contents list, and not a trip away from the dump they were reading. So the
 * popover answers in place, and offers the panel only for a reader who wants
 * the rest.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpTermPopover.swift#HelpTermPopover
 * @upstream-differs upstream's is an `NSPopover` off a view; here it is a
 * `<dialog>` positioned under the button that opened it — a browser has no
 * popover with an arrow, and the element that does have the platform's own
 * light-dismiss and Escape is the one to use
 */

import { useEffect, useRef } from "react";
import { helpTerm } from "@/core/help/helpBook";
import type { HelpLink, HelpTermId } from "@/core/help/helpIds";
import { termLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { ensureHelpBook, helpStore, showHelp } from "@/state/helpStore";
import { useStore } from "@/state/useStore";
import { HelpBlocks } from "@/ui/help/HelpBlocks";
import { plainHelpName } from "@/ui/help/helpNames";

export function HelpTermPopover({
  term: id,
  anchor,
  onClose,
}: {
  readonly term: HelpTermId;
  /** The button it hangs from, so it opens where the reader clicked. */
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
}) {
  const { book } = useStore(helpStore);
  const popover = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const term = book === undefined ? undefined : helpTerm(book, id);

  // The book is not loaded at startup — it is loaded on the first ask, and a
  // reader pointing at a word they do not know is asking. Upstream's book is
  // always in hand when this is shown, because its load is synchronous; here
  // the ask starts the load, and the dialog appears the moment the book
  // lands: `term` stops being undefined, and the effect below runs again.
  useEffect(() => {
    if (book === undefined) void ensureHelpBook();
  }, [book]);

  // Shown as a modeless dialog: the reader keeps the panel behind it, and the
  // browser's own light dismiss and Escape close it. A modal would take the
  // tree away, which is the one thing a popover must not do.
  useEffect(() => {
    const element = popover.current;
    if (element === null || term === undefined) return;
    const opened = !element.open;
    if (opened) element.show();
    // Under the button that opened it, and pulled back inside the panel when
    // the button is near its right edge — a popover half off the panel is one
    // whose sentence cannot be read.
    //
    // The dialog stands in the detail's own coordinates, which scroll with it:
    // its `top` is measured from the box's content, not from the part of the
    // box that is visible, so what has been scrolled out is added back in.
    if (anchor !== null) {
      const at = anchor.getBoundingClientRect();
      const parent = element.offsetParent?.getBoundingClientRect();
      const left = at.left - (parent?.left ?? 0) + (element.offsetParent?.scrollLeft ?? 0);
      const top = at.bottom - (parent?.top ?? 0) + (element.offsetParent?.scrollTop ?? 0) + 4;
      element.style.top = `${top}px`;
      // Pulled back so the box, as wide as it has ended up, still fits the
      // panel — the width comes from the box itself, not from a number in
      // here that a change to the stylesheet would forget.
      element.style.left = `${Math.max(
        4,
        Math.min(left, (parent?.width ?? left) - element.offsetWidth - 8)
      )}px`;
      // The button is at the top of the box it stands in, so the room the
      // dialog may take is the room left below it, which the stylesheet takes
      // into the cap beside its own 80%. A dialog that reaches for more is one
      // the browser answers by scrolling the box down to the link it focuses
      // on the way in — the title out above, the way out under the box's
      // bottom.
      const below = (parent?.height ?? 0) - (at.bottom - (parent?.top ?? 0)) - 8;
      if (below > 0) element.style.setProperty("--help-popover-room", `${below}px`);
    }
    // A dialog that appears takes the focus of its first link on the way in,
    // and the browser scrolls the body to that link — the opening of the
    // article goes out. The reader asked for the word they were on and wants
    // to read it from the top: the focus lands on the dialog itself, and the
    // body starts where the article starts.
    if (opened) {
      element.focus({ preventScroll: true });
      body.current?.scrollTo(0, 0);
    }
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      if (anchor !== null && event.target instanceof Node && anchor.contains(event.target)) return;
      onClose();
    };
    // Deferred to the next frame: the click that opened this is still on its
    // way up, and would otherwise close it again at once.
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", dismiss), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [anchor, term, onClose]);

  if (term === undefined) return null;

  /**
   * Following a link inside a popover would be a second book inside a panel;
   * the reader is sent to the real one instead, where Back works.
   */
  const follow = (link: HelpLink) => {
    onClose();
    showHelp(link);
  };

  return (
    <dialog
      ref={popover}
      className="help-popover"
      onCancel={onClose}
      tabIndex={-1}
      aria-label={plainHelpName(term.name)}
    >
      <h4 className="help-popover-name">{plainHelpName(term.name)}</h4>
      {/* Only the title is pinned: the summary is the article's opening, and
          a pinned opening takes the room from the scroll it belongs to. */}
      <div className="help-popover-body" ref={body}>
        <p className="help-popover-summary">{term.summary}</p>
        <HelpBlocks blocks={term.blocks} onFollow={follow} />
      </div>
      <button
        type="button"
        className="toolbar-button help-popover-more"
        onClick={() => follow(termLink(id))}
      >
        {L("Open in Help")}
      </button>
    </dialog>
  );
}
