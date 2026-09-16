import { useEffect, useRef } from "react";
import {
  takeZoneSelection,
  type ZoneSelectionRequest,
  zoneSelectionStore,
} from "@/state/toolController";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";

/**
 * The zone the user picked in the dump or on the minimap's gutter, handed back
 * to the panel that published it.
 *
 * This is the one direction the zone seam does not otherwise have: everything
 * else goes from the tool outwards. The shell has already selected the bytes —
 * what is left is the half only the tool knows, which is bringing the thing the
 * zone stands for to the front of its own panel.
 *
 * Two guards, both for the same reason. The request is cleared as it is read, so
 * it is acted on once and no later panel can find it; and the request object is
 * remembered here, because React runs a mount effect twice and the panel would
 * otherwise open the same branch twice over.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.zoneSelected
 * @web-only a session is an object the host can call; a React panel is not, so the request arrives through a store and is read from an effect
 */
export function useZoneSelection(pane: PaneId, onZone: (zoneId: string) => void): void {
  const request = useStore(zoneSelectionStore).request;
  const handled = useRef<ZoneSelectionRequest | undefined>(undefined);
  // Kept current so the effect below does not have to re-run — and so not have
  // to re-read the request — every time the caller's closure changes.
  const latest = useRef(onZone);
  latest.current = onZone;

  useEffect(() => {
    if (request === undefined || request.pane !== pane || handled.current === request) return;
    handled.current = request;
    takeZoneSelection();
    latest.current(request.zoneId);
  }, [request, pane]);
}
