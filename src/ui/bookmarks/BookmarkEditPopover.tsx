import { useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import { hexAddress } from "@/core/text/hexText";
import {
  type BookmarkEditSession,
  cancelBookmarkEdit,
  commitBookmarkEdit,
  deleteEditedBookmark,
  editedBookmarkRow,
} from "@/state/bookmarkEditStore";
import { removeBookmark } from "@/state/bookmarksStore";
import { paneInFront } from "@/state/workspaceStore";
import { AddressField } from "@/ui/controls/AddressField";
import {
  addressValue,
  isUnfinished,
  recordAddressInHistory,
} from "@/ui/controls/addressEvaluation";
import { shortcutKey } from "@/ui/pane/hexKeys";

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
 * @upstream-differs an element over the pane's dump, placed under the mark's row where it is on screen, rather than an NSPopover
 */
export interface BookmarkEditPopoverProps {
  readonly session: BookmarkEditSession;
  /** Where it stands in the pane's box: under the mark's row as it is on screen. */
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
   * Return, or a press outside, on the text as it stands: an unfinished sum is
   * then as red as a typo. Any edit takes it back.
   */
  const [acted, setActed] = useState(false);

  /**
   * Red digits in a field of digits say "no such row" without a sentence. A sum
   * that ends at its operator is not red while it is typed — it is not wrong
   * yet (issue #9). Acted on, it is.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.updateOffsetValidation
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.controlTextDidChange
   */
  const edited = editedBookmarkRow(addressValue(offsetText), session.row);
  const red = edited === undefined && (acted || !isUnfinished(offsetText));

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

  const typed = useRef({ edited, name, offsetText });
  typed.current = { edited, name, offsetText };

  /**
   * Dismissed by anything but the keys, the popover keeps what was typed. An
   * address that names no row is the one thing not kept: the bookmark stays on
   * its own row, with the name.
   *
   * An unfinished sum is not settled by a press outside: closing would drop it
   * without a word, from a field that never turned red. The popover stays, and
   * the field turns red; Return, Esc and a finished sum close it as before. A
   * switch to another window presses nothing here, so it leaves the popover and
   * the sum as they are.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.popoverDidClose
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.popoverShouldClose
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.settled
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.popover
   */
  useEffect(() => {
    const onOutsidePress = (event: PointerEvent) => {
      if (formRef.current?.contains(event.target as Node) === true) return;
      const { edited, name, offsetText } = typed.current;
      if (isUnfinished(offsetText)) {
        setActed(true);
        return;
      }
      if (edited !== undefined) recordAddressInHistory(offsetText);
      const settled = commitBookmarkEdit(edited ?? session.row, name);
      if (settled !== undefined) onCommitted(settled, edited ?? session.row);
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
    if (edited === undefined) {
      setActed(true);
      return;
    }
    recordAddressInHistory(offsetText);
    const settled = commitBookmarkEdit(edited, name);
    if (settled !== undefined) onCommitted(settled, edited);
    onKeyboardClose();
  };

  const isNew = session.existingName === undefined;

  return (
    // Everything that happens in the popover stays in it: the pane's handlers
    // would otherwise take the keys for typing into bytes and the presses for
    // placing the caret.
    <form
      ref={formRef}
      className={`bookmark-popover${above ? " is-above" : ""}`}
      style={{ top, left }}
      aria-label={isNew ? L("Name bookmark") : L("Edit bookmark")}
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
          shortcutKey(event) === "d"
        ) {
          event.preventDefault();
          removeBookmark(session.pane ?? paneInFront(), session.row);
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
      {/* The address in the dump's own font: read far more often than edited. */}
      <AddressField
        aria-label={L("Bookmark offset")}
        invalid={red}
        value={offsetText}
        onChange={(text) => {
          setOffsetText(text);
          setActed(false);
        }}
      />
      <input
        ref={nameRef}
        className="bookmark-popover-name"
        aria-label={L("Bookmark name")}
        placeholder={L("Name")}
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
          aria-label={L("Delete bookmark")}
          onClick={() => {
            deleteEditedBookmark();
            onKeyboardClose();
          }}
        >
          {L("Delete")}
        </button>
      )}
      {/* Return submits a form only when it has a submit button. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
