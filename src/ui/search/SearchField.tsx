import { useEffect, useId, useRef, useState } from "react";
import type { PatternMenuRow } from "@/ui/search/patternMenu";

/**
 * The pattern field: a text field with a magnifier that drops the search menu —
 * the web's `NSSearchField` with its search menu template (§11).
 *
 * The menu is the user's to ask for, never the browser's to offer while typing:
 * it opens on the magnifier or on ↓, is walked with ↑ ↓, and Return takes the
 * row under the highlight. Escape puts the menu away before it closes the bar.
 * What a row *does* is the owner's: this only draws the rows and says which one
 * was chosen.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.patternField
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.menuHeader
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.menuRowSize
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.menuFlagSize
 * @upstream-differs a combobox with a listbox of rows, rather than an NSMenu copied from a template
 */
export function SearchField({
  id,
  inputRef,
  className,
  defaultValue,
  placeholder,
  rows,
  onEdit,
  onChoose,
  onEscape,
}: {
  readonly id: string;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly className: string;
  readonly defaultValue: string;
  readonly placeholder: string;
  readonly rows: readonly PatternMenuRow[];
  readonly onEdit: (text: string) => void;
  /** A row was chosen — an entry of either list, or an enabled command. */
  readonly onChoose: (row: PatternMenuRow) => void;
  /** Escape with the menu already away. */
  readonly onEscape: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** The row under the highlight, by its position in `rows`. */
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const rowId = (index: number) => `${listId}-${index}`;

  const choosable = (row: PatternMenuRow | undefined) =>
    row !== undefined && (row.kind === "entry" || (row.kind === "command" && !row.disabled));

  // A press anywhere else puts the menu away, as a menu does.
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

  const step = (from: number, direction: 1 | -1): number => {
    for (let index = from + direction; index >= 0 && index < rows.length; index += direction) {
      if (choosable(rows[index])) return index;
    }
    return from;
  };

  const show = () => {
    setActive(step(-1, 1));
    setOpen(true);
  };

  const choose = (index: number) => {
    const row = rows[index];
    if (!choosable(row) || row === undefined) return;
    setOpen(false);
    inputRef.current?.focus();
    onChoose(row);
  };

  return (
    <div className="search-field" ref={rootRef}>
      <button
        type="button"
        className="search-field-menu"
        aria-label="Search Menu"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Recent Queries and Favorites"
        tabIndex={-1}
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
        aria-activedescendant={open && active >= 0 ? rowId(active) : undefined}
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
              else setActive((index) => step(index, 1));
              return;
            case "ArrowUp":
              if (!open) return;
              event.preventDefault();
              setActive((index) => step(index, -1));
              return;
            case "Enter":
              if (!open) return;
              // The menu's Return takes the row; the field's own searches.
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
          aria-label="Search Menu"
        >
          {rows.map((row, index) => {
            if (row.kind === "separator") return <hr key={row.key} className="menu-separator" />;
            if (row.kind === "heading") {
              return (
                <div key={row.key} role="presentation" className="search-field-heading">
                  {row.icon === "recent" ? <ClockGlyph /> : <StarGlyph />}
                  {row.label}
                </div>
              );
            }
            const isActive = index === active;
            const disabled = row.kind === "command" && row.disabled;
            return (
              <div
                key={row.key}
                id={rowId(index)}
                role="option"
                aria-selected={isActive}
                aria-disabled={disabled}
                tabIndex={-1}
                className={`${row.kind === "entry" ? "search-field-option" : "search-field-command"}${
                  isActive ? " is-active" : ""
                }${disabled ? " is-disabled" : ""}`}
                // Chosen on the press, which also keeps the focus in the field;
                // the keyboard walks the rows through the combobox instead.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
                onPointerEnter={() => {
                  if (!disabled) setActive(index);
                }}
              >
                {row.kind === "entry" ? (
                  <EntryRow row={row} />
                ) : (
                  <>
                    {row.label}
                    {row.kind === "command" && row.problem !== undefined ? (
                      <span className="search-field-problem"> — {row.problem}</span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One row of either list: `Name: "pattern"  flags` for a favourite, `"pattern"
 * flags` for a recent. The flags are grey and a size down — they say how the
 * pattern is searched, not what is searched for.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.patternItem
 */
function EntryRow({ row }: { readonly row: Extract<PatternMenuRow, { kind: "entry" }> }) {
  return (
    <>
      {row.usable ? null : (
        <span
          className="search-field-invalid"
          role="img"
          aria-label="Invalid pattern"
          title="Invalid pattern"
        >
          !
        </span>
      )}
      {row.name === "" ? null : <span>{row.name}: </span>}
      <span>"{row.pattern}"</span>
      <span className="search-field-flags">{row.flags}</span>
    </>
  );
}

/** `clock`. */
function ClockGlyph() {
  return (
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
  );
}

/** `star.fill`. */
function StarGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path
        d="M6 1.2l1.45 3 3.3.45-2.4 2.3.6 3.25L6 8.65 3.05 10.2l.6-3.25-2.4-2.3 3.3-.45z"
        fill="currentColor"
      />
    </svg>
  );
}
