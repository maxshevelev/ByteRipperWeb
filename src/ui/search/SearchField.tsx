import { useEffect, useId, useRef, useState } from "react";

/**
 * The pattern field: a text field with a magnifier that drops the recent
 * queries — the web's `NSSearchField` with its search menu.
 *
 * The list is the user's to ask for, never the browser's to offer while typing:
 * it opens on the magnifier or on ↓, is walked with ↑ ↓, and Return takes the
 * entry under the highlight into the field without searching — Return in the
 * field is what searches. Escape puts the list away before it closes the bar.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.patternField
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.rebuildPatternMenu
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.menuHeader
 * @upstream-differs a combobox with a listbox of the recent queries; the favourites rows wait for the pattern library (M11)
 */
export function SearchField({
  id,
  inputRef,
  className,
  defaultValue,
  placeholder,
  history,
  onEdit,
  onPick,
  onEscape,
  onClearRecents,
}: {
  readonly id: string;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly className: string;
  readonly defaultValue: string;
  readonly placeholder: string;
  /**
   * Most recent first: the text a row puts in the field, and what the row
   * says — which can say more than the text, as "pattern — encoding" does.
   */
  readonly history: readonly { readonly text: string; readonly label: string }[];
  readonly onEdit: (text: string) => void;
  /** A row was taken into the field, after its text was. */
  readonly onPick?: ((row: number) => void) | undefined;
  /** Escape with the list already away. */
  readonly onEscape: () => void;
  readonly onClearRecents: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** The row under the highlight: an entry, or `history.length` for Clear Recents. */
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const rowId = (index: number) => `${listId}-${index}`;
  const lastRow = history.length;

  // A press anywhere else puts the list away, as a menu does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // A list with nothing in it has nothing to show.
  useEffect(() => {
    if (history.length === 0) setOpen(false);
  }, [history.length]);

  const show = () => {
    if (history.length === 0) return;
    setActive(0);
    setOpen(true);
  };

  /** Takes an entry into the field, caret at its end, and searches nothing. */
  const pick = (row: number) => {
    const entry = history[row];
    if (entry === undefined) return;
    const input = inputRef.current;
    if (input !== null) {
      input.value = entry.text;
      input.focus();
      input.setSelectionRange(entry.text.length, entry.text.length);
    }
    onEdit(entry.text);
    onPick?.(row);
    setOpen(false);
  };

  const clear = () => {
    onClearRecents();
    setOpen(false);
    inputRef.current?.focus();
  };

  const choose = (row: number) => {
    if (history[row] !== undefined) pick(row);
    else if (row === lastRow) clear();
  };

  return (
    <div className="search-field" ref={rootRef}>
      <button
        type="button"
        className="search-field-menu"
        aria-label="Recent Queries"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Recent Queries"
        tabIndex={-1}
        disabled={history.length === 0}
        onClick={() => {
          if (open) setOpen(false);
          else show();
          inputRef.current?.focus();
        }}
      >
        <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.6 7.6 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path
            d="M11.5 4.5l1.75 1.75L15 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        id={id}
        ref={inputRef}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="none"
        aria-activedescendant={open ? rowId(active) : undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setOpen(false);
          onEdit(event.target.value);
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              if (!open) show();
              else setActive((row) => Math.min(row + 1, lastRow));
              return;
            case "ArrowUp":
              if (!open) return;
              event.preventDefault();
              setActive((row) => Math.max(row - 1, 0));
              return;
            case "Enter":
              if (!open) return;
              // The list's Return takes the row; the field's own searches.
              event.preventDefault();
              choose(active);
              return;
            case "Escape":
              event.preventDefault();
              if (open) setOpen(false);
              else onEscape();
              return;
            case "Tab":
              setOpen(false);
              return;
          }
        }}
      />
      {open ? (
        <div
          id={listId}
          className="menu-popup search-field-popup"
          role="listbox"
          aria-label="Recent Queries"
        >
          <div role="presentation" className="search-field-heading">
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M6 3.4V6l1.8 1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            Recent Queries
          </div>
          {history.map((entry, row) => (
            <div
              // By position: the same text can stand in two rows, one per encoding.
              // biome-ignore lint/suspicious/noArrayIndexKey: the rows are the history in order, and a row is its position in it
              key={row}
              id={rowId(row)}
              role="option"
              aria-selected={row === active}
              tabIndex={-1}
              className={`search-field-option${row === active ? " is-active" : ""}`}
              // Picked on the press, which also keeps the focus in the field;
              // the keyboard walks the rows through the combobox instead.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(row);
              }}
              onPointerEnter={() => setActive(row)}
            >
              {entry.label}
            </div>
          ))}
          <hr className="menu-separator" />
          <div
            id={rowId(lastRow)}
            role="option"
            aria-selected={active === lastRow}
            tabIndex={-1}
            className={`search-field-command${active === lastRow ? " is-active" : ""}`}
            onPointerDown={(event) => {
              event.preventDefault();
              clear();
            }}
            onPointerEnter={() => setActive(lastRow)}
          >
            Clear Recents
          </div>
        </div>
      ) : null}
    </div>
  );
}
