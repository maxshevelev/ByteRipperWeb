import {
  type PaneState,
  type TabState,
  WORKSPACE_VERSION,
  type Workspace,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { PANE_IDS, type SlotId } from "@/state/paneId";
import { settingsStore } from "@/state/settingsStore";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import {
  readWorkspaceRecord,
  removeAllWorkspaceRecords,
  writeWorkspaceRecord,
} from "@/state/workspace/workspaceRecords";
import { paneState, workspaceStore } from "@/state/workspaceStore";
import { scrollLink } from "@/ui/pane/scrollLink";

/**
 * Keeps the workspace written down as the session goes (`Design/WORKSPACE.md`, "When it is
 * written"): a snapshot every two seconds while the page is in view, and when it goes out of view
 * or away, written only when it differs from what was last written. A crash of the tab must not
 * cost the workspace, so the record is kept up to date as the session changes, not only at the end.
 *
 * A timer rather than observers, as upstream argues: the caret, the scroll, the segments and the
 * tools change in a hundred places, a snapshot is a walk over two panes, and the compare keeps the
 * storage quiet.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder
 * @upstream-differs the page's own visibility and leaving in place of the app's resigning and quit
 */

/** @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.interval */
const INTERVAL_MS = 2000;

let lastWritten: string | undefined;
let paused = false;
/**
 * Set while a workspace waits for a click to reach its files: the tab is empty meanwhile, and an
 * empty tab written over the record would lose what is waiting.
 */
let keepsWaiting = false;

/**
 * Holds the recorder still while a restore puts things back, so a snapshot never writes a tab
 * half restored.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.isPaused
 */
export function pauseWorkspaceRecorder(on: boolean): void {
  paused = on;
}

/** The record holds a workspace waiting for its files; an empty tab must not replace it. */
export function keepWaitingWorkspace(on: boolean): void {
  keepsWaiting = on;
}

/**
 * The tab as it stands, and the handles of its files.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.snapshot
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspaceTab
 */
export function snapshotWorkspace(): {
  readonly workspace: Workspace;
  readonly handles: Record<string, FileSystemFileHandle>;
} {
  const handles: Record<string, FileSystemFileHandle> = {};
  const panes = PANE_IDS.map((slot) => paneSnapshot(slot, handles));
  const state = workspaceStore.getSnapshot();
  const tab: TabState = {
    panes,
    activePane: state.activePane === "b" ? 1 : 0,
    surface: { minimapVisible: false },
    fragments: [],
  };
  return { workspace: { version: WORKSPACE_VERSION, tab }, handles };
}

/**
 * One of the window's own panes: its file and where the reader was in it. A document that has no
 * file yet is left out until its bytes can be kept (W4).
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspacePane
 */
function paneSnapshot(
  slot: SlotId,
  handles: Record<string, FileSystemFileHandle>
): PaneState | undefined {
  const pane = paneState(slot);
  if (pane === undefined || pane.untitled) return undefined;
  const { file, document, typing } = pane;
  if (file.handle !== undefined) handles[slot] = file.handle;
  const { start, end } = document.selection;
  return {
    id: slot,
    document: {
      kind: "file",
      file: {
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        ...(file.path === undefined ? {} : { path: file.path }),
        ...(file.handle === undefined ? {} : { handle: slot }),
      },
    },
    selectionStart: start,
    selectionEnd: end,
    inputRegion: typing.inputRegion,
    insertMode: typing.isInsertMode,
    topOffset: scrollLink.visibleRange(slot, BYTES_PER_ROW)?.start ?? start,
  };
}

/**
 * Takes a snapshot and writes it when it differs from the last one written — and, when the tab is
 * being left, writes when it was left whatever the snapshot is.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.record
 */
export async function recordWorkspace(leaving = false): Promise<void> {
  if (paused || !settingsStore.getSnapshot().restoresWorkspace) return;
  const { workspace, handles } = snapshotWorkspace();
  if (keepsWaiting) {
    if (workspaceIsEmpty(workspace)) return;
    // A file opened by hand: the workspace that was waiting is given up for this one.
    keepsWaiting = false;
  }
  const text = JSON.stringify(workspace);
  if (text === lastWritten && !leaving) return;
  lastWritten = text;
  await writeWorkspaceRecord(workspaceId(), { workspace, leftAt: Date.now(), handles });
}

/**
 * Starts recording, and answers the means to stop. Switching the setting off forgets every
 * workspace, so one from months ago never comes back when it is switched on again.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.start
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applicationDidResignActive
 */
export function startWorkspaceRecorder(): () => void {
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void recordWorkspace();
  }, INTERVAL_MS);
  const leave = () => void recordWorkspace(true);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") leave();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", leave);
  let restores = settingsStore.getSnapshot().restoresWorkspace;
  const stopWatching = settingsStore.subscribe(() => {
    const now = settingsStore.getSnapshot().restoresWorkspace;
    if (now === restores) return;
    restores = now;
    lastWritten = undefined;
    if (!now) void removeAllWorkspaceRecords();
    else void recordWorkspace(true);
  });
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", leave);
    stopWatching();
  };
}

/** What this tab's record holds now, for the restore. */
export const readOwnWorkspace = () => readWorkspaceRecord(workspaceId());
