import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createStore } from "@/state/store";
import { useStore } from "@/state/useStore";
import { focusFirstItem, MenuItems, useMenuKeys } from "@/ui/shell/MenuItems";
import { compactEntries, type MenuEntry } from "@/ui/shell/menuModel";

/**
 * The right-click menu.
 *
 * One at a time, for the whole application, which is what a context menu is:
 * opening a second closes the first, and there is exactly one place that knows
 * how to place a popup against the edges of the window. So it is a store and a
 * host rather than a component each caller mounts — a caller only says what the
 * commands are, at the moment of the click, which is also the moment the
 * answer is true.
 *
 * Upstream pops these with `NSMenu.popUpContextMenu`, which runs a *blocking*
 * tracking loop. Nothing in a browser blocks, so the caller does whatever
 * upstream does around that call — placing the caret at the right-clicked byte,
 * framing it while the menu is up — through {@link ContextMenuRequest.onClose}.
 */

export interface ContextMenuRequest {
  readonly entries: readonly MenuEntry[];
  readonly x: number;
  readonly y: number;
  /** Run when the menu goes away, whether or not a command was chosen. */
  readonly onClose?: (() => void) | undefined;
}

const contextMenuStore = createStore<ContextMenuRequest | undefined>(undefined);

/**
 * Opens the menu at the pointer, and says whether one appeared.
 *
 * A menu with nothing in it is not opened at all: the browser's own menu is
 * better than an empty box, so the event is left alone. The answer is what a
 * caller needs to know before it does anything around the menu — the pane
 * frames the right-clicked byte only while a menu is really up (§10.2).
 */
export function openContextMenu(
  event: { clientX: number; clientY: number; preventDefault: () => void },
  entries: readonly (MenuEntry | undefined)[],
  onClose?: () => void
): boolean {
  const compacted = compactEntries(entries);
  if (compacted.length === 0) return false;
  event.preventDefault();
  contextMenuStore.getSnapshot()?.onClose?.();
  contextMenuStore.update(() => ({
    entries: compacted,
    x: event.clientX,
    y: event.clientY,
    onClose,
  }));
  return true;
}

export function closeContextMenu(): void {
  const open = contextMenuStore.getSnapshot();
  if (open === undefined) return;
  contextMenuStore.update(() => undefined);
  open.onClose?.();
}

/** Mounted once by the shell. */
export function ContextMenuHost() {
  const request = useStore(contextMenuStore);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | undefined>(undefined);

  const close = useCallback(() => closeContextMenu(), []);
  const onKeyDown = useMenuKeys(menuRef, close);

  // Measured after it is in the document and before it is painted, so a menu
  // opened near the right edge is never seen in the wrong place first.
  useLayoutEffect(() => {
    if (request === undefined) {
      setPlace(undefined);
      return;
    }
    const box = menuRef.current?.getBoundingClientRect();
    const width = box?.width ?? 0;
    const height = box?.height ?? 0;
    const margin = 4;
    // Flipped rather than clamped: a menu pushed back from the edge would sit
    // under the pointer, and the first item is then under the finger that
    // opened it.
    const left =
      request.x + width + margin > window.innerWidth
        ? Math.max(margin, request.x - width)
        : request.x;
    const top =
      request.y + height + margin > window.innerHeight
        ? Math.max(margin, request.y - height)
        : request.y;
    setPlace({ left, top });
  }, [request]);

  useEffect(() => {
    if (request === undefined) return;
    focusFirstItem(menuRef.current);
  }, [request]);

  useEffect(() => {
    if (request === undefined) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = menuRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      closeContextMenu();
    };
    // A scroll or a resize moves what the menu was opened against, so the menu
    // stops meaning what it meant.
    const dismiss = () => closeContextMenu();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [request]);

  if (request === undefined) return null;

  // Inside the open modal dialog, when there is one: everything outside a modal
  // <dialog> is inert and drawn beneath it, so a menu opened on a row of a
  // dialog's list would be neither visible nor clickable anywhere else.
  const modal = openModalDialog();

  const menu = (
    <div
      className="menu-popup context-menu"
      role="menu"
      ref={menuRef}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        left: place?.left ?? request.x,
        top: place?.top ?? request.y,
        // Hidden for the one frame between mounting and being measured.
        visibility: place === undefined ? "hidden" : "visible",
      }}
    >
      <MenuItems entries={request.entries} onChosen={close} />
    </div>
  );

  return modal === null ? menu : createPortal(menu, modal);
}

/** The topmost modal dialog on screen, if any. */
function openModalDialog(): Element | null {
  try {
    const modals = document.querySelectorAll("dialog:modal");
    return modals.length === 0 ? null : (modals[modals.length - 1] ?? null);
  } catch {
    // A browser without `:modal`: an open dialog is the nearest answer.
    return document.querySelector("dialog[open]");
  }
}
