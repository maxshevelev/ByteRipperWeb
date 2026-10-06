import { createStore } from "@/state/store";

/**
 * Whether a panel's details are open in the large view: the card over the window,
 * and the pane under the table folded away.
 *
 * A panel's detail list keeps growing — a descriptor's straps, a store's variable
 * history, a picture — and the lower third of a panel beside the dump is a keyhole
 * onto it. **Space** on the row in focus, or the expand button in the list's corner,
 * opens the same list as a large card over the window; **Space** again, **Esc**, the
 * close button in the corner, a click outside the card or a link followed from it
 * closes it. While it is open the arrow keys still move the table's selection, and the
 * card follows.
 *
 * One at a time: the card is the window's, and the panels take turns.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane
 * @upstream-differs a store the panel's detail and its split read, where upstream's
 * pane is a view that moves its own list into a card and animates the splitter: the
 * browser has no list to move, so the card renders the same list again, and nothing
 * flies
 */
// @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.isQuickLookShown
export const largeDetailStore = createStore<{ readonly open: boolean }>({ open: false });

/**
 * Opens the large view. False — the key is not taken — when there is nothing to show in
 * it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.showQuickLook
 */
export function showLargeDetail(hasDetail: boolean, keyTable?: HTMLElement | null): boolean {
  if (!hasDetail) return false;
  if (keyTable !== undefined) keyTarget = keyTable;
  largeDetailStore.update((state) => (state.open ? state : { open: true }));
  return true;
}

/**
 * Closes the large view: the pane opens again.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.closeQuickLook
 */
export function closeLargeDetail(): void {
  largeDetailStore.update((state) => (state.open ? { open: false } : state));
}

/**
 * Opens the large view, or closes it. False when it is shut and there is nothing to
 * show.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.toggleQuickLook
 */
export function toggleLargeDetail(hasDetail: boolean, keyTable?: HTMLElement | null): boolean {
  if (largeDetailStore.getSnapshot().open) {
    closeLargeDetail();
    return true;
  }
  return showLargeDetail(hasDetail, keyTable);
}

/**
 * The panel's table, which the arrow keys belong to while the card is shown: the card
 * is the window's, so a key pressed with the focus in it is handed on to the table that
 * opened it, and the card follows the row it moves to.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.handleKeyWhileShown
 */
let keyTarget: HTMLElement | null | undefined;

export const largeDetailKeyTable = (): HTMLElement | undefined =>
  keyTarget?.isConnected === true
    ? keyTarget
    : (document.querySelector<HTMLElement>("[data-key-table]") ?? undefined);

/**
 * The table of the panel an element is in: the nearest ancestor that holds one marked
 * `data-key-table`.
 */
export function keyTableNear(element: Element | null): HTMLElement | undefined {
  for (let at = element; at !== null; at = at.parentElement) {
    const table = at.querySelector<HTMLElement>("[data-key-table]");
    if (table !== null) return table;
  }
  return undefined;
}
