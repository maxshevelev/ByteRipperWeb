import { workspaceIsEmpty } from "@/core/workspace/workspace";
import { allWorkspaceRecords } from "@/state/workspace/workspaceRecords";

/**
 * Which workspace this tab is: the id kept in `sessionStorage`, which is exactly per tab and
 * survives a reload — the bookmarks are kept under it — and, for a fresh tab, the one it takes up
 * (`Design/WORKSPACE.md`, "What launch is").
 *
 * @web-only a tab is the web's window; upstream has one workspace for the app
 */

export const WORKSPACE_KEY = "byteripper.workspace";
const LOCK_PREFIX = "byteripper-workspace:";

/** This tab's workspace id, made once and kept for as long as the tab lives. */
export function workspaceId(): string {
  try {
    const existing = sessionStorage.getItem(WORKSPACE_KEY);
    if (existing !== null) return existing;
    const made = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(WORKSPACE_KEY, made);
    return made;
  } catch {
    // Private mode, or storage refused. The workspace is then this page load, which is the honest
    // answer rather than sharing one id with every tab.
    return "w-transient";
  }
}

/** Whether this tab came with an id of its own: a reload, or a tab restored by the browser. */
function hasOwnId(): boolean {
  try {
    return sessionStorage.getItem(WORKSPACE_KEY) !== null;
  } catch {
    return false;
  }
}

let held: string | undefined;

/**
 * Holds this tab's workspace for as long as the tab is open, so a fresh tab does not take it up.
 * A lock is let go by the browser when the tab goes, crashed or closed.
 */
function hold(id: string): void {
  if (held === id) return;
  held = id;
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  void locks?.request(`${LOCK_PREFIX}${id}`, () => new Promise<void>(() => undefined));
}

/** The workspaces another open tab holds. */
async function heldElsewhere(): Promise<Set<string>> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined) return new Set();
  const state = await locks.query().catch(() => undefined);
  const names = [...(state?.held ?? []), ...(state?.pending ?? [])].map((one) => one.name ?? "");
  return new Set(
    names
      .filter((name) => name.startsWith(LOCK_PREFIX))
      .map((name) => name.slice(LOCK_PREFIX.length))
  );
}

/**
 * Settles which workspace this tab is, before anything reads it. A tab with an id keeps it. A fresh
 * tab, with the workspace coming back at all, takes up the workspace left most recently that no
 * open tab holds and that holds something; otherwise it starts a workspace of its own.
 */
export async function settleWorkspaceIdentity(restores: boolean): Promise<string> {
  if (!hasOwnId() && restores) {
    const [records, busy] = await Promise.all([allWorkspaceRecords(), heldElsewhere()]);
    const free = records
      .filter(
        ({ id, record }) =>
          !busy.has(id) && (record.project !== undefined || !workspaceIsEmpty(record.workspace))
      )
      .sort((left, right) => right.record.leftAt - left.record.leftAt)[0];
    if (free !== undefined) {
      try {
        sessionStorage.setItem(WORKSPACE_KEY, free.id);
      } catch {
        // Storage refused: the tab is a workspace of its own after all.
      }
    }
  }
  const id = workspaceId();
  hold(id);
  return id;
}
