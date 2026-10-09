import type { PaneId } from "@/state/paneId";

/**
 * The live panels an agent can act in: a tool-module's open session, by the pane it reads, handing
 * over what its actions need — choose a node, say which one the reader chose
 * (`ToolAgentAction`).
 *
 * A panel registers while it is mounted and takes itself back when it unmounts, so "the panel is
 * not open on this document" is a lookup that finds nothing.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.session
 * @web-only a module's session is a mounted component; this is how an action reaches it
 */
const sessions = new Map<string, unknown>();

const keyOf = (pane: PaneId, module: string) => `${pane}\u0000${module}`;

/** A session is open on `pane`; returns what takes it back. */
export function registerAgentSession(pane: PaneId, module: string, session: unknown): () => void {
  const key = keyOf(pane, module);
  sessions.set(key, session);
  return () => {
    if (sessions.get(key) === session) sessions.delete(key);
  };
}

/** The live session of `module` on `pane`, if there is one. */
export const agentSessionOn = (pane: PaneId, module: string): unknown =>
  sessions.get(keyOf(pane, module));

/** Forgets every session: a test's. */
export const resetAgentSessions = (): void => sessions.clear();
