import { useCallback, useEffect, useRef, useState } from "react";
import type { Bookmark } from "@/core/bookmarks/bookmarkStore";
import { bookmarkDisplayName, rowContaining } from "@/core/bookmarks/bookmarkStore";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { hexAddress } from "@/core/text/hexText";
import { parseOffset } from "@/core/text/offsetParser";
import {
  bookmarksStore,
  clearRecentAddresses,
  editBookmark,
  removeBookmark,
} from "@/state/bookmarksStore";
import { useStore } from "@/state/useStore";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Go To, and the bookmark list, in one window (§10.1, §20.5).
 *
 * They are one form because they are one question — *go where?* — and keeping
 * them apart would mean two dialogs each offering half an answer. The keyboard
 * follows the focus, which is what lets one Return mean two things without ever
 * guessing: in the field it goes to what was typed, in the list to what is
 * selected.
 *
 * The list is also where bookmarks are managed — Backspace removes the
 * selected one, Return on its name commits a rename — so nothing about a
 * bookmark lives in two places.
 *
 * The parser is `src/core/text/offsetParser.ts`, which already knows every
 * spelling this accepts and refuses — `0x1F`, `1F`, `4096` — and refuses a
 * value too large to address rather than rounding it into a different offset.
 */
export interface GoToDialogProps {
  readonly open: boolean;
  readonly fileSize: number;
  /** The active pane's bytes, for describing a bookmark that has no name. */
  readonly document?: BinaryDocument | undefined;
  /** Which half the keyboard starts in: ⌘L types, the bookmark command picks. */
  readonly focus?: "offset" | "bookmarks";
  readonly onGo: (offset: number) => void;
  readonly onClose: () => void;
}

