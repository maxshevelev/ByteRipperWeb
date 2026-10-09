import type { PaneId } from "@/state/paneId";

/**
 * What only the shell can do on an agent's behalf: show a place in a pane. Set by the app's
 * shell once it is up, as `editingHooks` are; absent under tests, which stand their own in.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealForTool
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.bringForward
 * @web-only the shell's reveal is React state; the service is not React
 */
export const agentShell: {
  /**
   * Brings the pane to the front — the part's panel raised, or the stage cleared for a file's
   * own pane — and shows `[start, end)` in it, selecting it when asked: as a tool's reveal does.
   */
  reveal?: ((pane: PaneId, start: number, end: number, select: boolean) => void) | undefined;
} = {};
