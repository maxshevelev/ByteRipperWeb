import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type Bookmark, rowContaining } from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { bareHexNumber } from "@/core/hexText/hexText";
import { L } from "@/core/localization/localization";
import type { SessionView } from "@/core/session/sessionView";
import { hexAddress } from "@/core/text/hexText";
import {
  abandonBookmarkEdit,
  type BookmarkEditSession,
  bookmarkEditStore,
  cancelBookmarkEdit,
  editBookmarkInList,
} from "@/state/bookmarkEditStore";
import { bookmarksIn, bookmarksStore, removeBookmark } from "@/state/bookmarksStore";
import type { PaneId } from "@/state/paneId";
import { useStore } from "@/state/useStore";
import { BookmarkEditPopover } from "@/ui/bookmarks/BookmarkEditPopover";
import { AddressField } from "@/ui/controls/AddressField";
import {
  addressBreakdown,
  addressProblemMessage,
  evaluateAddress,
  recordAddressInHistory,
} from "@/ui/controls/addressEvaluation";
import {
  bookmarksUnavailable,
  rowDescription,
  selectionAfterChange,
  visibleRowCount,
} from "@/ui/dialogs/bookmarkList";
import { Dialog } from "@/ui/dialogs/Dialog";
import { HelpButton } from "@/ui/help/HelpButton";
import { detectKeyboardPlatform } from "@/ui/pane/hexKeys";
import { openContextMenu } from "@/ui/shell/ContextMenu";

/**
 * Go To, and the bookmark list, in one window (§10.1, §20.5).
 *
 * They are one form because they are one question — *go where?* — and keeping
 * them apart would mean two dialogs each offering half an answer. The keyboard
 * follows the focus, which is what lets one Return mean two things without ever
 * guessing: in the field it goes to what was typed, in the list to what is
 * selected, and in the list with nothing selected it does nothing at all.
 *
 * The list is also where bookmarks are managed — ⌫ removes the selected one, a
 * double click opens its editor, a right-click offers both — so nothing about a
 * bookmark lives in two places. The editor is the popover the dump's ⇧⌘D opens:
 * one editor for a bookmark, wherever it is edited from.
 *
 * The field is the app's one address field (`AddressField`): it takes every
 * spelling of a number — `0x1F`, `1F`, `4096` — and a sum of them, refuses a
 * value too large to address rather than rounding it into a different offset,
 * and offers back the addresses and sums entered before.
 */
export interface GoToDialogProps {
  readonly open: boolean;
  /**
   * The pane the form is about: its size, its marks, and where an address goes.
   * The pane in front, which for a raised panel is the part — a part's marks
   * are its own, and the workspace's name rows of a file this form is not
   * about.
   */
  readonly pane: PaneId;
  readonly fileSize: number;
  /** The active pane's bytes, for describing a bookmark that has no name. */
  readonly document?: SessionView | undefined;
  /**
   * Which half the keyboard starts in: ⌘L types, the bookmark command picks.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.Focus
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.focus
   */
  readonly focus?: "offset" | "bookmarks";
  readonly onGo: (offset: number) => void;
  /** @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.dismissForm */
  readonly onClose: () => void;
}

/** What the offset field opens with. */
const HEX_PREFIX = "0x";

/** One row of the list, in pixels — upstream's table row. */
const ROW_HEIGHT = 20;

const platform = detectKeyboardPlatform();

/**
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.bookmarks
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.offsetCombo
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.goButton
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.cancelButton
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.bookmarkTable
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.errorLabel
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.emptyLabel
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.breakdownLabel
 * @upstream-differs a dialog rather than a window of its own
 */
