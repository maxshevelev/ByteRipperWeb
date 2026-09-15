import { useCallback, useEffect, useId, useRef, useState } from "react";
import { focusFirstItem, MenuItems, useMenuKeys } from "@/ui/shell/MenuItems";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * A button that drops a menu.
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

export function MenuButton({
  label,
  title,
  entries,
  ariaLabel,
  disabled,
  className,
  pullDown,
}: {
  readonly label: React.ReactNode;
  readonly title: string;
  readonly entries: readonly MenuEntry[];
  /** Where the label is a glyph, what the button is called. */
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  /**
   * Draws the chevron that says the button drops a list to choose from, as a
   * pull-down does, rather than acting at once like the icons beside it.
   *
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeToolsItem
   * @upstream-differs a chevron drawn after the label, where AppKit's pull-down draws its own
   */
  readonly pullDown?: boolean | undefined;
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
    if (open) focusFirstItem(menuRef.current);
  }, [open]);

  const onMenuKeyDown = useMenuKeys(menuRef, close);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`toolbar-button menu-trigger${className === undefined ? "" : ` ${className}`}`}
        aria-label={ariaLabel}
        disabled={disabled}
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
        {pullDown === true ? (
          <svg className="menu-chevron" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
            <path
              d="M1 1l3 3 3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      {open ? (
        <div id={menuId} className="menu-popup" role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <MenuItems entries={entries} onChosen={() => close(false)} />
        </div>
      ) : null}
    </div>
  );
}
