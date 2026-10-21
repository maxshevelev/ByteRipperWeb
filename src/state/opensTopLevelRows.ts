import { createStore } from "@/state/store";
import type { PaneId } from "@/state/workspaceStore";

/**
 * The UEFI panel is to open the tree's top level the first time it shows it: the pane holds a
 * part opened out of another file's UEFI tree, whose first level is what the reader opened it
 * to see. Taken once, so the rows the reader shuts again stay shut.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.opensTopLevelUEFIRows
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITreeProviding.swift#UEFITreeProviding.takeOpensTopLevelUEFIRows
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.takeOpensTopLevelUEFIRows
 * @upstream-differs a set kept beside the stores, where upstream keeps the flag on the pane's
 * UEFI state
 */
const wished = new Set<PaneId>();

/** The pane holds a part opened out of another tree. */
export function wishTopLevelRowsOpen(pane: PaneId): void {
  wished.add(pane);
}

/** Whether the panel should open its top level now — true only the first time asked. */
export function takeOpensTopLevelRows(pane: PaneId): boolean {
  return wished.delete(pane);
}

/** A node to show: the one whose bytes are `[start, end)`, else the innermost holding `start`. */
export interface ShowItemWish {
  readonly start: number;
  readonly end: number | undefined;
  /**
   * The node put in focus as a click on its row would — selected, and its zone outlined in the
   * dump — rather than only shown: an entry of a LENV block opened as the block decoded.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.focusItem
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.focusItem
   */
  readonly focus?: boolean | undefined;
}

/**
 * The UEFI panel is to show a node of the part: a part opened from a Contents search match or an
 * annotation's place, its tree opened to the node — the branches on the way open, its row
 * selected. A store, so a panel already up hears a wish made after its tree was shown, as one
 * raised again from a second double-click does; taken once, so the reader's own moves stand.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.showItem
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.showItem
 * @upstream-differs a wish kept beside the stores, as the top level's is, where upstream asks the
 * part's session once its panel is up
 */
export const showItemWishes = createStore<ReadonlyMap<PaneId, ShowItemWish>>(new Map());

/** The panel on `pane` is to show the node at `start` — the one spanning to `end`, where given. */
export function wishShowItemAt(pane: PaneId, start: number, end?: number): void {
  showItemWishes.update((wishes) => new Map(wishes).set(pane, { start, end }));
}

/** The panel on `pane` is to put the node at `offset` in focus. */
export function wishFocusItemAt(pane: PaneId, offset: number): void {
  showItemWishes.update((wishes) =>
    new Map(wishes).set(pane, { start: offset, end: undefined, focus: true })
  );
}

/** The node the panel on `pane` is to show now — given only the first time asked. */
export function takeShowItemAt(pane: PaneId): ShowItemWish | undefined {
  const wish = showItemWishes.getSnapshot().get(pane);
  if (wish === undefined) return undefined;
  showItemWishes.update((wishes) => {
    const next = new Map(wishes);
    next.delete(pane);
    return next;
  });
  return wish;
}
