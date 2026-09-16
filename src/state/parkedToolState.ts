import type { PaneId } from "@/state/workspaceStore";

/**
 * The box each tool-module leaves its state in when its session stops being the
 * one on screen, so switching the panel between two of them is switching rather
 * than starting over (`Design/TOOL_MODULES_PLAN.md`).
 *
 * The box is opaque — the host stores what a session hands it and never looks
 * inside. What it does police is *whose* file the state describes: it is kept
 * against the pane the session was bound to, and dropped when that pane's
 * content is replaced or the pane goes, because a parked selection in a file
 * that has been reverted is a selection in a file that no longer exists.
 *
 * Two halves of one seam meet here. The *running* session keeps its answer to
 * "what would you hand back?" in `noteSessionParkedState`, because a browser
 * cannot ask a React component for a value at the moment it unmounts; the host
 * reads that answer as the session ends and files it here against the
 * identifier it was running under. The next session under that identifier takes
 * it out again as it starts.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSessionState
 */
export type ToolSessionState = object;

/**
 * A parked state and the file it was parked against.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.ParkedSession
 * @upstream-differs the pane is not a weak reference: upstream's box holds the
 * pane object and prunes the entries whose pane has gone, and a pane here is a
 * slot that is always there — the discard at the close and at the reload is the
 * whole of that rule
 */
interface ParkedSession {
  readonly state: ToolSessionState;
  readonly pane: PaneId;
}

/** @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.parked */
const parked = new Map<string, ParkedSession>();

/** What the running session last said it would hand back, and for which pane. */
let sessionParked: { readonly pane: PaneId; readonly state: ToolSessionState } | undefined;

/**
 * The running session's own state, so the host can file it when the session
 * ends — upstream reads `ToolSession.parkedState` at that moment.
 *
 * Called after every commit by the panel that owns the state, and thrown away
 * with the session that wrote it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.parkedState
 * @web-only a React panel cannot be asked for a value as it unmounts, so it says so here as it renders instead, and the host reads it as the session ends
 */
export function noteSessionParkedState(pane: PaneId, state: ToolSessionState): void {
  sessionParked = { pane, state };
}

/**
 * The running session's state, taken — the park and the forget in one, because
 * a session that has been asked has nothing more to say.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.parkedState
 * @web-only the host cannot reach the panel that holds the state: it reads the copy the panel left in `noteSessionParkedState`
 */
export function takeSessionParkedState(pane: PaneId): ToolSessionState | undefined {
  const held = sessionParked;
  sessionParked = undefined;
  return held !== undefined && held.pane === pane ? held.state : undefined;
}

/**
 * Forgets that any session is talking about a parked state.
 *
 * Called as a session starts, so the answer standing there belongs to the
 * session that is now running and to no earlier one.
 *
 * @web-only the panel says so after its first commit, and the host cannot tell
 * a fresh panel from a stale copy without this
 */
export function forgetSessionParkedState(): void {
  sessionParked = undefined;
}

/**
 * Keeps what the running session handed back, against the pane it was bound to.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.endSession
 * @web-only the caller parks explicitly: upstream reads the session's own `parkedState` as it ends, and the panel here has left its answer in `noteSessionParkedState`
 */
export function parkToolState(identifier: string, pane: PaneId, state: ToolSessionState): void {
  parked.set(identifier, { state, pane });
}

/**
 * The state `identifier`'s last session left, if it was left against `pane`.
 *
 * Consumed rather than copied: from here the session owns it, and what comes
 * back next time is whatever that session decides to leave. A state parked
 * against the other pane is a state about another file — nothing to hand over,
 * and not kept for later either.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.startSession
 */
export function takeParkedToolState(
  identifier: string,
  pane: PaneId
): ToolSessionState | undefined {
  const entry = parked.get(identifier);
  if (entry === undefined) return undefined;
  parked.delete(identifier);
  return entry.pane === pane ? entry.state : undefined;
}

/**
 * Forgets what every tool-module parked against `pane`.
 *
 * Called after the session has ended rather than before, so the one that is
 * stopping cannot park the state we are here to drop.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.discardParkedState
 */
export function discardParkedStateFor(pane: PaneId): void {
  for (const [identifier, entry] of parked) {
    if (entry.pane === pane) parked.delete(identifier);
  }
}

/**
 * Which tool-modules have something parked, for a test that would otherwise
 * have to reopen a file to find out.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.parkedModuleIdentifiers
 */
export function parkedModuleIdentifiers(): readonly string[] {
  return [...parked.keys()];
}
