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
