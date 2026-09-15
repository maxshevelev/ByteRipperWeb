import { useEffect, useRef, useState } from "react";
import { hexAddress } from "@/core/text/hexText";
import {
  type BookmarkEditSession,
  cancelBookmarkEdit,
  commitBookmarkEdit,
  deleteEditedBookmark,
  editedBookmarkRow,
} from "@/state/bookmarkEditStore";
import { removeBookmark } from "@/state/bookmarksStore";

/**
 * The popover that names or edits a bookmark (§20.3), in the shape Xcode gives a
 * breakpoint: it hangs off the mark the moment the mark appears, with the caret
 * already in the Name field, and the keyboard finishes the job — Return saves,
 * Esc backs out.
 *
 * Two lines hold everything a bookmark is: where it is and what it is called.
 * The offset is a field rather than a title, so a mark put a row off is fixed by
 * typing the right address, without losing the name. An existing bookmark gets a
 * third line with Delete, the one act the keys here cannot express.
 *
 * A press anywhere outside it keeps what was typed: the mark is already on the
 * row by then, so committing is the quiet outcome.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.show
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.presentBookmarkEditPopover
 * @upstream-differs an element inside the pane's scroller, placed under the mark's row, rather than an NSPopover
 */
export interface BookmarkEditPopoverProps {
  readonly session: BookmarkEditSession;
  /** Where the mark's row is, in the scroller's content coordinates. */
  readonly top: number;
  readonly left: number;
  /** Above the row rather than below it, when there is no room underneath. */
  readonly above: boolean;
  /** The popover committed; the pane lands the caret on a mark just made. */
  readonly onCommitted: (session: BookmarkEditSession, row: number) => void;
  /** The keyboard closed it, so the dump takes the keyboard back. */
  readonly onKeyboardClose: () => void;
}

export function BookmarkEditPopover({
  session,
  top,
  left,
  above,
  onCommitted,
  onKeyboardClose,
}: BookmarkEditPopoverProps) {
  /** @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.offsetField */
  const [offsetText, setOffsetText] = useState(`0x${hexAddress(session.row)}`);
  /** @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.nameField */
  const [name, setName] = useState(session.existingName ?? "");
  const formRef = useRef<HTMLFormElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  /**
   * Red digits in a field of digits say "no such row" without a sentence.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.updateOffsetValidation
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.controlTextDidChange
   */
  const edited = editedBookmarkRow(offsetText, session.row);

  /**
   * The caret goes straight into the name, with an existing one selected so
   * typing replaces it: ⌘D, Return works without a click, a name without a Tab.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.viewDidAppear
   */
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();
  }, []);

  const typed = useRef({ edited, name });
  typed.current = { edited, name };

  /**
   * Dismissed by anything but the keys, the popover keeps what was typed. An
   * address that names no row is the one thing not kept: the bookmark stays on
   * its own row, with the name.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.popoverDidClose
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.settled
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.popover
   */
  useEffect(() => {
    const onOutsidePress = (event: PointerEvent) => {
      if (formRef.current?.contains(event.target as Node) === true) return;
      const settled = commitBookmarkEdit(typed.current.edited ?? session.row, typed.current.name);
      if (settled !== undefined) onCommitted(settled, typed.current.edited ?? session.row);
    };
    document.addEventListener("pointerdown", onOutsidePress, true);
    return () => document.removeEventListener("pointerdown", onOutsidePress, true);
  }, [session, onCommitted]);

  /**
   * Return saves; an address that names no row refuses, and the red field is
   * already the answer.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.commit
   */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (edited === undefined) return;
    const settled = commitBookmarkEdit(edited, name);
    if (settled !== undefined) onCommitted(settled, edited);
    onKeyboardClose();
  };

  const isNew = session.existingName === undefined;

  return (
    // Everything that happens in the popover stays in it: it sits inside the
    // dump's scroller, whose own handlers would otherwise take the keys for
    // typing into bytes and the presses for placing the caret.
    <form
      ref={formRef}
      className={`bookmark-popover${above ? " is-above" : ""}`}
      style={{ top, left }}
      aria-label={isNew ? "Name bookmark" : "Edit bookmark"}
      onSubmit={submit}
      onKeyDown={(event) => {
        event.stopPropagation();
        // @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.control
        // @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.cancel
        if (event.key === "Escape") {
          event.preventDefault();
          cancelBookmarkEdit();
          onKeyboardClose();
          return;
        }
        // ⌘D reaches the workspace through the popover, as upstream's menu key
        // equivalent does: the row is unmarked, and the popover goes with it.
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "d"
        ) {
          event.preventDefault();
          removeBookmark(session.row);
          onKeyboardClose();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
    >
      <input
        className={`bookmark-popover-offset${edited === undefined ? " is-invalid" : ""}`}
        aria-label="Bookmark offset"
        aria-invalid={edited === undefined}
        value={offsetText}
        onChange={(event) => setOffsetText(event.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <input
        ref={nameRef}
        className="bookmark-popover-name"
        aria-label="Bookmark name"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {isNew ? null : (
        // @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.deleteButton
        // @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.deletePressed
        <button
          type="button"
          className="toolbar-button bookmark-popover-delete"
          aria-label="Delete bookmark"
          onClick={() => {
            deleteEditedBookmark();
            onKeyboardClose();
          }}
        >
          Delete
        </button>
      )}
      {/* Return submits a form only when it has a submit button. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
