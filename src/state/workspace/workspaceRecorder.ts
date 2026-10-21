import {
  type FileStamp,
  type PaneState,
  type SegmentationState,
  type SurfaceState,
  type TabState,
  WORKSPACE_VERSION,
  type Workspace,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { mapOn, minimapStore } from "@/state/minimapStore";
import { PANE_IDS, type SlotId, type SurfaceId, WORKSPACE_SURFACE } from "@/state/paneId";
import { searchStore } from "@/state/searchStore";
import { sourceInfo } from "@/state/segmentSources";
import { segmentsFor } from "@/state/segmentsStore";
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
  const search = searchStore.getSnapshot();
  const tab: TabState = {
    panes,
    activePane: state.activePane === "b" ? 1 : 0,
    surface: {
      ...surfaceSnapshot(WORKSPACE_SURFACE),
      ...(search.open ? { findPattern: { text: search.query, encoding: search.encoding } } : {}),
    },
    fragments: [],
  };
  return { workspace: { version: WORKSPACE_VERSION, tab }, handles };
}

/**
 * The minimap of a surface: whether it is shown, and in which mode.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspaceSurface
 */
function surfaceSnapshot(surface: SurfaceId): SurfaceState {
  const map = mapOn(minimapStore.getSnapshot(), surface);
  return map.visible ? { minimapVisible: true, minimapMode: map.mode } : { minimapVisible: false };
}

/**
 * A file as the workspace writes it: what it was like, and the key of its handle, kept in
 * `handles`, where the browser gave one.
 */
function stampOf(
  file: OpenedFile,
  key: string,
  handles: Record<string, FileSystemFileHandle>
): FileStamp {
  if (file.handle !== undefined) handles[key] = file.handle;
  return {
    name: file.name,
    size: file.size,
    modified: file.lastModified,
    ...(file.path === undefined ? {} : { path: file.path }),
    ...(file.handle === undefined ? {} : { handle: key }),
  };
}

/**
 * The pane's partition, or nothing when the file is one piece of itself — nothing worth writing
 * down. Each link is written by its source's file, not by the id this page minted for it.
 *
 * @upstream ByteRipperApp/Workspace/PaneViewModel+Workspace.swift#PaneViewModel.workspaceSegments
 */
function segmentsSnapshot(
  slot: SlotId,
  handles: Record<string, FileSystemFileHandle>
): SegmentationState | undefined {
  const current = segmentsFor(slot);
  const fileName = paneState(slot)?.name;
  const only = current?.pieces[0];
  if (current === undefined || only === undefined) return undefined;
  if (
    current.pieces.length === 1 &&
    only.link === undefined &&
    (only.name === "" || only.name === fileName)
  ) {
    return undefined;
  }
  return {
    contentSize: current.contentSize,
    pieces: current.pieces.map((piece) => {
      const link = piece.link;
      const source = link === undefined ? undefined : sourceInfo(slot, link.source);
      return {
        start: piece.start,
        name: piece.name,
        ...(link === undefined || source === undefined
          ? {}
          : {
              link: {
                file: stampOf(source.file, `${slot}:link:${link.source.raw}`, handles),
                sourceStart: link.start,
                sourceEnd: link.end,
              },
            }),
      };
    }),
  };
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
  const { start, end } = document.selection;
  const segments = segmentsSnapshot(slot, handles);
  return {
    id: slot,
    document: { kind: "file", file: stampOf(file, slot, handles) },
    ...(segments === undefined ? {} : { segments }),
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
