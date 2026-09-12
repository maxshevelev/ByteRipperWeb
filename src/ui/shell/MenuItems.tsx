import { useCallback } from "react";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * The rows of a menu, and the arrow keys that walk them.
 *
 * Shared by the toolbar's drop-down and every right-click menu, so a command
 * looks and behaves the same whichever one it was reached through.
 */

export function MenuItems({
  entries,
  onChosen,
}: {
  readonly entries: readonly MenuEntry[];
  readonly onChosen: () => void;
}) {
  return (
    <>
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
            className={`menu-item${entry.destructive === true ? " is-destructive" : ""}`}
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
              onChosen();
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
    </>
  );
}

/**
 * Escape closes, the arrows walk, and both wrap round.
 *
 * A menu only a pointer can drive is a set of commands some people cannot reach
 * at all, so this is not optional decoration.
 */
export function useMenuKeys(
  menu: React.RefObject<HTMLElement | null>,
  close: (returnFocus: boolean) => void
) {
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
      ];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(at + step + items.length) % items.length];
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: "nearest" });
    },
    [menu, close]
  );
}

/** Puts the keyboard on a menu's first command once it is on screen. */
export function focusFirstItem(menu: HTMLElement | null): void {
  // Without preventScroll the browser scrolls the item into view — and with a
  // popup taller than what it hangs from, what it scrolls is the page.
  menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}
