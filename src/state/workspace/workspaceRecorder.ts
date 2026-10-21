import type { BinaryDocument } from "@/core/document/binaryDocument";
import {
  type DocumentSource,
  type FileStamp,
  type FragmentState,
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
import {
  PANE_IDS,
  type PaneId,
  partPane,
  type SlotId,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
} from "@/state/paneId";
import { searchStore } from "@/state/searchStore";
import { sourceInfo } from "@/state/segmentSources";
import { segmentsFor } from "@/state/segmentsStore";
import { settingsStore } from "@/state/settingsStore";
import { partCodecState } from "@/state/workspace/partCodecState";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import {
  readWorkspaceRecord,
  removeAllKeptBytes,
  removeAllWorkspaceRecords,
  removeKeptBytesExcept,
  writeKeptBytes,
  writeWorkspaceRecord,
} from "@/state/workspace/workspaceRecords";
import { exportKeptEdits, paneState, workspaceStore } from "@/state/workspaceStore";
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
export async function snapshotWorkspace(): Promise<{
  readonly workspace: Workspace;
  readonly handles: Record<string, FileSystemFileHandle>;
  readonly keeps: readonly KeptWrite[];
}> {
  const handles: Record<string, FileSystemFileHandle> = {};
  const keeps: KeptWrite[] = [];
  const panes = PANE_IDS.map((slot) => paneSnapshot(slot, handles, keeps));
  const state = workspaceStore.getSnapshot();
  const { fragments, expandedFragment } = await fragmentsSnapshot(
    new Set(PANE_IDS.filter((_, index) => panes[index] !== undefined)),
    keeps
  );
  const search = searchStore.getSnapshot();
  const tab: TabState = {
    panes,
    activePane: state.activePane === "b" ? 1 : 0,
    surface: {
      ...surfaceSnapshot(WORKSPACE_SURFACE),
      ...(search.open ? { findPattern: { text: search.query, encoding: search.encoding } } : {}),
    },
    fragments,
    ...(expandedFragment === undefined ? {} : { expandedFragment }),
  };
  return { workspace: { version: WORKSPACE_VERSION, tab }, handles, keeps };
}

/**
 * The panels over the tab, in the dock's order — a parent before the parts taken out of it, a
 * part being opened after the pane it came from. A part whose parent is written down is written as
 * where it came from, and taken out again at restore; one with no parent, a parent not written
 * down or a codec this cannot write, as untitled bytes: it comes back without its way home. A part
 * with changes its parent has not got keeps them, laid over what the parent gives at restore.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspaceTab
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.partOrigin
 */
async function fragmentsSnapshot(
  written: Set<PaneId>,
  keeps: KeptWrite[]
): Promise<{ fragments: FragmentState[]; expandedFragment: number | undefined }> {
  const state = workspaceStore.getSnapshot();
  const fragments: FragmentState[] = [];
  let expandedFragment: number | undefined;
  for (const panel of state.dock.panels) {
    if (panel === state.helpPanel || panel === state.agentPanel || panel === state.notesPanel) {
      continue;
    }
    const pane = partPane(panel);
    const part = paneState(pane);
    if (part === undefined) continue;
    const { document } = part;
    const key = keptKey(document);
    const version = contentVersion(document);
    const bytes = async () => new Blob([(await document.storage.read(0, document.size)).slice()]);
    const origin = part.origin;
    const codec = origin === undefined ? undefined : partCodecState(origin.codec);
    const changed = origin === undefined ? true : await origin.hasChanges(document);
    let source: DocumentSource;
    if (origin !== undefined && codec !== undefined && written.has(origin.parent)) {
      if (changed) keeps.push({ key, version, value: bytes });
      source = {
        kind: "part",
        part: {
          parent: origin.parent,
          sourceStart: origin.sourceRange[0],
          sourceEnd: origin.sourceRange[1],
          name: origin.partName,
          layout: JSON.stringify(origin.layout),
          codec: JSON.stringify(codec),
          size: document.size,
          ...(changed
            ? { edits: { id: key, name: part.name, size: document.size, dirty: true } }
            : {}),
        },
      };
    } else {
      keeps.push({ key, version, value: bytes });
      source = {
        kind: "untitled",
        untitled: { id: key, name: part.name, size: document.size, dirty: document.isDirty },
      };
    }
    if (state.dock.expanded === panel) expandedFragment = fragments.length;
    written.add(pane);
    fragments.push({
      pane: { id: pane, document: source, ...positionOf(pane) },
      surface: surfaceSnapshot(surfaceOf(pane)),
    });
  }
  return { fragments, expandedFragment };
}

/** Where the reader was in a pane: the selection, the typing mode and the first row on screen. */
function positionOf(
  pane: PaneId
): Pick<PaneState, "selectionStart" | "selectionEnd" | "inputRegion" | "insertMode" | "topOffset"> {
  const held = paneState(pane);
  const start = held?.document.selection.start ?? 0;
  return {
    selectionStart: start,
    selectionEnd: held?.document.selection.end ?? start,
    inputRegion: held?.typing.inputRegion ?? "hex",
    insertMode: held?.typing.isInsertMode ?? false,
    topOffset: scrollLink.visibleRange(pane, BYTES_PER_ROW)?.start ?? start,
  };
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
  handles: Record<string, FileSystemFileHandle>,
  keeps: KeptWrite[]
): PaneState | undefined {
  const pane = paneState(slot);
  if (pane === undefined) return undefined;
  const { file, document, typing } = pane;
  const { start, end } = document.selection;
  const segments = segmentsSnapshot(slot, handles);
  const key = keptKey(document);
  const version = contentVersion(document);
  // A document never saved: its bytes, kept beside the workspace, rewritten only when its content
  // moved since the last write.
  // @upstream ByteRipperApp/Workspace/UntitledKeeper.swift#UntitledKeeper.stamp
  // @upstream ByteRipperApp/Workspace/UntitledKeeper.swift#UntitledKeeper.editsStamp
  if (pane.untitled) {
    keeps.push({
      key,
      version,
      value: async () => new Blob([(await document.storage.read(0, document.size)).slice()]),
    });
  } else if (document.isDirty) {
    // A file's unsaved changes: runs over the file, about the size of the changes.
    keeps.push({ key, version, value: () => exportKeptEdits(slot) });
  }
  return {
    id: slot,
    document: pane.untitled
      ? {
          kind: "untitled",
          untitled: { id: key, name: pane.name, size: document.size, dirty: document.isDirty },
        }
      : { kind: "file", file: stampOf(file, slot, handles) },
    ...(!pane.untitled && document.isDirty ? { edits: key } : {}),
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
  const { workspace, handles, keeps } = await snapshotWorkspace();
  if (keepsWaiting) {
    if (workspaceIsEmpty(workspace)) return;
    // A file opened by hand: the workspace that was waiting is given up for this one.
    keepsWaiting = false;
  }
  const id = workspaceId();
  // The bytes first, then the record that names them: a record never points at bytes not there.
  const due = keeps.filter((one) => keptVersions.get(one.key) !== one.version);
  for (const one of due) {
    const value = await one.value();
    if (value === undefined) continue;
    await writeKeptBytes(id, one.key, value);
    keptVersions.set(one.key, one.version);
  }
  const text = JSON.stringify(workspace);
  if (text === lastWritten && !leaving && due.length === 0) return;
  lastWritten = text;
  await writeWorkspaceRecord(id, { workspace, leftAt: Date.now(), handles });
  // A document closed takes its copy with it.
  await removeKeptBytesExcept(id, new Set(keeps.map((one) => one.key)));
}

/** Bytes to keep beside the workspace: under which key, for which content, made how. */
interface KeptWrite {
  readonly key: string;
  readonly version: number;
  readonly value: () => Promise<unknown>;
}

/** The key each document's bytes are kept under, made once per document. */
const keptKeys = new WeakMap<BinaryDocument, string>();
/** By key, the content version last written. */
const keptVersions = new Map<string, number>();
/** By document, how often its content has changed: what says its bytes need writing again. */
const versions = new WeakMap<BinaryDocument, { count: number }>();

function keptKey(document: BinaryDocument): string {
  let key = keptKeys.get(document);
  if (key === undefined) {
    key = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    keptKeys.set(document, key);
  }
  return key;
}

/**
 * How often the document's content has changed since this page first looked at it.
 *
 * @upstream ByteRipperApp/Workspace/UntitledKeeper.swift#UntitledKeeper.Entry.written
 * @upstream-differs counted from the document's content changes, where upstream reads its undo
 * history's version; a restored document is written again under a key of its own, where upstream
 * adopts the one it was kept by
 */
function contentVersion(document: BinaryDocument): number {
  let counter = versions.get(document);
  if (counter === undefined) {
    const made = { count: 1 };
    counter = made;
    versions.set(document, made);
    document.onContentChanged(() => {
      made.count += 1;
    });
  }
  return counter.count;
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
    if (!now) {
      void removeAllWorkspaceRecords();
      void removeAllKeptBytes();
      keptVersions.clear();
    } else void recordWorkspace(true);
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

/**
 * Whether the workspace holds `document` as it is now — its bytes or its changes written down at
 * their current content — so leaving the page need not ask about it: it comes back, still unsaved.
 * An edit made since the last write is not held, and is asked about.
 *
 * @upstream ByteRipperApp/Workspace/UntitledKeeper.swift#UntitledKeeper.holdsCurrentBytes
 */
export function workspaceHolds(document: BinaryDocument): boolean {
  if (paused || keepsWaiting || !settingsStore.getSnapshot().restoresWorkspace) return false;
  const key = keptKeys.get(document);
  return key !== undefined && keptVersions.get(key) === versions.get(document)?.count;
}