export function GoToDialog({
  open,
  pane,
  fileSize,
  document: doc,
  focus = "offset",
  onGo,
  onClose,
}: GoToDialogProps) {
  // The field opens holding the hex prefix, because a firmware offset is typed in
  // hex: the reader goes straight to the digits.
  const [text, setText] = useState(HEX_PREFIX);
  const state = useStore(bookmarksStore);
  /** The marks of the pane this form is about. */
  const marks = bookmarksIn(state, pane);
  const editing = useStore(bookmarkEditStore).session;
  /** @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.isEditingBookmark */
  const editingHere =
    open && editing !== undefined && editing.pane === undefined ? editing : undefined;
  /**
   * The selected bookmark, kept as the bookmark's row rather than a position in
   * the list: the list re-sorts when an address is edited and renumbers when a
   * mark is made elsewhere, and the selection means "this bookmark".
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.selectedBookmarkRow
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.selectedBookmark
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.selectBookmark
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.tableViewSelectionDidChange
   */
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<HTMLInputElement | null>(null);
  const rowElements = useRef(new Map<number, HTMLDivElement>());
  const offsetId = useId();
  const errorId = useId();
  /**
   * Return was pressed on the text as it stands: an unfinished sum the form
   * waited on while it was typed is then named. Any edit takes it back.
   */
  const [acted, setActed] = useState(false);

  const bookmarksNow = useRef(marks);
  bookmarksNow.current = marks;

  useEffect(() => {
    if (!open) return;
    setText(HEX_PREFIX);
    setActed(false);
    if (focus === "bookmarks") {
      // Opened for the list, the list offers its first bookmark — the lowest
      // address. The jump still takes a Return: a selection is an offer.
      setSelected(bookmarksNow.current[0]?.row);
      requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
    } else {
      setSelected(undefined);
      // After the dialog has put the focus on its first field: the caret goes
      // past the prefix, not over it, so the first key typed is a digit.
      requestAnimationFrame(() => {
        const input = offsetRef.current;
        if (input === null) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }, [open, focus]);

  // The selection follows the list: a bookmark still listed stays selected, and
  // one removed — by ⌫, the menu, or its popover's Delete — hands it on.
  const previousRows = useRef<readonly number[]>([]);
  useEffect(() => {
    const rows = marks.map((mark) => mark.row);
    setSelected((current) => selectionAfterChange(previousRows.current, rows, current));
    previousRows.current = rows;
  }, [marks]);

  /**
   * Validation as the address is typed. The form opens with "0x" in the field:
   * nothing to go to yet, so the button is off — but no error, because nothing
   * has been typed wrong. A sum still being typed is not a mistake yet either:
   * the button waits, and the form says nothing until Return is pressed on it.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.controlTextDidChange
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.updateValidation
   */
  const typed = text.trim();
  const untouched = typed === "" || typed.toLowerCase() === HEX_PREFIX;
  const evaluation = evaluateAddress(text);
  const problem = untouched
    ? undefined
    : !evaluation.ok
      ? evaluation.reason === "incomplete" && !acted
        ? undefined
        : (addressProblemMessage(text) ?? L("Invalid offset — use hex with 0x prefix or decimal."))
      : evaluation.value > fileSize
        ? L("This file ends at 0x%1$@.", bareHexNumber(fileSize))
        : undefined;
  const target = evaluation.ok && problem === undefined ? evaluation.value : undefined;
  /** The sum read back, on the message's line while there is no message. */
  const breakdown = problem === undefined ? addressBreakdown(text) : undefined;

  /**
   * Leaving the form takes a bookmark editor hanging off its list with it.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.cancelPressed
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.closeForm
   */
  const close = useCallback(() => {
    if (bookmarkEditStore.getSnapshot().session?.pane === undefined) abandonBookmarkEdit();
    onClose();
  }, [onClose]);

  /** @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.jump */
  const go = useCallback(
    (offset: number) => {
      close();
      onGo(offset);
    },
    [onGo, close]
  );

  /**
   * Return in the field, and the Go To button: what the field comes to. What
   * was typed is what is kept: a sum goes into the list as the sum, so it can
   * be picked again, read, and corrected (issue #9). A Go To in a part is
   * kept too, as upstream keeps it: the list is what was typed into these
   * fields, not a list of places in the file — the earlier web edition left a
   * part's offset out, since it named another row of the file.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.goToTypedOffset
   */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (target === undefined) return;
    recordAddressInHistory(text, true);
    go(target);
  };

  /**
   * Escape's first level closes an open bookmark editor and leaves the bookmark
   * as it was; only the next one closes the form.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.cancelBookmarkEdit
   */
  const onCancelRequest = useCallback(() => {
    const session = bookmarkEditStore.getSnapshot().session;
    if (session === undefined || session.pane !== undefined) return true;
    cancelBookmarkEdit();
    listRef.current?.focus({ preventScroll: true });
    return false;
  }, []);

  const scrollRowIntoView = (row: number | undefined) => {
    if (row !== undefined) rowElements.current.get(row)?.scrollIntoView({ block: "nearest" });
  };

  /**
   * The list's own keys: the arrows pick, Return goes to the pick, ⌫ removes it.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.goToSelectedBookmark
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.removeSelectedBookmark
   */
  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (editingHere !== undefined) return;
    const rows = marks.map((mark) => mark.row);
    if (rows.length === 0) return;
    const at = selected === undefined ? -1 : rows.indexOf(selected);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = rows[Math.min(Math.max(at + step, 0), rows.length - 1)];
      setSelected(next);
      scrollRowIntoView(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // With nothing selected, nothing: Return in the list is never a guess.
      if (selected !== undefined) go(selected);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      if (selected !== undefined) removeBookmark(pane, selected);
    }
  };

  /**
   * The editor hangs under the row it edits, or over it where the form has no
   * room below.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.editPopoverPresenter
   */
  const [editAnchor, setEditAnchor] = useState<
    { token: number; top: number; above: boolean } | undefined
  >(undefined);
  useLayoutEffect(() => {
    if (editingHere === undefined) {
      setEditAnchor(undefined);
      return;
    }
    const table = tableRef.current;
    const row = rowElements.current.get(editingHere.row);
    const dialog = table?.closest("dialog");
    if (table === null || row === undefined || dialog === null || dialog === undefined) return;
    row.scrollIntoView({ block: "nearest" });
    const rowBox = row.getBoundingClientRect();
    const tableBox = table.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    const roomBelow = dialogBox.bottom - rowBox.bottom;
    const above = roomBelow < 140 && rowBox.top - dialogBox.top > roomBelow;
    setEditAnchor({
      token: editingHere.token,
      top: above ? rowBox.top - tableBox.top - 6 : rowBox.bottom - tableBox.top + 6,
      above,
    });
  }, [editingHere]);

  /** The edited bookmark stays selected, at whatever row it now sits. */
  const onBookmarkCommitted = useCallback((_session: BookmarkEditSession, row: number) => {
    setSelected(row);
  }, []);
  const focusList = useCallback(() => listRef.current?.focus({ preventScroll: true }), []);

  /**
   * A right-click offers what the list does that a key does not announce, on the
   * row that was clicked rather than the selected one.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.editClickedBookmark
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.deleteClickedBookmark
   */
  const rowMenu = (event: React.MouseEvent, mark: Bookmark) => {
    setSelected(mark.row);
    openContextMenu(event, [
      { label: L("Edit Bookmark…"), onSelect: () => editBookmarkInList(mark.row) },
      {
        label: L("Delete Bookmark"),
        destructive: true,
        onSelect: () => removeBookmark(pane, mark.row),
      },
    ]);
  };

  const empty = marks.length === 0;
  /**
   * Why this pane's bookmark list is closed, or nothing when it is open
   * (§20.7).
   *
   * Only a decompressed body reaches this with a reason: its bytes are what a
   * compressed section unpacks to, so no offset in them is an offset in the
   * file the marks are about. Saying so is the point — an empty list would read
   * as "you have not made any", which is a different thing entirely.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.bookmarksUnavailableMessage
   */
  const unavailable = bookmarksUnavailable(pane);

  // help: dialog.go-to
  return (
    <Dialog
      open={open}
      title={L("Go To")}
      className="goto-dialog"
      onClose={close}
      onCancelRequest={onCancelRequest}
    >
      <div className="dialog-body">
        {/* "Offset: [ 0x… ] (Go To)" — ⌘L, type, Return. The button names the
            action; Return in the field is what submits. */}
        <form className="goto-offset" onSubmit={submit}>
          <label className="goto-offset-label" htmlFor={offsetId}>
            {L("Offset:")}
          </label>
          {/* The list of recent entries belongs to the arrow and to ↓, not to
              the focus: ⌘L opening Go To onto a dropped list would bury the
              bookmarks under it. A picked entry only fills the field: the jump
              is still a Return away, so the list cannot navigate the dump by
              itself. */}
          <AddressField
            id={offsetId}
            ref={offsetRef}
            value={text}
            onChange={(next) => {
              setText(next);
              setActed(false);
            }}
            onReturn={() => setActed(true)}
            invalid={problem !== undefined}
            aria-describedby={errorId}
          />
          <button type="submit" className="toolbar-button" disabled={target === undefined}>
            {L("Go To")}
          </button>
          {/* Always in the layout, empty when nothing is wrong, so the list does
              not move under the pointer as the address is typed. A sum that
              evaluates has no error, and one that does not has nothing to read
              back: the two share the line. */}
          <p className="goto-error" id={errorId} aria-live="polite">
            {problem ??
              (breakdown === undefined ? (
                ""
              ) : (
                <span className="address-breakdown">{breakdown}</span>
              ))}
          </p>
        </form>

        {/* Dimmed over a closed list, the way a disabled control's title is: the
            half of the form that still works must be the one that looks alive. */}
        <span className="goto-list-label" data-closed={unavailable === undefined ? undefined : ""}>
          {L("Bookmarks")}
        </span>
        <div className="bookmark-table" ref={tableRef}>
          {/* A listbox: these rows are picked, and the arrows and Return are how. */}
          {/* A closed list is closed to the keyboard and the mouse as well as to
              the eye (§20.7): Tab walks past it, the arrows and Return mean
              nothing in it, and it offers no menu — there is no bookmark here
              for any of them to act on, and a live-looking list over an
              explanation of why there is none would be the form arguing with
              itself. */}
          <div
            className="bookmark-list"
            ref={listRef}
            role="listbox"
            aria-label={L("Bookmarks")}
            aria-disabled={unavailable === undefined ? undefined : true}
            tabIndex={unavailable === undefined ? 0 : -1}
            style={{ height: visibleRowCount(marks.length) * ROW_HEIGHT + 2 }}
            {...(unavailable === undefined ? { onKeyDown: onListKeyDown } : {})}
          >
            {marks.map((mark) => (
              // biome-ignore lint/a11y/useFocusableInteractive: the listbox holds the focus; its options are picked with the arrows
              <div
                key={mark.row}
                ref={(element) => {
                  if (element === null) rowElements.current.delete(mark.row);
                  else rowElements.current.set(mark.row, element);
                }}
                className="bookmark-row"
                role="option"
                aria-selected={selected === mark.row}
                data-selected={selected === mark.row ? "" : undefined}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  setSelected(mark.row);
                  listRef.current?.focus({ preventScroll: true });
                }}
                // @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.handleDoubleClick
                onDoubleClick={() => editBookmarkInList(mark.row)}
                onContextMenu={(event) => rowMenu(event, mark)}
              >
                <span className="bookmark-address">{hexAddress(mark.row)}</span>
                {mark.name.length > 0 ? (
                  <span className="bookmark-name">{mark.name}</span>
                ) : (
                  <RowPreview row={mark.row} document={doc} fileSize={fileSize} />
                )}
              </div>
            ))}
          </div>
          {unavailable !== undefined ? (
            <p className="bookmark-empty">{unavailable}</p>
          ) : empty ? (
            // @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.noBookmarksYetText
            <p className="bookmark-empty">
              {platform === "apple"
                ? L(
                    "No bookmarks yet. ⌘D marks the row your caret is on, so you can come back to it."
                  )
                : L(
                    "No bookmarks yet. Ctrl+D marks the row your caret is on, so you can come back to it."
                  )}
            </p>
          ) : null}
          {editingHere !== undefined && editAnchor?.token === editingHere.token ? (
            <BookmarkEditPopover
              key={editingHere.token}
              session={editingHere}
              top={editAnchor.top}
              left={12}
              above={editAnchor.above}
              onCommitted={onBookmarkCommitted}
              onKeyboardClose={focusList}
            />
          ) : null}
        </div>

        <div className="dialog-actions goto-actions">
          {/* Both halves of this form answer one question, and the page about
              the marks is the one that answers it in words.
              @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.standard */}
          <HelpButton link={topicLink(TOPIC.bookmarks)} />
          {/* Close, not Cancel: nothing here is undone by leaving. A bookmark
              edited or removed from the list already is. */}
          <button type="button" className="toolbar-button" onClick={close}>
            {L("Close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * What an unnamed bookmark is described by: its row's bytes in the active pane,
 * read live, so the list shows what the row holds now.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.rowDescription
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.pastEndOfFileText
 */
function RowPreview({
  row,
  document: doc,
  fileSize,
}: {
  readonly row: number;
  readonly document: SessionView | undefined;
  readonly fileSize: number;
}) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let current = true;
    if (row >= fileSize) {
      setPreview(rowDescription(undefined));
      return;
    }
    if (doc === undefined) {
      setPreview("");
      return;
    }
    void doc.read(row, Math.min(BYTES_PER_ROW, fileSize - row)).then((bytes) => {
      if (current) setPreview(rowDescription(bytes));
    });
    return () => {
      current = false;
    };
  }, [row, fileSize, doc]);

  return (
    <span className={`bookmark-name is-preview${row >= fileSize ? " is-past-end" : ""}`}>
      {preview}
    </span>
  );
}

/** The row a jump lands on, for the caller that records where it has been. */
export { rowContaining };
