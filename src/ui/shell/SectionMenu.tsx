import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { focusFirstItem, MenuItems, useMenuKeys } from "@/ui/shell/MenuItems";
import type { MenuSection } from "@/ui/shell/menuModel";

/**
 * The commands menu in the browser: the menu bar folded into one button, in
 * two levels where the bar has two places.
 *
 * The first level is the bar itself — the section names, each wearing the mark
 * that says a list opens from it. The second is the list of the section that
 * is open, hung beside its name: the drop-down the bar would drop, at the
 * side. That is the structure a reader of the macOS app carries — the names
 * where the names are, the commands where the commands are — and it is what
 * the flat list of every command under every name is being replaced by.
 *
 * What the levels share is the row: a command looks and behaves the same in
 * the flyout as in the right-click menu beside it, because it is the same
 * `MenuItems`. What a web page has no place for is left out of the list
 * itself (D11), so nothing here decides it.
 *
 * Keyboard-reachable throughout, in both levels: the arrows walk, the right
 * arrow and a return open a section, the left arrow and an escape give the
 * section back, and one more escape gives the menu back.
 *
 * @web-only the menu bar is the desktop shell's to draw (D15); a page keeps
 * the bar's structure in two levels of one menu
 */
export function SectionMenu({
  label,
  title,
  sections,
  ariaLabel,
}: {
  readonly label: React.ReactNode;
  readonly title: string;
  readonly sections: readonly MenuSection[];
  /** Where the label is a glyph, what the button is called. */
  readonly ariaLabel?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  /** The name of the section whose list is open, or none. */
  const [active, setActive] = useState<string | null>(null);
  /**
   * Which edge the first level hangs from: past the middle of the window and
   * it hangs from the button's right edge, or its words run off the window —
   * which is what every menu here asks of the button's place rather than
   * hard-coding (see `MenuButton`).
   */
  const [fromRight, setFromRight] = useState(false);
  /** The flyout's place, asked from the row that opened it; null while none is. */
  const [flyout, setFlyout] = useState<{ readonly top: number; readonly left: number } | null>(
    null
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLButtonElement>());
  const topId = useId();
  const flyoutId = useId();

  const show = useCallback(() => {
    const button = buttonRef.current;
    if (button !== null) {
      const at = button.getBoundingClientRect();
      setFromRight(at.left + at.width / 2 > window.innerWidth / 2);
    }
    setOpen(true);
  }, []);

  const closeAll = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setActive(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // A click anywhere else puts the menu away, which is what every menu does and
  // what stops one being left open over the work.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      closeAll(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, closeAll]);

  // Opening puts the keyboard on the first name, so the menu can be driven
  // without the pointer ever touching it.
  useEffect(() => {
    if (open) focusFirstItem(topRef.current);
  }, [open]);

  // The place is asked after the list is on screen: beside the row that opened
  // it, or on the row's other side where the window is too narrow for beside
  // it, and never further down than the window holds. The asking runs before
  // the first paint of the list, so it never stands at a wrong place for a
  // frame — and the keyboard is put on its first command while it runs.
  useLayoutEffect(() => {
    if (active === null) return;
    const row = sectionRefs.current.get(active);
    const list = flyoutRef.current;
    if (row === undefined || list === null) return;
    const from = row.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    const gap = 6;
    const beside = from.right + gap;
    setFlyout({
      top: Math.max(8, Math.min(from.top, window.innerHeight - box.height - 8)),
      left: beside + box.width > window.innerWidth - 8 ? from.left - box.width - gap : beside,
    });
  }, [active]);

  useEffect(() => {
    if (active !== null) focusFirstItem(flyoutRef.current);
  }, [active]);

  // Closes the list and gives the keyboard back to the row that opened it, so
  // one more escape gives the menu back rather than losing the place.
  const closeFlyout = useCallback(
    (returnFocus: boolean) => {
      if (returnFocus && active !== null) {
        const name = active;
        setActive(null);
        sectionRefs.current.get(name)?.focus();
        return;
      }
      setActive(null);
    },
    [active]
  );
  const flyoutKeys = useMenuKeys(flyoutRef, closeFlyout);
  const onFlyoutKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      // The left arrow gives the section back, as the menu bar's does.
      event.preventDefault();
      closeFlyout(true);
      return;
    }
    flyoutKeys(event);
  };

  const onTopKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAll(true);
      return;
    }
    const rows = sections
      .map((section) => sectionRefs.current.get(section.label))
      .filter((row): row is HTMLButtonElement => row !== undefined);
    if (rows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      rows[(at + step + rows.length) % rows.length]?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "Enter" && event.key !== " ") return;
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const name = sections[at]?.label;
    if (name === undefined) return;
    event.preventDefault();
    setActive(name);
  };

  const activeSection = sections.find((section) => section.label === active);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="toolbar-button menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? topId : undefined}
        title={title}
        onClick={() => (open ? closeAll(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        {label}
      </button>

      {open ? (
        <div
          id={topId}
          className="menu-popup menu-level"
          data-from={fromRight ? "right" : undefined}
          role="menu"
          ref={topRef}
          onKeyDown={onTopKeyDown}
        >
          {sections.map((section) => {
            const isOpen = active === section.label;
            return (
              <button
                key={section.label}
                type="button"
                ref={(node) => {
                  if (node === null) sectionRefs.current.delete(section.label);
                  else sectionRefs.current.set(section.label, node);
                }}
                className={`menu-item menu-section${isOpen ? " is-open" : ""}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={isOpen ? flyoutId : undefined}
                onClick={() => setActive(isOpen ? null : section.label)}
                onMouseEnter={() => setActive(section.label)}
              >
                <span className="menu-label">{section.label}</span>
                <svg
                  className="menu-arrow"
                  width="5"
                  height="8"
                  viewBox="0 0 5 8"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {/* Right from the middle: the list opens at the side, so the
                      mark points where it goes, where the pull-down's points
                      down from its button. */}
                  <path d="M1 1l3 3-3 3" />
                </svg>
              </button>
            );
          })}
        </div>
      ) : null}

      {open && activeSection !== undefined ? (
        <div
          id={flyoutId}
          className="menu-popup menu-flyout"
          role="menu"
          ref={flyoutRef}
          style={
            flyout === null
              ? { top: 0, left: 0, visibility: "hidden" }
              : { top: flyout.top, left: flyout.left }
          }
          onKeyDown={onFlyoutKeyDown}
        >
          <MenuItems entries={activeSection.items} onChosen={() => closeAll(false)} />
        </div>
      ) : null}
    </div>
  );
}
