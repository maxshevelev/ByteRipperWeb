import type { RefObject } from "react";
import { createStore } from "@/state/store";
import { useStore } from "@/state/useStore";

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
export const largeDetailStore = createStore<LargeDetailState>({ open: false });

export interface LargeDetailState {
  readonly open: boolean;
  /**
   * The table whose details the card shows: the one Space was pressed on, or the one beside the
   * pane whose corner button was clicked. Kept after the card closes, so the card that folds away
   * is still that panel's. Absent when the view was opened without one, and then every pane
   * answers to it, as before there was an owner.
   *
   * @web-only upstream's card is a view of one pane; here every details pane on the page reads
   * the same store, and a pane that is mounted but not this table's — a page of the Agent window
   * kept hidden under the one shown — must leave the card alone
   */
  readonly table?: HTMLElement | undefined;
}

/**
 * Opens the large view. False — the key is not taken — when there is nothing to show in
 * it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.showQuickLook
 */
export function showLargeDetail(hasDetail: boolean, keyTable?: HTMLElement | null): boolean {
  if (!hasDetail) return false;
  if (keyTable !== undefined) keyTarget = keyTable;
  const table = keyTable ?? undefined;
  largeDetailStore.update((state) =>
    state.open && state.table === table ? state : { open: true, table }
  );
  return true;
}

/**
 * Closes the large view: the pane opens again.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.closeQuickLook
 */
export function closeLargeDetail(): void {
  largeDetailStore.update((state) => (state.open ? { ...state, open: false } : state));
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

/**
 * Whether the card is the details of the panel `element` is in: the table that opened it is that
 * panel's (`keyTableNear`). True for every panel when the view was opened without a table.
 */
export function ownsLargeDetail(
  element: Element | null,
  state: LargeDetailState = largeDetailStore.getSnapshot()
): boolean {
  const table = state.table;
  if (table === undefined) return true;
  const near = keyTableNear(element);
  return near !== undefined && (near === table || near.contains(table) || table.contains(near));
}

/**
 * Whether the large view is open over the panel `ref` is in — its split folds the pane away for
 * it, and its details draw the card. A panel beside it, with a table of its own, stays as it is.
 */
export function useLargeDetailOf(ref: RefObject<Element | null>): boolean {
  const state = useStore(largeDetailStore);
  return state.open && ownsLargeDetail(ref.current, state);
}
