import { useLayoutEffect } from "react";
import { noteSessionParkedState, type ToolSessionState } from "@/state/parkedToolState";
import type { PaneId } from "@/state/workspaceStore";

/**
 * Keeps the host's box in step with what this session would hand back.
 *
 * The session's state on this side of the port is the panel's own `useState`s,
 * so this runs after every commit and the last one before the panel unmounts is
 * the answer the host reads as the session ends — which is the moment upstream
 * reads `ToolSession.parkedState` at.
 *
 * A layout effect rather than a passive one: the host files the state in the
 * same turn as the gesture that ends the session, and a passive effect can
 * still be waiting when that gesture arrives.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.parkedState
 * @web-only a React panel cannot be asked for a value as it unmounts, so it says what it would hand back after every commit instead
 */
export function useParkedToolState(pane: PaneId, keep: () => ToolSessionState): void {
  useLayoutEffect(() => {
    noteSessionParkedState(pane, keep());
  });
}
