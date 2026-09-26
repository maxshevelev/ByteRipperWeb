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
import { helpStore, showHelp } from "@/state/helpStore";
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
  const term = book === undefined ? undefined : helpTerm(book, id);

  // Shown as a modeless dialog: the reader keeps the panel behind it, and the
  // browser's own light dismiss and Escape close it. A modal would take the
  // tree away, which is the one thing a popover must not do.
  useEffect(() => {
    const element = popover.current;
    if (element === null || term === undefined) return;
    if (!element.open) element.show();
    // Under the button that opened it, and pulled back inside the panel when
    // the button is near its right edge — a popover half off the panel is one
    // whose sentence cannot be read.
    if (anchor !== null) {
      const at = anchor.getBoundingClientRect();
      const parent = element.offsetParent?.getBoundingClientRect();
      const left = at.left - (parent?.left ?? 0);
      element.style.top = `${at.bottom - (parent?.top ?? 0) + 4}px`;
      element.style.left = `${Math.max(4, Math.min(left, (parent?.width ?? left) - 300))}px`;
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
      aria-label={plainHelpName(term.name)}
    >
      <h4 className="help-popover-name">{plainHelpName(term.name)}</h4>
      <p className="help-popover-summary">{term.summary}</p>
      <div className="help-popover-body">
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
