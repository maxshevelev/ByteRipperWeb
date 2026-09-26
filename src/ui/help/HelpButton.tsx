/**
 * The question mark in a circle that opens the help at the page about what it
 * stands beside.
 *
 * Two shapes, as upstream has two, because the app has two kinds of place to
 * put one:
 *
 * - `standard` belongs at the foot of a form or a dialog — the platform's own
 *   round help button upstream, and here a circle of the same size and weight
 *   as the buttons beside it.
 * - `inline` is a quiet glyph for a panel's own chrome, where a bezelled round
 *   button would not fit and would read as one somebody forgot to style.
 *
 * Both carry their destination, so a caller wires nothing: the button knows its
 * page and opens it.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton
 * @upstream-differs upstream takes AppKit's `.helpButton` bezel for the round
 * one, which a browser has no equivalent of; both shapes are drawn here, and
 * the glyph is the same circle the dock's help pill wears
 */

import { helpTerm, helpTopic } from "@/core/help/helpBook";
import type { HelpLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { helpStore, showHelp } from "@/state/helpStore";
import { useStore } from "@/state/useStore";
import { helpNameOf } from "@/ui/help/helpNames";

export interface HelpButtonProps {
  /** Where this `?` goes. */
  readonly link: HelpLink;
  /**
   * `standard` for a form, `inline` for a panel's chrome.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.standard
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.inline
   */
  readonly shape?: "standard" | "inline";
  /** A label of the caller's own, where the page's title is not what to say. */
  readonly label?: string;
  /**
   * What the click does, where it is not "open the book at that page" — the
   * one caller being a firmware panel's detail list, whose `?` answers in
   * place with a popover rather than sending the reader away from the tree
   * they are reading (`HelpTermPopover`).
   *
   * The button still knows its destination, so what it says it opens and what
   * the popover shows cannot drift apart.
   */
  readonly onOpen?: () => void;
}

/**
 * A `?` that opens `link`.
 *
 * It draws nothing while the book has no such page. A button that opens an
 * empty page is worse than no button — and since the book is not read until
 * somebody asks for help, a `?` whose page is only *probably* there would be a
 * button that disappears once the book arrives. So the rule is the other way
 * round: the button is drawn until the book says the page is missing, which it
 * can only do once it is here.
 */
export function HelpButton({ link, shape = "standard", label, onOpen }: HelpButtonProps) {
  const { book } = useStore(helpStore);
  if (book !== undefined) {
    const exists =
      link.kind === "topic"
        ? helpTopic(book, link.id) !== undefined
        : helpTerm(book, link.id) !== undefined;
    if (!exists) return null;
  }

  // "Help: What the Colours Mean" — the destination's own title, so the
  // tooltip says where the button goes rather than "Help".
  //
  // @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.describe
  const says = label ?? L("Help: %1$@", helpNameOf(book, link));

  return (
    <button
      type="button"
      className="help-button"
      data-shape={shape}
      onClick={() => (onOpen === undefined ? showHelp(link) : onOpen())}
      title={says}
      aria-label={says}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M6.1 6.1a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.8.6-.8 1.1v.4" />
        <circle cx="7.8" cy="11.6" r="0.75" />
      </svg>
    </button>
  );
}
