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
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpTermPopover.swift#HelpTermPopover.makeContent
 * @upstream-differs what the popover does around its words is `HelpPopover`'s,
 * and its shape `HelpPopoverLayout`'s; this component is the words
 */

import { useEffect } from "react";
import { helpTerm } from "@/core/help/helpBook";
import type { HelpLink, HelpTermId } from "@/core/help/helpIds";
import { termLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { ensureHelpBook, helpStore, showHelp } from "@/state/helpStore";
import { useStore } from "@/state/useStore";
import { HelpBlocks } from "@/ui/help/HelpBlocks";
import { HelpPopover } from "@/ui/help/HelpPopover";
import { HelpPopoverLayout } from "@/ui/help/HelpPopoverLayout";
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
  const term = book === undefined ? undefined : helpTerm(book, id);

  // The book is not loaded at startup — it is loaded on the first ask, and a
  // reader pointing at a word they do not know is asking. Upstream's book is
  // always in hand when this is shown, because its load is synchronous; here
  // the ask starts the load, and the popover appears the moment the book
  // lands: `term` stops being undefined.
  useEffect(() => {
    if (book === undefined) void ensureHelpBook();
  }, [book]);

  if (term === undefined) return null;

  /**
   * Following a link inside a popover would be a second book inside a panel;
   * the reader is sent to the real one instead, where Back works.
   */
  const follow = (link: HelpLink) => {
    onClose();
    showHelp(link);
  };

  const name = plainHelpName(term.name);
  return (
    <HelpPopover anchor={anchor} label={name} onClose={onClose}>
      <HelpPopoverLayout
        title={name}
        footer={
          <button
            type="button"
            className="toolbar-button help-popover-more"
            onClick={() => follow(termLink(id))}
          >
            {L("Open in Help")}
          </button>
        }
      >
        {/* The term's one sentence and its body (HelpText.renderBrief): not
            its name, which is the popover's title, and not its see-also list,
            which belongs to the book. */}
        <p className="help-popover-summary">{term.summary}</p>
        <HelpBlocks blocks={term.blocks} onFollow={follow} />
      </HelpPopoverLayout>
    </HelpPopover>
  );
}
