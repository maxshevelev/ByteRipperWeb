import { createStore } from "@/state/store";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";
import { EMPTY_ZONES, normalizedZones, type ZoneMap } from "@/tools/zone";

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

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.publish
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toolZonesChanged
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncMinimapZones
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setZones
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.publish
 */
export function publishZones(pane: PaneId, zones: ZoneMap): void {
  // Repaired against the file as it is now: the map is a re-read behind an
  // edit that may have shortened it.
  const size = workspaceStore.getSnapshot().panes[pane]?.document.size;
  const drawable = size === undefined ? zones : normalizedZones(zones, size);
  zoneStore.update((state) => ({ panes: { ...state.panes, [pane]: drawable } }));
}

export function clearZones(pane: PaneId): void {
  publishZones(pane, EMPTY_ZONES);
}

/**
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.zones
 * @upstream-differs the zones live in a store keyed by pane, not on the controller
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.zones
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexZoneSpans
 */
export function zonesFor(pane: PaneId): ZoneMap {
  return zoneStore.getSnapshot().panes[pane];
}
