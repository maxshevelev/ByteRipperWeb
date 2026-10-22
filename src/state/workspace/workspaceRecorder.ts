import type { Segmentation } from "@/core/segments/segmentation";
import type { RecordedAct } from "@/core/session/sessionActs";
import { partitionFrom } from "@/core/session/sessionCuts";
import type { SessionView } from "@/core/session/sessionView";
import {
  type DocumentSource,
  type FileStamp,
  type FragmentState,
  type KeptContent,
  type NotesState,
  type PaneState,
  type PaneUndoState,
  type SegmentationState,
  type SurfaceState,
  type TabState,
  type ToolState,
  type UndoActState,
  WORKSPACE_VERSION,
  type Workspace,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { ProjectFolder } from "@/platform/files/projectFolder";
import { actFrom, operate } from "@/platform/sessions/sessionOperations";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { agentAnnotationStore } from "@/state/agent/agentAnnotationStore";
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
import { sessionParkedStateOn } from "@/state/parkedToolState";
import { searchStore } from "@/state/searchStore";
import { sourceInfo } from "@/state/segmentSources";
import { segmentsFor } from "@/state/segmentsStore";
import { KeptContentClient } from "@/state/sessions/keptContent";
import { operateHost } from "@/state/sessions/pageSessions";
import { settingsStore } from "@/state/settingsStore";
import { sessionOn, toolController } from "@/state/toolController";
import { partCodecState } from "@/state/workspace/partCodecState";
import { currentProject, switchToProject } from "@/state/workspace/projectRecords";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import {
  readWorkspaceRecord,
  removeAllWorkspaceRecords,
  removeWorkspaceRecord,
  writeWorkspaceRecord,
} from "@/state/workspace/workspaceRecords";
import { keptJoinsOf, notesPanelIsUp, paneState, workspaceStore } from "@/state/workspaceStore";
import { toolById } from "@/tools/registry";
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
export async function snapshotWorkspace(keeper?: KeptContentClient): Promise<{
  readonly workspace: Workspace;
  readonly handles: Record<string, FileSystemFileHandle>;
}> {
  const handles: Record<string, FileSystemFileHandle> = {};
  const panes: (PaneState | undefined)[] = [];
  for (const slot of PANE_IDS) panes.push(await paneSnapshot(slot, handles, keeper));
  const state = workspaceStore.getSnapshot();
  const { fragments, expandedFragment } = await fragmentsSnapshot(
    new Set(PANE_IDS.filter((_, index) => panes[index] !== undefined)),
    keeper
  );
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFindPattern
  const search = searchStore.getSnapshot();
  const tab: TabState = {
    panes,
    activePane: state.activePane === "b" ? 1 : 0,
    ...(panes.every((one) => one !== undefined) ? { dividerFraction: state.splitFraction } : {}),
    surface: {
      ...surfaceSnapshot(WORKSPACE_SURFACE),
      ...(search.open ? { findPattern: { text: search.query, encoding: search.encoding } } : {}),
    },
    fragments,
    ...(expandedFragment === undefined ? {} : { expandedFragment }),
  };
  // The Annotations panel, while its pill is in the dock: whether it was up, and the cards chosen.
  const notes: NotesState | undefined =
    state.notesPanel === undefined
      ? undefined
      : { isUp: notesPanelIsUp(state), selected: [...agentAnnotationStore.getSnapshot().chosen] };
  return {
    workspace: { version: WORKSPACE_VERSION, tab, ...(notes === undefined ? {} : { notes }) },
    handles,
  };
}

/**
 * What a pane's document is to the keeper.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.keep
 */
function keptPane(
  pane: PaneId,
  isUntitled: boolean
): Parameters<KeptContentClient["keep"]>[0] | undefined {
  const held = paneState(pane);
  if (held === undefined) return undefined;
  return { view: held.document, isUntitled, joins: keptJoinsOf(pane) };
}

/**
 * What an untitled document carries in a record that keeps no content: a pane handed to another
 * window, whose bytes go with it on their own.
 *
 * @web-only a pane crosses between windows as a record and its bytes, where upstream hands over
 * the pane itself
 */
const UNKEPT: KeptContent = { id: "", base: { kind: "file", serial: 0 }, head: 0, nextSerial: 0 };

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
  keeper: KeptContentClient | undefined
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
    const origin = part.origin;
    const codec = origin === undefined ? undefined : partCodecState(origin.codec);
    const changed = origin === undefined ? true : await origin.hasChanges(document);
    let source: DocumentSource;
    const kept = async () => {
      const shape = keptPane(pane, true);
      return (shape === undefined ? undefined : await keeper?.keep(shape)) ?? UNKEPT;
    };
    if (origin !== undefined && codec !== undefined && written.has(origin.parent)) {
      const content = changed ? await kept() : undefined;
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
          ...(content === undefined
            ? {}
            : { edits: { content, name: part.name, size: document.size, dirty: true } }),
        },
      };
    } else {
      source = {
        kind: "untitled",
        untitled: {
          content: await kept(),
          name: part.name,
          size: document.size,
          dirty: document.isDirty,
        },
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
  const tool = toolSnapshot(surface);
  return {
    ...(map.visible ? { minimapVisible: true, minimapMode: map.mode } : { minimapVisible: false }),
    ...(tool === undefined ? {} : { tool }),
  };
}

/**
 * The open tool-module, what it has chosen, and the pane it reads.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspaceTool
 */
function toolSnapshot(surface: SurfaceId): ToolState | undefined {
  const { activeIdentifier, boundPane } = sessionOn(toolController.getSnapshot(), surface);
  if (activeIdentifier === undefined || boundPane === undefined) return undefined;
  const parked = sessionParkedStateOn(boundPane);
  const state =
    parked === undefined ? undefined : toolById(activeIdentifier)?.encodedState?.(parked);
  const slot = PANE_IDS.indexOf(boundPane as SlotId);
  return {
    identifier: activeIdentifier,
    ...(state === undefined ? {} : { state }),
    ...(slot < 0 ? {} : { pane: slot }),
  };
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
  return partitionState(slot, current, handles);
}

/**
 * A partition as the workspace writes it: each link by its source's file.
 *
 * @upstream ByteRipperApp/Workspace/PaneViewModel+Workspace.swift#PaneViewModel.encodedSegments
 */
function partitionState(
  slot: SlotId,
  current: Segmentation,
  handles: Record<string, FileSystemFileHandle>
): SegmentationState {
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
async function paneSnapshot(
  slot: SlotId,
  handles: Record<string, FileSystemFileHandle>,
  keeper: KeptContentClient | undefined
): Promise<PaneState | undefined> {
  const pane = paneState(slot);
  if (pane === undefined) return undefined;
  const { file, document, typing } = pane;
  const { start, end } = document.selection;
  const segments = segmentsSnapshot(slot, handles);
  // A document's content beyond the file — an untitled one's whole, a file's unsaved changes and
  // the history that made them — kept beside the workspace.
  // @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.stamp
  const shape = keptPane(slot, pane.untitled);
  const kept = shape === undefined ? undefined : await keeper?.keep(shape);
  const undo = kept === undefined ? undefined : await undoSnapshot(slot, handles);
  return {
    id: slot,
    document: pane.untitled
      ? {
          kind: "untitled",
          untitled: {
            content: kept ?? UNKEPT,
            name: pane.name,
            size: document.size,
            dirty: document.isDirty,
          },
        }
      : {
          kind: "file",
          file: await keptStamp(stampOf(file, slot, handles), kept, file, keeper),
        },
    ...(!pane.untitled && kept !== undefined ? { kept } : {}),
    ...(undo === undefined ? {} : { undo }),
    ...(segments === undefined ? {} : { segments }),
    selectionStart: start,
    selectionEnd: end,
    inputRegion: typing.inputRegion,
    insertMode: typing.isInsertMode,
    topOffset: scrollLink.visibleRange(slot, BYTES_PER_ROW)?.start ?? start,
  };
}

/**
 * A file's stamp, with its SHA-256 where content is kept over it: what decides at restore whether
 * it is still the file — a copy or a `touch` moves the date, not the bytes.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.workspacePane
 */
async function keptStamp(
  stamp: FileStamp,
  kept: KeptContent | undefined,
  file: OpenedFile,
  keeper: KeptContentClient | undefined
): Promise<FileStamp> {
  if (kept === undefined || keeper === undefined) return stamp;
  const sha256 = await keeper.fileHash(file);
  return sha256 === undefined ? stamp : { ...stamp, sha256 };
}

/**
 * What a press of Undo and Redo takes back in the pane and the cuts it restores, as the undo
 * router and the segments store hold them; nothing when they hold nothing.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.segmentWrites
 * @upstream-differs the router's acts and the cuts' own history, not snapshots paired with the
 * document's steps in its log
 */
async function undoSnapshot(
  slot: SlotId,
  handles: Record<string, FileSystemFileHandle>
): Promise<PaneUndoState | undefined> {
  const view = paneState(slot)?.document;
  if (view === undefined) return undefined;
  const held = await operate(view, "undoState");
  const past = held.past.map(actFrom);
  const future = held.future.map(actFrom);
  const cuts = {
    past: held.cutsPast.map(partitionFrom),
    future: held.cutsFuture.map(partitionFrom),
  };
  if (past.length + future.length + cuts.past.length + cuts.future.length === 0) return undefined;
  const state = (partition: Segmentation | undefined) =>
    partition === undefined ? undefined : partitionState(slot, partition, handles);
  const act = (one: RecordedAct): UndoActState => {
    const after = state(one.after);
    if (one.kind !== "group") return { kind: one.kind, ...(after === undefined ? {} : { after }) };
    const before = state(one.before);
    return {
      kind: "group",
      parts: one.parts.map(act),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    };
  };
  return {
    past: past.map(act),
    future: future.map(act),
    cutsPast: cuts.past.map((one) => partitionState(slot, one, handles)),
    cutsFuture: cuts.future.map((one) => partitionState(slot, one, handles)),
  };
}

/**
 * Where the reader is in a pane, as the workspace would write it: what the window a pane is
 * carried to puts back around the session it shows (`Design/FILE_SESSIONS.md`, S8).
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.releasePane
 * @upstream-differs the pane's record crosses with its session's name; upstream moves the pane
 */
export function paneRecord(slot: SlotId): Promise<PaneState | undefined> {
  return paneSnapshot(slot, {}, undefined);
}

/**
 * Takes a snapshot and writes it when it differs from the last one written — and, when the tab is
 * being left, writes when it was left whatever the snapshot is.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.record
 */
export async function recordWorkspace(leaving = false): Promise<boolean> {
  if (paused) return false;
  const restores = settingsStore.getSnapshot().restoresWorkspace;
  const project = currentProject();
  // A project waiting for a click to reach its files is not written over with the empty tab.
  if (project !== undefined) return keepsWaiting ? false : recordProject(project);
  if (!restores) return false;
  // Where the host cannot keep content — no disk it can write — the record goes without it.
  let keeper = sessionKeeper();
  await keeper?.beginSnapshot().catch(() => {
    keeper = undefined;
  });
  const { workspace, handles } = await snapshotWorkspace(keeper);
  if (keepsWaiting) {
    if (workspaceIsEmpty(workspace)) return false;
    // A file opened by hand: the workspace that was waiting is given up for this one.
    keepsWaiting = false;
  }
  const id = workspaceId();
  const text = JSON.stringify(workspace);
  if (text === lastWritten && !leaving && (await keeper?.hasPending()) !== true) return true;
  lastWritten = text;
  // The kept content first, then the record that names it: a record never points at bytes not
  // there. Then what no record names goes.
  const record = (filled: Workspace) =>
    writeWorkspaceRecord(id, { workspace: filled, leftAt: Date.now(), handles });
  if (keeper === undefined) await record(workspace);
  else await keeper.commit(workspace, record, shownSessions()).catch(() => undefined);
  return true;
}

/**
 * The keeper of the session's content, in the origin-private file system — one per workspace id;
 * nothing where the page has no such storage, and then a document's content is not kept.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.keeper
 */
function sessionKeeper(): KeptContentClient | undefined {
  const id = workspaceId();
  if (session?.id !== id) {
    session = { id, keeper: new KeptContentClient({ kind: "session", workspace: id }) };
  }
  return session.keeper;
}

let session: { readonly id: string; readonly keeper: KeptContentClient } | undefined;

/**
 * Writes the window into the open project — always, whatever the switch says: it is a folder the
 * person made to keep. The shell writes the project's file from every window's record and says
 * which project a launch opens again. Answers whether the window was recorded.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.record
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.isProject
 */
async function recordProject(project: {
  readonly id: string;
  readonly folder: ProjectFolder;
}): Promise<boolean> {
  if (projectKeeper?.id !== project.id) {
    projectKeeper = {
      id: project.id,
      keeper: new KeptContentClient({ kind: "project", project: project.id }),
    };
  }
  const keeper = projectKeeper.keeper;
  await keeper.beginSnapshot();
  const { workspace } = await snapshotWorkspace(keeper);
  try {
    await keeper.commit(
      workspace,
      async (filled) => {
        await project.folder.write(filled);
      },
      shownSessions()
    );
  } catch {
    return false;
  }
  return true;
}

/**
 * The keeper of the open project's content: a keeper of its own, started afresh with each
 * project.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.keeper
 */
let projectKeeper: { readonly id: string; readonly keeper: KeptContentClient } | undefined;

/** The keeper of what this window records into now, for the restore to put content back through. */
export function currentKeeper(): KeptContentClient | undefined {
  const project = currentProject();
  if (project === undefined) return sessionKeeper();
  if (projectKeeper?.id !== project.id) {
    projectKeeper = {
      id: project.id,
      keeper: new KeptContentClient({ kind: "project", project: project.id }),
    };
  }
  return projectKeeper.keeper;
}

/**
 * Records into the project from now on, or — nothing — into the tab's session. What the keeper
 * knew was written is in the folder it leaves.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.switchTo
 */
export function recordInto(project: { id: string; folder: ProjectFolder } | undefined): void {
  void projectKeeper?.keeper.forget();
  projectKeeper = undefined;
  switchToProject(project);
}

/**
 * Forgets the session the tab kept by itself: it was saved as a project, or discarded for one.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.discardSession
 */
export async function discardSession(): Promise<void> {
  const id = workspaceId();
  lastWritten = undefined;
  void session?.keeper.forget();
  session = undefined;
  await removeWorkspaceRecord(id);
  await removeKeptFolder(id);
}

/** A window's kept folder, gone with the workspace it kept. */
export async function removeKeptFolder(id: string): Promise<void> {
  await operateHost("keeper.removeFolder", { folder: { kind: "session", workspace: id } }).catch(
    () => undefined
  );
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
      session = undefined;
      void operateHost("keeper.removeAll", undefined).catch(() => undefined);
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
 * Whether the workspace holds `document` as it is now — its content written down at its current
 * state — so leaving the page need not ask about it: it comes back, still unsaved. An edit made
 * since the last write is not held, and is asked about.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.holdsCurrentBytes
 */
export function workspaceHolds(document: SessionView): boolean {
  if (paused || keepsWaiting) return false;
  // A project holds what it has written whatever the switch says.
  if (currentProject() === undefined && !settingsStore.getSnapshot().restoresWorkspace) {
    return false;
  }
  return currentKeeper()?.holdsCurrentBytes(document) === true;
}

/** The sessions this window shows: what a snapshot asks the keeper which it holds. */
function shownSessions(): SessionView[] {
  const { panes, parts } = workspaceStore.getSnapshot();
  return [...Object.values(panes), ...Object.values(parts)].flatMap((pane) =>
    pane === undefined ? [] : [pane.document]
  );
}
