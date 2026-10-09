import { useEffect, useRef } from "react";
import { registerAgentSession } from "@/state/agent/agentSessions";
import type { PaneId } from "@/state/paneId";

/**
 * Makes a mounted panel reachable by an agent's actions: it registers its handle while it is on the
 * pane, and the handle is read through a ref, so what an action calls is always the panel's present
 * state.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.session
 * @web-only a module's session is a mounted component
 */
export function useAgentSession<Session extends object>(
  pane: PaneId,
  module: string,
  session: Session
): void {
  const latest = useRef(session);
  latest.current = session;
  useEffect(() => {
    // A stable proxy: every call goes to the latest handle the panel rendered.
    const proxy = new Proxy({} as Session, {
      get: (_target, key) => (latest.current as Record<PropertyKey, unknown>)[key],
    });
    return registerAgentSession(pane, module, proxy);
  }, [pane, module]);
}
