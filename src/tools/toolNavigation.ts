import { useEffect, useRef } from "react";
import { registerToolNavigation, type ToolNavigationHandle } from "@/state/toolNavigation";
import type { PaneId } from "@/state/workspaceStore";

/**
 * Hands the window what the navigation history keeps of this panel while its session is open:
 * the row in focus, how to choose it again with its zones, and how to give its table the
 * keyboard (§10.6).
 *
 * The handle is read through a ref that every commit refreshes, so the window always asks the
 * panel as it is now; the session ending keeps the choice for the next one
 * (`ToolController.closedChoice`).
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.navigationMark
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.showNavigationMark
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.focusChoice
 * @web-only a React panel cannot be called by the window, so it hands the window a handle instead
 */
export function useToolNavigation(
  pane: PaneId,
  module: string,
  handle: ToolNavigationHandle
): void {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(
    () =>
      registerToolNavigation(pane, module, {
        mark: () => latest.current.mark(),
        show: (mark) => latest.current.show(mark),
        focus: () => latest.current.focus(),
      }),
    [pane, module]
  );
}
