import { createStore } from "@/state/store";
import type { PaneId } from "@/state/workspaceStore";
import { EMPTY_ZONES, type ZoneMap } from "@/tools/zone";

/**
 * The ranges the open tool wants drawn, per pane.
 *
 * Published by the tool and read by the shell — the minimap's gutter, the
 * dump's right-click menu — which is the whole of what a tool asks the
 * application to draw. The shell never sees a node.
 *
 * Cleared when the panel closes: a gutter still marking a tool nobody has open
 * is a promise about bytes nothing is watching any more.
 */

export interface ZoneState {
  readonly panes: Readonly<Record<PaneId, ZoneMap>>;
}

export const zoneStore = createStore<ZoneState>({
  panes: { a: EMPTY_ZONES, b: EMPTY_ZONES },
});

export function publishZones(pane: PaneId, zones: ZoneMap): void {
  zoneStore.update((state) => ({ panes: { ...state.panes, [pane]: zones } }));
}

export function clearZones(pane: PaneId): void {
  publishZones(pane, EMPTY_ZONES);
}

export function zonesFor(pane: PaneId): ZoneMap {
  return zoneStore.getSnapshot().panes[pane];
}
