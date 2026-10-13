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

const itemsWished = new Map<PaneId, number>();

/**
 * The UEFI panel is to show the node holding `offset` of the part the first time its tree is
 * shown: a part opened from a Contents search match, its tree opened to the node the match is in.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.showItem
 * @upstream-differs a wish kept beside the stores, as the top level's is, where upstream asks the
 * part's session once its panel is up
 */
export function wishShowItemAt(pane: PaneId, offset: number): void {
  itemsWished.set(pane, offset);
}

/** The offset whose node the panel is to show now — given only the first time asked. */
export function takeShowItemAt(pane: PaneId): number | undefined {
  const offset = itemsWished.get(pane);
  itemsWished.delete(pane);
  return offset;
}
