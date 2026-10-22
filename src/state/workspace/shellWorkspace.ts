import {
  desktopWorkspace,
  type ShellProject,
  windowLaunch,
} from "@/platform/desktop/desktopWindows";
import { settingsStore } from "@/state/settingsStore";
import { unsavedPanesLostToLeaving } from "@/state/unsavedWork";
import { startOpenOnce } from "@/state/workspace/openOnce";
import {
  askToSaveSession,
  confirmDiscardingSession,
  discardSessionForProject,
  followProject,
  sessionHoldsAnything,
} from "@/state/workspace/projects";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import { recordWorkspace } from "@/state/workspace/workspaceRecorder";
import {
  allWorkspaceRecords,
  removeKeptBytesExcept,
  removeWorkspaceRecord,
} from "@/state/workspace/workspaceRecords";

/**
 * This window's part in the desktop shell's one workspace over every window
 * (`Design/DESKTOP_WINDOWS.md`, D2). The shell keeps the windows front to back with their frames
 * and ids; the page tells it which workspace it is and whether it records it, writes its last
 * snapshot when the app quits and says whether it holds work it must ask about, and forgets the
 * record of a window closed for good.
 *
 * Called by the shell through the page's own window — as a menu command is — since the shell asks
 * and waits for the answer: `executeJavaScript` hands back what the function's promise settles to.
 *
 * @web-only a browser tab is one workspace of its own; the shell's windows are one
 */

/** What the shell calls on the page's window (`desktop/windows.cjs`, `call`). */
interface ShellAnswers {
  quit(): Promise<{ readonly asks: boolean }>;
  forget(id: string): Promise<void>;
  holdsAnything(): boolean;
  askSaveSession(): Promise<"save" | "discard" | "cancel">;
  confirmDiscard(): boolean;
  discard(): Promise<void>;
  projectChanged(project: ShellProject | null, fromSession: boolean): Promise<boolean>;
}

/**
 * The quit's question to this window: its last snapshot written, and whether it holds work the
 * workspace could not keep, which the shell then asks about over it before any window goes.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.recordFinal
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.askBeforeQuitting
 */
export async function answerQuit(): Promise<{ readonly asks: boolean }> {
  await recordWorkspace(true).catch(() => false);
  return { asks: unsavedPanesLostToLeaving().length > 0 };
}

/**
 * A window closed while others stay has left the workspace: its record and what it kept go.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.snapshot
 * @upstream-differs a window gone is not in upstream's next snapshot; here its own record is a
 *   record of its own, removed by a window that stays
 */
export async function forgetWorkspace(id: string): Promise<void> {
  if (id === workspaceId()) return;
  await removeWorkspaceRecord(id);
  await removeKeptBytesExcept(id, new Set());
}

/** The records of windows the app no longer holds, gone: the launch said which it still does. */
export async function forgetWorkspacesExcept(keep: readonly string[]): Promise<void> {
  const held = new Set([...keep, workspaceId()]);
  for (const { id } of await allWorkspaceRecords()) {
    if (!held.has(id)) await forgetWorkspace(id);
  }
}

/** Joins the shell's workspace: says which this window is, and answers the shell's questions. */
export function startShellWorkspace(): () => void {
  const bridge = desktopWorkspace();
  if (bridge === undefined) return () => {};
  const hooks = window as typeof window & { __byteripperShell?: ShellAnswers };
  hooks.__byteripperShell = {
    quit: answerQuit,
    forget: forgetWorkspace,
    holdsAnything: sessionHoldsAnything,
    askSaveSession: askToSaveSession,
    confirmDiscard: confirmDiscardingSession,
    discard: discardSessionForProject,
    projectChanged: followProject,
  };
  const leaveOpenOnce = startOpenOnce();
  let restores = settingsStore.getSnapshot().restoresWorkspace;
  bridge.hold(workspaceId(), restores);
  const stop = settingsStore.subscribe(() => {
    const now = settingsStore.getSnapshot().restoresWorkspace;
    if (now === restores) return;
    restores = now;
    bridge.hold(workspaceId(), restores);
  });
  const keep = windowLaunch()?.keep;
  if (keep !== undefined && restores) void forgetWorkspacesExcept(keep);
  return () => {
    stop();
    leaveOpenOnce();
    delete hooks.__byteripperShell;
  };
}