export function GoToDialog({
  open,
  fileSize,
  document: doc,
  focus = "offset",
  onGo,
  onClose,
}: GoToDialogProps) {
  const [text, setText] = useState("");
  const state = useStore(bookmarksStore);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [renaming, setRenaming] = useState<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setSelected(state.bookmarks[0]?.row);
    setRenaming(undefined);
    if (focus === "bookmarks") {
      requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
    }
    // The list this opens over is a snapshot of the moment it opened; it
    // follows the store from then on.
  }, [open, focus, state.bookmarks[0]?.row]);

  const parsed = text.trim() === "" ? undefined : parseOffset(text);
  const problem =
    parsed === undefined
      ? undefined
      : !parsed.ok
        ? parsed.reason === "outOfRange"
          ? "That number is too large to be an offset."
          : "Type a decimal number, or hex as 1F or 0x1F."
        : parsed.value > fileSize
          ? `This file ends at 0x${fileSize.toString(16).toUpperCase()}.`
          : undefined;

  const go = useCallback(
    (offset: number) => {
      onGo(offset);
      onClose();
    },
    [onGo, onClose]
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (parsed === undefined || !parsed.ok || problem !== undefined) return;
    go(parsed.value);
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const rows = state.bookmarks.map((mark) => mark.row);
    if (rows.length === 0 || renaming !== undefined) return;
    const at = selected === undefined ? -1 : rows.indexOf(selected);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected(rows[Math.min(Math.max(at + step, 0), rows.length - 1)]);
      return;
    }
    if (event.key === "Enter" && selected !== undefined) {
      event.preventDefault();
      go(selected);
      return;
    }
    // Backspace removes the selected mark, and the selection moves to what took
    // its place so a run of removals needs no pointer.
    if (event.key === "Backspace" || event.key === "Delete") {
      if (selected === undefined) return;
      event.preventDefault();
      removeBookmark(selected);
      setSelected(rows[Math.min(at, rows.length - 2)]);
    }
  };

  return (
    <Dialog open={open} title="Go to position" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <label className="dialog-field">
          Offset
          <input
            autoFocus={focus === "offset"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="0x1000"
            list="goto-recent"
            inputMode="text"
            spellCheck={false}
            aria-describedby="goto-help"
          />
        </label>
        {/* The addresses this workspace has already been sent to, offered back
            rather than retyped — on a bench the interesting ones get typed over
            and over. */}
        <datalist id="goto-recent">
          {state.recent.map((row) => (
            <option key={row} value={`0x${hexAddress(row)}`} />
          ))}
        </datalist>
        <p className="dialog-help" id="goto-help">
          {problem ?? "Decimal, or hex as 1F or 0x1F."}
        </p>

        <div className="bookmark-list-head">
          <span>Bookmarks</span>
          {state.recent.length > 0 ? (
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={clearRecentAddresses}
            >
              Clear recent addresses
            </button>
          ) : null}
        </div>

        {state.bookmarks.length === 0 ? (
          <p className="dialog-help">
            No bookmarks yet. Cmd/Ctrl+D marks the row the caret is on, and so does a double-click
            on its address.
          </p>
        ) : (
          // A listbox, not a list: these rows are picked, and the arrows and
          // Return are how they are picked.
          <div
            className="bookmark-list"
            ref={listRef}
            role="listbox"
            aria-label="Bookmarks"
            tabIndex={0}
            onKeyDown={onListKeyDown}
          >
            {state.bookmarks.map((mark) => (
              <BookmarkRow
                key={mark.row}
                mark={mark}
                document={doc}
                fileSize={fileSize}
                selected={selected === mark.row}
                renaming={renaming === mark.row}
                onSelect={() => setSelected(mark.row)}
                onGo={() => go(mark.row)}
                onRename={() => setRenaming(mark.row)}
                onRenamed={(name) => {
                  editBookmark(mark.row, mark.row, name);
                  setRenaming(undefined);
                  listRef.current?.focus({ preventScroll: true });
                }}
                onRemove={() => removeBookmark(mark.row)}
              />
            ))}
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="toolbar-button"
            disabled={parsed === undefined || !parsed.ok || problem !== undefined}
          >
            Go
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function BookmarkRow({
  mark,
  document: doc,
  fileSize,
  selected,
  renaming,
  onSelect,
  onGo,
  onRename,
  onRenamed,
  onRemove,
}: {
  readonly mark: Bookmark;
  readonly document: BinaryDocument | undefined;
  readonly fileSize: number;
  readonly selected: boolean;
  readonly renaming: boolean;
  readonly onSelect: () => void;
  readonly onGo: () => void;
  readonly onRename: () => void;
  readonly onRenamed: (name: string) => void;
  readonly onRemove: () => void;
}) {
  const [preview, setPreview] = useState("");

  // What the row actually holds, read live from the active pane — which is how
  // an unnamed bookmark says what it marks. A row past this file's end says so
  // rather than showing zeros (§9).
  useEffect(() => {
    let current = true;
    if (mark.row >= fileSize || doc === undefined) {
      setPreview(mark.row >= fileSize ? "past the end of this file" : "");
      return;
    }
    void doc.read(mark.row, Math.min(8, fileSize - mark.row)).then((bytes) => {
      if (!current) return;
      setPreview(
        [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ")
      );
    });
    return () => {
      current = false;
    };
  }, [mark.row, fileSize, doc]);

  return (
    <div
      className="bookmark-row"
      role="option"
      aria-selected={selected}
      data-selected={selected ? "" : undefined}
      tabIndex={-1}
      onPointerDown={onSelect}
      onDoubleClick={onRename}
    >
      <button
        type="button"
        className="bookmark-address"
        onClick={onGo}
        title={`Go to ${hexAddress(mark.row)}`}
      >
        {hexAddress(mark.row)}
      </button>
      {renaming ? (
        <input
          className="bookmark-name-field"
          ref={(element) => element?.select()}
          defaultValue={mark.name}
          aria-label="Bookmark name"
          onBlur={(event) => onRenamed(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenamed(event.currentTarget.value);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRenamed(mark.name);
            }
          }}
        />
      ) : (
        <span className="bookmark-name">
          {mark.name.length > 0 ? bookmarkDisplayName(mark) : preview}
        </span>
      )}
      <button
        type="button"
        className="bookmark-remove"
        onClick={onRemove}
        title={`Remove the bookmark at ${hexAddress(mark.row)}`}
      >
        ×
      </button>
    </div>
  );
}

/** The row a jump lands on, for the caller that records where it has been. */
export { rowContaining };
