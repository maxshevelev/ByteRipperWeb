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
 * What the shell does when a tool puts a zone in focus.
 *
 * A zone a tool has just focused is a range the user is being shown, so the
 * dump goes to it — the scroll only, and only when it is not on screen
 * already, since moving the rows under a reader who can already see them is
 * worse than no scroll at all. Every tool gets this rather than each remembering
 * to ask, and a republish that focuses the same zone scrolls nothing.
 *
 * Set once by the app; absent under tests.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showZoneStartForTool
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealOffsetIfOffScreen
 */
export const zoneHooks: {
  onZoneFocused?: ((pane: PaneId, offset: number) => void) | undefined;
} = {};

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.publish
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toolZonesChanged
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncMinimapZones
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setZones
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.publish
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.publish
 */
export function publishZones(pane: PaneId, zones: ZoneMap): void {
  // Repaired against the file as it is now: the map is a re-read behind an
  // edit that may have shortened it.
  const size = workspaceStore.getSnapshot().panes[pane]?.document.size;
  const drawable = size === undefined ? zones : normalizedZones(zones, size);
  const previousFocus = zonesFor(pane).focus;
  zoneStore.update((state) => ({ panes: { ...state.panes, [pane]: drawable } }));

  // What the user is being shown, which is what the dump should be looking at.
  // A focus naming nothing that survived the repair above is not one — nothing
  // can be pointed at that the file no longer contains.
  const focus = drawable.focus;
  if (focus === undefined || focus === previousFocus) return;
  const zone = drawable.zones.find((one) => one.id === focus);
  if (zone === undefined) return;
  zoneHooks.onZoneFocused?.(pane, zone.start);
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
