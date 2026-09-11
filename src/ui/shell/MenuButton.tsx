import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * A button that drops a menu, and the menu itself.
 *
 * The macOS app has a menu bar; a web page does not, so its commands live
 * behind one button at the head of the toolbar. What has to survive the change
 * is the *structure* — the same commands in the same sections, in the same
 * order — because that is what people remember, and a flat list of twenty
 * buttons is what this replaces.
 *
 * Keyboard-reachable throughout: a menu only a pointer can open is a set of
 * commands some people cannot reach at all.
 */

export interface MenuAction {
  readonly kind?: "action";
  readonly label: string;
  /** Shown greyed at the right — the shortcut, not a second control. */
  readonly shortcut?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Drawn with a tick: a setting that is on, or the chosen one of a group. */
  readonly checked?: boolean | undefined;
  /** A group of mutually exclusive choices reads as radio, not checkbox. */
  readonly exclusive?: boolean | undefined;
  readonly onSelect: () => void;
}

export interface MenuSeparator {
  readonly kind: "separator";
}

export interface MenuHeading {
  readonly kind: "heading";
  readonly label: string;
}

export type MenuEntry = MenuAction | MenuSeparator | MenuHeading;

const isAction = (entry: MenuEntry): entry is MenuAction =>
  entry.kind === undefined || entry.kind === "action";

export function MenuButton({
  label,
  title,
  entries,
}: {
  readonly label: string;
  readonly title: string;
  readonly entries: readonly MenuEntry[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // A click anywhere else puts the menu away, which is what every menu does and
  // what stops one being left open over the work.
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

  // Opening puts the keyboard on the first command, so the menu can be driven
  // without the pointer ever touching it.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    // Without preventScroll the browser scrolls the item into view — and with a
    // popup taller than the bar it hangs from, what it scrolls is the page,
    // dragging the toolbar off the top of the window.
    first?.focus({ preventScroll: true });
  }, [open]);

  const onMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
      ];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(at + step + items.length) % items.length];
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: "nearest" });
    },
    [close]
  );

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="toolbar-button menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </button>

      {open ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are handled below
        <div id={menuId} className="menu-popup" role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>
          {entries.map((entry, index) => {
            if (entry.kind === "separator") {
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
              return <hr key={`sep-${index}`} className="menu-separator" />;
            }
            if (entry.kind === "heading") {
              return (
                <p key={entry.label} className="menu-heading">
                  {entry.label}
                </p>
              );
            }
            return (
              <button
                key={entry.label}
                type="button"
                className="menu-item"
                role={
                  entry.checked === undefined
                    ? "menuitem"
                    : entry.exclusive === true
                      ? "menuitemradio"
                      : "menuitemcheckbox"
                }
                {...(entry.checked === undefined ? {} : { "aria-checked": entry.checked })}
                disabled={entry.disabled === true}
                onClick={() => {
                  entry.onSelect();
                  close(false);
                }}
              >
                <span className="menu-tick" aria-hidden="true">
                  {entry.checked === true ? "✓" : ""}
                </span>
                <span className="menu-label">{entry.label}</span>
                {entry.shortcut === undefined ? null : (
                  <span className="menu-shortcut">{entry.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Narrows a list so a section with nothing in it takes no space. */
export function compactEntries(entries: readonly (MenuEntry | undefined)[]): MenuEntry[] {
  const kept = entries.filter((entry): entry is MenuEntry => entry !== undefined);
  const result: MenuEntry[] = [];
  for (const entry of kept) {
    const previous = result[result.length - 1];
    // No separator to open a menu, and never two in a row.
    if (entry.kind === "separator" && (previous === undefined || previous.kind === "separator")) {
      continue;
    }
    // A heading with no commands under it is a promise the menu does not keep.
    if (previous?.kind === "heading" && entry.kind === "separator") {
      result.pop();
      continue;
    }
    result.push(entry);
  }
  // A separator or a heading at the end has nothing after it to separate or
  // to title.
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last === undefined || isAction(last)) break;
    result.pop();
  }
  return result;
}
