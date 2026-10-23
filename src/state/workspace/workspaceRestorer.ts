import { L } from "@/core/localization/localization";
import type { SearchEncoding } from "@/core/search/searchPattern";
import { Segmentation, SegmentLink } from "@/core/segments/segmentation";
import { partitionData } from "@/core/session/sessionCuts";
import type { SessionView } from "@/core/session/sessionView";
import {
  type FileStamp,
  type KeptContent,
  type KeptJoin,
  type NotesState,
  type PaneState,
  type PartOrigin,
  paneRestore,
  type RestoreIssue,
  type SegmentationState,
  type SurfaceState,
  segmentationApplies,
  stampIsUnchanged,
  type ToolState,
  type UndoActState,
  type Workspace,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import { loadWorkspace } from "@/core/workspace/workspaceMigration";
import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { desktopFiles, isMissingFile, readFileByPath } from "@/platform/desktop/desktopFiles";
import { desktopOwnWindows, desktopProject, windowLaunch } from "@/platform/desktop/desktopWindows";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";
import { operate, type RecordedActData } from "@/platform/sessions/sessionOperations";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { restoreAnnotations, selectAnnotations } from "@/state/agent/agentAnnotationStore";
import { DocumentOrigin } from "@/state/documentOrigin";
import { documentPartReader } from "@/state/documentPartReader";
import { setMinimapMode, setMinimapVisible } from "@/state/minimapStore";
import { openLinkedPart } from "@/state/openLinkedPart";
import { BackgroundOperation, beginOperation } from "@/state/operationStore";
import {
  PANE_IDS,
  type PaneId,
  type PartId,
  type SlotId,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
} from "@/state/paneId";
import { parkToolState } from "@/state/parkedToolState";
import { editQuery, openSearch, setSearchEncoding } from "@/state/searchStore";
import { sourceIDForFile } from "@/state/segmentSources";
import type { KeptContentClient } from "@/state/sessions/keptContent";
import { settingsStore } from "@/state/settingsStore";
import { createStore } from "@/state/store";
import { activate } from "@/state/toolController";
import { fileSha256 } from "@/state/workspace/fileDigest";
import { openLinkElsewhere, paneNamed, parentLinkHost } from "@/state/workspace/parentLinks";
import { codecOf, type PartCodecState } from "@/state/workspace/partCodecState";
import { enterProject } from "@/state/workspace/projects";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import {
  currentKeeper,
  keepWaitingWorkspace,
  leaveNewerSession,
  pauseWorkspaceRecorder,
  readOwnWorkspace,
} from "@/state/workspace/workspaceRecorder";
import type { WorkspaceRecord } from "@/state/workspace/workspaceRecords";
import {
  adoptSessionInPane,
  applyKeptEdits,
  foldParts,
  keptContentLaid,
  openInPane,
  openKeptUntitledInPane,
  openNotesPanel,
  openPart,
  paneState,
  raisePart,
  reportAlert,
  restoreJoinMarks,
  setActivePane,
  setPaneOrigin,
  setSplitFraction,
  workspaceStore,
} from "@/state/workspaceStore";
import { toolById } from "@/tools/registry";
import { scrollLink } from "@/ui/pane/scrollLink";

/**
 * Brings the tab's workspace back when the page is opened again (`Design/WORKSPACE.md`,
 * "Restoring"): the files opened silently where the page can reach them, the position of each pane
 * put back once it is laid out, and one warning at the end for what could not come back as it was.
 *
 * A file the browser keeps a handle to may need a click before it can be read again: then the
 * empty window offers to reopen the workspace (`workspaceRestoreStore.waiting`), and the click is
 * what asks.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRestorer.swift#WorkspaceRestorer
 * @upstream ByteRipperApp/Workspace/WorkspaceRestorer.swift#WorkspaceRestorer.openFiles
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceDocument
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.finishWorkspaceTab
 * @upstream-differs a click may be needed to reach the files, which the empty window asks for
 */

/** What the empty window shows of a workspace waiting for a click to reach its files. */
export interface WorkspaceRestoreState {
  /** The names of the files a click would reopen; nothing while none is waiting. */
  readonly waiting: readonly string[] | undefined;
}

export const workspaceRestoreStore = createStore<WorkspaceRestoreState>({ waiting: undefined });

interface HandlePermissions {
  queryPermission?(descriptor: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

/** How a file of the workspace was reached. */
type Reached =
  | { readonly kind: "opened"; readonly file: OpenedFile }
  /** Its handle is there, and reading it needs a click to ask. */
  | { readonly kind: "asks" }
  | { readonly kind: "issue"; readonly issue: RestoreIssue };

/**
 * The file a stamp names, by the handle the browser gave — asking for access only when `asking`,
 * which is inside a click — and then by its path, where the shell can read one. Only reading is
 * asked for: a restore opens the file and changes nothing in it, and a browser asked for writing
 * says it is about to save changes. Save asks for writing itself when it writes (`fileSink.ts`).
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.locate
 */
async function reach(
  stamp: FileStamp,
  handle: FileSystemFileHandle | undefined,
  asking: boolean
): Promise<Reached> {
  if (handle !== undefined) {
    const permissions = handle as HandlePermissions;
    let state: PermissionState = "granted";
    if (permissions.queryPermission !== undefined) {
      state = await permissions.queryPermission({ mode: "read" }).catch(() => "prompt");
      if (state !== "granted" && asking && permissions.requestPermission !== undefined) {
        try {
          state = await permissions.requestPermission({ mode: "read" });
        } catch {
          // The browser would not ask now — the click it needs has passed: the workspace keeps
          // waiting, and the next click asks again.
          return { kind: "asks" };
        }
      }
    }
    // Not granted yet — or refused before, as a cancelled question about writing was: a click on
    // the empty window asks again, about reading only, rather than the file being given up.
    if (state !== "granted" && !asking) return { kind: "asks" };
    if (state !== "granted")
      return { kind: "issue", issue: { kind: "notAllowed", name: stamp.name } };
    try {
      return { kind: "opened", file: openedFileFrom(await handle.getFile(), handle) };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return { kind: "issue", issue: { kind: "missing", name: stamp.name } };
      }
      const reason = error instanceof Error ? error.message : String(error);
      return { kind: "issue", issue: { kind: "unreadable", name: stamp.name, reason } };
    }
  }
  const files = desktopFiles();
  if (stamp.path !== undefined && files !== undefined) {
    try {
      const { stat, blob } = await readFileByPath(files, stamp.path);
      return {
        kind: "opened",
        file: {
          name: stat.path.split(/[\\/]/).pop() ?? stamp.name,
          size: stat.size,
          lastModified: Math.floor(stat.modified),
          source: blob,
          path: stat.path,
        },
      };
    } catch (error) {
      return {
        kind: "issue",
        issue: { kind: isMissingFile(error) ? "missing" : "unreachable", name: stamp.path },
      };
    }
  }
  return { kind: "issue", issue: { kind: "unreachable", name: stamp.name } };
}

/** What this restore works from, kept while it waits for a click. */
let waiting:
  | { readonly record: WorkspaceRecord; readonly keeper: KeptContentClient | undefined }
  | undefined;

/**
 * Restores the workspace this tab is, when the setting is on and there is one: called once, as the
 * window comes up.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.restoreWorkspace
 */
export function restoreWorkspace(): Promise<void> {
  // Once a page: the window coming up twice — React's strict mode does it — restores once.
  restoring ??= restoreOnce().finally(settleRestore);
  return restoring;
}

let restoring: Promise<void> | undefined;

async function restoreOnce(): Promise<void> {
  // Nothing is recorded until the restore is through: a snapshot of the window still empty would
  // be written over what it is about to restore — and, in a project, would say the window keeps
  // none of the bytes it is about to read back.
  pauseWorkspaceRecorder(true);
  try {
    await restoreKept();
  } finally {
    pauseWorkspaceRecorder(false);
  }
}

async function restoreKept(): Promise<void> {
  // A window of the project the app has open restores what the project holds of it, whatever the
  // switch says: a project is kept as long as it is open (`Design/DESKTOP_WINDOWS.md`, D3).
  const project = windowLaunch()?.project;
  if (project !== undefined) {
    await openProjectWindow();
    return;
  }
  // Read whatever the switch says: a newer build's session is left alone even with it off, which
  // would otherwise forget it.
  const record = await readOwnWorkspace();
  if (record === undefined) return;
  const loaded = loadWorkspace(record.workspace);
  if (!loaded.ok) {
    if (loaded.failure.kind === "newer") {
      leaveNewerSession();
      if (settingsStore.getSnapshot().restoresWorkspace) presentNewerSessionNotice();
    }
    return;
  }
  if (!settingsStore.getSnapshot().restoresWorkspace) return;
  const workspace = loaded.value;
  if (workspaceIsEmpty(workspace)) return;
  // A file opened before the restore got here — dropped on the page while it loaded — is the
  // reader's answer: nothing is put back over it.
  if (PANE_IDS.some((slot) => paneState(slot) !== undefined)) return;
  await restoreFrom({ ...record, workspace }, false, currentKeeper());
}

/**
 * Says once, at launch, that the session is a newer build's and is left for it
 * (`isSessionNewer`): by the window the launch made first — the front one of the windows it
 * restored, or the one new window that takes up a workspace left — for every window, which one
 * build wrote together.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.presentNewerSessionNotice
 */
// help: workspace.newer-version
function presentNewerSessionNotice(): void {
  const launch = windowLaunch();
  if (launch?.keep === undefined && launch?.adopt !== true) return;
  reportAlert(
    L("The workspace was saved by a newer version of ByteRipper."),
    L(
      "It is left as it is, for that version to reopen. Until you quit, this version does not keep the workspace: quitting asks about unsaved changes."
    )
  );
}

/**
 * The empty window's **Reopen the workspace**, inside the click: asks for the files that need it,
 * and puts the workspace back.
 */
export async function reopenWaitingWorkspace(): Promise<void> {
  const held = waiting;
  if (held === undefined) return;
  await restoreFrom(held.record, true, held.keeper);
}

/**
 * This window of the project the app has open: recorded into the project from now on, and put
 * back as the project's file holds it, its kept bytes read through the shell.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openProject
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.rebuild
 */
async function openProjectWindow(): Promise<void> {
  const bridge = desktopProject();
  const project = windowLaunch()?.project;
  if (bridge === undefined || project === undefined) return;
  enterProject(project);
  const written = await bridge.window().catch(() => undefined);
  // The shell refused a project of a newer build before any window was made; one of an earlier
  // build is brought up to this one here, window by window.
  const loaded = loadWorkspace(written);
  if (!loaded.ok) return;
  const workspace = fromProjectFile(loaded.value);
  await restoreFrom({ workspace, leftAt: 0, handles: {} }, false, currentKeeper());
}

/**
 * A window's workspace as the project's file gives it back: written as JSON, a slot with nothing
 * open came back as `null`, which is a pane of nothing here as `undefined` is.
 */
export function fromProjectFile(workspace: Workspace): Workspace {
  return {
    ...workspace,
    tab: { ...workspace.tab, panes: workspace.tab.panes.map((pane) => pane ?? undefined) },
  };
}

/**
 * Puts `record` back into the empty tab, reading the content it keeps through `keeper`.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.finishWorkspaceTab
 */
export async function restoreFrom(
  record: WorkspaceRecord,
  asking: boolean,
  keeper: KeptContentClient | undefined
): Promise<void> {
  pauseWorkspaceRecorder(true);
  try {
    const { tab } = record.workspace;
    const reachOne = (stamp: FileStamp) =>
      reach(stamp, stamp.handle === undefined ? undefined : record.handles[stamp.handle], asking);
    // One file at a time: a browser asks about one file at a time, and a second question put while
    // the first is open is refused.
    const reached: (Reached | undefined)[] = [];
    for (const pane of tab.panes) {
      reached.push(
        pane === undefined || pane.document.kind !== "file"
          ? undefined
          : await reachOne(pane.document.file)
      );
    }
    // The files the segments were joined from, each once, by what names it.
    const linkStamps = new Map<string, FileStamp>();
    for (const pane of tab.panes) {
      for (const piece of pane?.segments?.pieces ?? []) {
        if (piece.link !== undefined) linkStamps.set(stampKey(piece.link.file), piece.link.file);
      }
    }
    const links = new Map<string, Reached>();
    for (const [key, stamp] of linkStamps) links.set(key, await reachOne(stamp));
    // Something is behind a click: the whole workspace waits for it, rather than coming back in
    // halves.
    if ([...reached, ...links.values()].some((one) => one?.kind === "asks")) {
      waiting = { record, keeper };
      keepWaitingWorkspace(true);
      workspaceRestoreStore.update(() => ({
        waiting: tab.panes.flatMap((pane) =>
          pane?.document.kind === "file" ? [pane.document.file.name] : []
        ),
      }));
      return;
    }
    waiting = undefined;
    keepWaitingWorkspace(false);
    workspaceRestoreStore.update(() => ({ waiting: undefined }));

    const issues: RestoreIssue[] = [];
    const opened: { slot: SlotId; saved: PaneState; unchanged: boolean }[] = [];
    const partSlots: { slot: SlotId; saved: PaneState; origin: PartOrigin }[] = [];
    for (const [index, saved] of tab.panes.entries()) {
      const slot = PANE_IDS[index];
      if (saved === undefined || slot === undefined) continue;
      // A part let go on a pane waits for the pane it came out of.
      if (saved.document.kind === "part") {
        partSlots.push({ slot, saved, origin: saved.document.part });
        continue;
      }
      // A document never saved: its bytes, from beside the workspace, still unsaved.
      // @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceDocument
      if (saved.document.kind === "untitled") {
        const stamp = saved.document.untitled;
        const name = stamp.name ?? L("Untitled");
        const bytes = await keeper?.bytesOf(stamp.content).catch(() => undefined);
        if (bytes === undefined) {
          issues.push({ kind: "keptUnreadable", name });
          continue;
        }
        await openKeptUntitledInPane(slot, new Blob([bytes.slice()]), name, stamp.dirty);
        await adoptKept(slot, stamp.content, name, stamp.dirty, keeper, record);
        opened.push({ slot, saved, unchanged: true });
        continue;
      }
      const one = reached[index];
      if (one === undefined) continue;
      if (one.kind === "issue") {
        issues.push(one.issue);
        continue;
      }
      if (one.kind !== "opened" || saved.document.kind !== "file") continue;
      openInPane(slot, one.file);
      const unchanged = await isTheSameFile(slot, saved.document.file, saved.kept, one.file);
      if (!unchanged) issues.push({ kind: "changed", name: one.file.path ?? one.file.name });
      // Its unsaved changes and the history that made them, laid over it only when it is the file
      // they were made on; kept changes that cannot be read leave it as it is on disk.
      // @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.apply
      const kept = saved.kept;
      if (unchanged && kept !== undefined && keeper !== undefined) {
        const view = paneState(slot)?.document;
        // help: workspace.restore-check
        const reading = new BackgroundOperation(
          L("Reading the changes kept for “%1$@”", one.file.name),
          () => undefined,
          true
        );
        beginOperation(slot, reading);
        try {
          if (view === undefined) throw new Error("No pane to lay it on.");
          await keeper.apply(view, kept);
          await adoptKept(slot, kept, one.file.name, true, keeper, record);
        } catch {
          issues.push({ kind: "keptUnreadable", name: one.file.path ?? one.file.name });
        } finally {
          reading.finish();
        }
      }
      opened.push({ slot, saved, unchanged });
    }
    for (const one of opened) noteRestored(one.saved.id, one.slot, one.unchanged);
    for (const { slot, saved, origin } of partSlots) {
      const unchanged = await restorePartSlot(slot, origin, opened, issues, keeper, record);
      if (unchanged === undefined) continue;
      opened.push({ slot, saved, unchanged });
      noteRestored(saved.id, slot, unchanged);
    }
    const active = PANE_IDS[tab.activePane];
    if (active !== undefined && paneState(active) !== undefined) setActivePane(active);
    // The divider where it was, in a comparison that came back as one.
    if (tab.dividerFraction !== undefined && opened.length === 2) {
      setSplitFraction(Math.min(1, Math.max(0, tab.dividerFraction)));
    }
    const linkFiles = new Map<string, OpenedFile>();
    for (const [key, one] of links) if (one.kind === "opened") linkFiles.set(key, one.file);
    await Promise.all(
      opened.map((one) => applyPane(one.slot, one.saved, one.unchanged, linkFiles))
    );
    if (opened.length > 0) applySurface(tab.surface);
    const tool = tab.surface.tool;
    if (tool !== undefined) {
      const target =
        (tool.pane === undefined
          ? undefined
          : opened.find((one) => PANE_IDS.indexOf(one.slot) === tool.pane)) ?? opened[0];
      if (target !== undefined) restoreTool(tool, target.slot, target.unchanged);
    }
    await restoreFragments(record, opened, issues, keeper);
    await restoreNotes(record.workspace.notes);
    await keeper?.forgetReadBacks();
    for (const name of (await keeper?.takeHistoriesLost()) ?? [])
      issues.push({ kind: "historyLost", name });
    reportRestoreIssues(issues);
  } finally {
    pauseWorkspaceRecorder(false);
  }
}

/**
 * A part let go on a pane, put back there: taken out of its parent again — the other pane, or a
 * pane of another window — with the changes it held laid over it; with no parent to come out of,
 * its changes as bytes with no way home, or reported when it had none. Whether it holds the bytes
 * it was written with, or nothing when nothing came back.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRestorer.swift#WorkspaceRestorer.openParts
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspacePart
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceOrphan
 */
async function restorePartSlot(
  slot: SlotId,
  origin: PartOrigin,
  opened: readonly { slot: SlotId; saved: PaneState; unchanged: boolean }[],
  issues: RestoreIssue[],
  keeper: KeptContentClient | undefined,
  record: WorkspaceRecord
): Promise<boolean | undefined> {
  const id = ownPaneId(origin.parent);
  const parent = opened.find((one) => one.saved.id === id);
  const linked =
    parent === undefined
      ? await linkElsewhere(origin)
      : parent.unchanged
        ? await linkHere(origin, parent.slot)
        : undefined;
  const edits = origin.edits;
  if (linked !== undefined) {
    await openKeptUntitledInPane(slot, new Blob([linked.bytes.slice()]), origin.name, false);
    setPaneOrigin(slot, linked.link);
    if (edits !== undefined) {
      const bytes = await keeper?.bytesOf(edits.content).catch(() => undefined);
      if (bytes !== undefined) {
        await layOver(slot, bytes);
        await adoptKept(slot, edits.content, origin.name, true, keeper, record);
      } else issues.push({ kind: "keptUnreadable", name: origin.name });
    }
    return true;
  }
  // No way home: its own changes come back as bytes of their own, or nothing does.
  const bytes =
    edits === undefined ? undefined : await keeper?.bytesOf(edits.content).catch(() => undefined);
  if (bytes === undefined || edits === undefined) {
    issues.push({ kind: "missing", name: origin.name });
    return undefined;
  }
  await openKeptUntitledInPane(slot, new Blob([bytes.slice()]), origin.name, true);
  await adoptKept(slot, edits.content, origin.name, true, keeper, record);
  return parent?.unchanged ?? true;
}

/**
 * A part's bytes and its link, taken out of `parent` of this window as the workspace wrote them.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspacePart
 */
async function linkHere(
  origin: PartOrigin,
  parent: PaneId
): Promise<{ readonly bytes: Uint8Array; readonly link: DocumentOrigin } | undefined> {
  const state = parsed<PartCodecState>(origin.codec);
  const held = paneState(parent);
  if (state === undefined || held === undefined) return undefined;
  const source: readonly [number, number] = [origin.sourceStart, origin.sourceEnd];
  const codec = codecOf(state, parent);
  let bytes: Uint8Array;
  try {
    bytes = await codec.decode({
      content: documentPartReader(held.document),
      source,
      name: held.name,
      partName: origin.name,
    });
  } catch {
    return undefined;
  }
  const layout = parsed<UEFIRootLayout>(origin.layout);
  const link = await DocumentOrigin.of({
    parent,
    source,
    partName: origin.name,
    codec,
    ...(layout === undefined ? {} : { layout }),
    content: bytes,
  });
  return link === undefined ? undefined : { bytes, link };
}

/**
 * A part's bytes and its link, taken out of a pane of another window by that window, once it has
 * put the pane back: what upstream's one restore over every window does in place.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspacePart
 * @upstream-differs the parent's window decodes the part and hands over its bytes and its
 * session's name: each window here restores its own record
 */
async function linkElsewhere(
  origin: PartOrigin
): Promise<{ readonly bytes: Uint8Array; readonly link: DocumentOrigin } | undefined> {
  const named = paneNamed(origin.parent);
  const state = parsed<PartCodecState>(origin.codec);
  if (named.workspace === undefined || origin.codec === undefined || state === undefined) {
    return undefined;
  }
  const source: readonly [number, number] = [origin.sourceStart, origin.sourceEnd];
  const answer = await openLinkElsewhere(named.workspace, named.pane, {
    source,
    codec: origin.codec,
    name: origin.name,
  });
  if (answer === undefined) return undefined;
  const link = await DocumentOrigin.ofSession({
    session: answer.session,
    parentName: answer.parentName,
    source,
    partName: origin.name,
    codec: codecOf(state, { session: answer.session }),
    layout: parsed<UEFIRootLayout>(origin.layout),
    content: answer.bytes,
  });
  return link === undefined ? undefined : { bytes: answer.bytes, link };
}

/** A written parent's id as this record has it: one this window wrote names it bare. */
function ownPaneId(id: string): string {
  const named = paneNamed(id);
  return named.workspace === workspaceId() ? named.pane : id;
}

/**
 * The panes this window's restore has put back, by the id its record wrote each under — what a
 * part in another window names its parent by — and whether each is still the document it was.
 */
const restoredHere = new Map<string, { readonly pane: PaneId; readonly unchanged: boolean }>();
let restoreSettled = false;
const restoreHeard = new Set<() => void>();

function noteRestored(id: string | undefined, pane: PaneId, unchanged: boolean): void {
  if (id === undefined) return;
  restoredHere.set(id, { pane, unchanged });
  for (const heard of restoreHeard) heard();
}

/** Says a pane is back under `id`, as a restore would: for a test of the questions it answers. */
export function noteRestoredForTesting(id: string, pane: PaneId): void {
  noteRestored(id, pane, true);
}

function settleRestore(): void {
  restoreSettled = true;
  for (const heard of restoreHeard) heard();
}

/** The pane put back for `id`, once it is; nothing once the restore is over without it. */
function restoredPane(
  id: string
): Promise<{ readonly pane: PaneId; readonly unchanged: boolean } | undefined> {
  return new Promise((resolve) => {
    const look = () => {
      const found = restoredHere.get(id);
      if (found === undefined && !restoreSettled) return false;
      restoreHeard.delete(look);
      resolve(found);
      return true;
    };
    if (!look()) restoreHeard.add(look);
  });
}

// A window restoring a part whose parent this window holds asks for it here: the part is taken
// out of the pane once that is back, as this window would take it out for a panel of its own.
parentLinkHost.openLink = async (id, request) => {
  const found = await restoredPane(id);
  if (found === undefined || !found.unchanged) return undefined;
  const linked = await linkHere(
    {
      parent: id,
      sourceStart: request.source[0],
      sourceEnd: request.source[1],
      name: request.name,
      codec: request.codec,
      size: 0,
    },
    found.pane
  );
  const held = paneState(found.pane);
  if (linked === undefined || held === undefined) return undefined;
  // The link made here only stood for the reading: the window that asked holds its own.
  linked.link.release();
  return { session: held.document.id, parentName: held.name, bytes: linked.bytes };
};

/**
 * The panels, parents first: a part taken out of its parent again — decoded from it as it is now,
 * so it can still be written back — with the changes it held laid over it; a part whose parent did
 * not come back, or changed, comes back with its changes as bytes with no way home, or is reported
 * when it had none; bytes with no parent come back as they were. Then the panel that was in front.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRestorer.swift#WorkspaceRestorer.openParts
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspacePart
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceOrphan
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceLooseFragment
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.finishWorkspaceFragment
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.settleWorkspaceFragments
 */
async function restoreFragments(
  record: WorkspaceRecord,
  opened: readonly { slot: SlotId; saved: PaneState; unchanged: boolean }[],
  issues: RestoreIssue[],
  keeper: KeptContentClient | undefined
): Promise<void> {
  const { tab } = record.workspace;
  if (tab.fragments.length === 0) return;
  // By the id each pane had when written down, the pane it is now, and whether it is still the
  // document it was.
  const panes = new Map<string, { pane: PaneId; unchanged: boolean }>();
  for (const one of opened) {
    if (one.saved.id !== undefined)
      panes.set(one.saved.id, { pane: one.slot, unchanged: one.unchanged });
  }
  let expanded: PartId | undefined;
  for (const [index, fragment] of tab.fragments.entries()) {
    const source = fragment.pane.document;
    let part: PartId | undefined;
    // Whether the part holds the bytes its tool chose in: one taken out of a changed parent does not.
    let unchanged = true;
    if (source.kind === "part") {
      const origin = source.part;
      const parent = panes.get(ownPaneId(origin.parent));
      const codec = parsed<PartCodecState>(origin.codec);
      const layout = parsed<UEFIRootLayout>(origin.layout);
      if (parent?.unchanged && codec !== undefined) {
        part = await openLinkedPart({
          parent: parent.pane,
          name: origin.name,
          source: [origin.sourceStart, origin.sourceEnd],
          codec: codecOf(codec, parent.pane),
          ...(layout === undefined ? {} : { layout }),
        });
      } else if (parent === undefined) {
        // Its parent is a pane of another window, which takes it out of its own.
        const linked = await linkElsewhere(origin);
        if (linked !== undefined) part = openPart(linked.bytes, origin.name, linked.link);
      }
      const edits = origin.edits;
      if (part !== undefined && edits !== undefined) {
        const bytes = await keeper?.bytesOf(edits.content).catch(() => undefined);
        if (bytes !== undefined) {
          await layOver(part, bytes);
          await adoptKept(part, edits.content, origin.name, true, keeper, record);
        } else issues.push({ kind: "keptUnreadable", name: origin.name });
      }
      if (part === undefined) {
        // No way home: its own changes come back as bytes of their own, or nothing does.
        const content = origin.edits?.content;
        const bytes =
          content === undefined ? undefined : await keeper?.bytesOf(content).catch(() => undefined);
        if (bytes !== undefined && content !== undefined) {
          part = openPart(bytes, origin.name);
          await adoptKept(part, content, origin.name, true, keeper, record);
          unchanged = parent?.unchanged ?? true;
        } else {
          issues.push({ kind: "missing", name: origin.name });
        }
      }
    } else if (source.kind === "untitled") {
      const name = source.untitled.name ?? L("Untitled");
      const bytes = await keeper?.bytesOf(source.untitled.content).catch(() => undefined);
      if (bytes !== undefined) {
        part = openPart(bytes, name);
        if (source.untitled.dirty) await paneState(part)?.document.clearKeepingDirty();
        await adoptKept(part, source.untitled.content, name, source.untitled.dirty, keeper, record);
      } else issues.push({ kind: "keptUnreadable", name });
    }
    if (part === undefined) continue;
    if (fragment.pane.id !== undefined) {
      panes.set(fragment.pane.id, { pane: part, unchanged: true });
      noteRestored(fragment.pane.id, part, true);
    }
    if (index === tab.expandedFragment) expanded = part;
    await applyPane(part, fragment.pane, true, new Map());
    if (fragment.surface.minimapVisible) applyMinimap(surfaceOf(part), fragment.surface);
    if (fragment.surface.tool !== undefined) restoreTool(fragment.surface.tool, part, unchanged);
  }
  if (expanded !== undefined) raisePart(expanded);
  else foldParts();
}

/**
 * Whether the file opened is the one written down: by its SHA-256 when the workspace has it — a
 * moved date alone does not make another file — and by its size and date when it has not. Reading
 * the whole of it shows in the pane's operation strip.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#KeptFileCheck.isTheSameFile
 * @upstream ByteRipperApp/Workspace/WorkspaceRestorer.swift#WorkspaceRestorer.keptFiles
 * @upstream-differs in the pane's operation strip, not a sheet: the app shows no modal of its own
 */
async function isTheSameFile(
  slot: PaneId,
  stamp: FileStamp,
  kept: KeptContent | undefined,
  file: OpenedFile
): Promise<boolean> {
  const expected = stamp.sha256;
  if (kept === undefined || expected === undefined) {
    return stampIsUnchanged(stamp, { size: file.size, modified: file.lastModified });
  }
  if (file.size !== stamp.size) return false;
  // help: workspace.restore-check
  const operation = new BackgroundOperation(L("Checking “%1$@”", file.name), () => undefined);
  beginOperation(slot, operation);
  try {
    return (await fileSha256(file, (fraction) => operation.report(fraction))) === expected;
  } catch {
    return false;
  } finally {
    operation.finish();
  }
}

/** A part's changes, kept as its whole content, laid over what its parent gives. */
async function layOver(part: PaneId, added: Uint8Array): Promise<void> {
  await applyKeptEdits(part, {
    baseSize: 0,
    runs: added.length === 0 ? [] : [{ kind: "added", start: 0, end: added.length }],
    added,
  });
}

/**
 * A pane put back with its kept content goes on as kept: its history, and the joins on it with
 * the files they detached it from — reached as the workspace's files are.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.adopt
 */
async function adoptKept(
  pane: PaneId,
  content: KeptContent,
  name: string,
  dirty: boolean,
  keeper: KeptContentClient | undefined,
  record: WorkspaceRecord
): Promise<void> {
  const document = paneState(pane)?.document;
  if (document === undefined || keeper === undefined) return;
  const { joins, undoneJoins } = await keeper.adopt(document, content, name, dirty);
  if (joins.length > 0 || undoneJoins.length > 0) {
    const files = async (kept: readonly KeptJoin[]) => {
      const found: { kept: KeptJoin; file: OpenedFile }[] = [];
      for (const one of kept) {
        const stamp = one.file;
        const reached = await reach(
          stamp,
          stamp.handle === undefined ? undefined : record.handles[stamp.handle],
          false
        );
        if (reached.kind === "opened") found.push({ kept: one, file: reached.file });
      }
      return found;
    };
    restoreJoinMarks(pane, await files(joins), await files(undoneJoins));
  }
  await keptContentLaid(pane);
}

const parsed = <T>(text: string | undefined): T | undefined => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

/**
 * The caret, the selection, the typing mode and the first row on screen — the last once the pane
 * is laid out and can scroll.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.apply
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.scroll
 */
async function applyPane(
  slot: PaneId,
  saved: PaneState,
  unchanged: boolean,
  linkFiles: ReadonlyMap<string, OpenedFile>
): Promise<void> {
  const pane = paneState(slot);
  if (pane === undefined) return;
  const restore = paneRestore(saved, pane.document.size, unchanged);
  const segments = saved.segments;
  if (segments !== undefined && segmentationApplies(segments, pane.document.size, unchanged)) {
    await restoreSegments(slot, segments, linkFiles);
  }
  // What Undo and Redo take back, the cuts with them: only over the history that came back.
  // @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.restoreSegmentSnapshots
  const undo = saved.undo;
  if (undo !== undefined && unchanged && (pane.document.canUndo || pane.document.canRedo)) {
    const partition = (state: SegmentationState | undefined) =>
      state === undefined ? undefined : partitionData(partitionOf(slot, state, linkFiles));
    const act = (one: UndoActState): RecordedActData =>
      one.kind === "group"
        ? {
            kind: "group",
            parts: (one.parts ?? []).map(act),
            before: partition(one.before),
            after: partition(one.after),
          }
        : { kind: one.kind, after: partition(one.after) };
    const whole = (one: SegmentationState) => partitionData(partitionOf(slot, one, linkFiles));
    await operate(pane.document, "restoreUndo", {
      past: undo.past.map(act),
      future: undo.future.map(act),
      cutsPast: undo.cutsPast.map(whole),
      cutsFuture: undo.cutsFuture.map(whole),
    });
  }
  await applyPlace(slot, restore);
}

/**
 * Where the reader was in a pane, put back: the caret and selection, the input, the mode, the
 * row on top.
 */
async function applyPlace(slot: PaneId, restore: ReturnType<typeof paneRestore>): Promise<void> {
  const pane = paneState(slot);
  if (pane === undefined) return;
  // Queued behind whatever the pane's typing is doing as it mounts, and never waited on for long:
  // a restore that hung on one would keep the recorder paused for good.
  await settledWithin(pane.typing.setSelection(restore.selection.start, restore.selection.end));
  void pane.typing.setInputRegion(restore.inputRegion);
  if (pane.typing.isInsertMode !== restore.insertMode) {
    void pane.typing.setInsertMode(restore.insertMode);
  }
  // Laid out on a frame to come: the pane's scroller registers with the link as it mounts. A tab
  // reloaded behind another draws no frames and slows its timers to one a second, so the wait is
  // bounded by the clock rather than by a count of frames.
  const until = performance.now() + 500;
  while (scrollLink.visibleRange(slot, BYTES_PER_ROW) === undefined && performance.now() < until) {
    await settledWithin(new Promise((resolve) => requestAnimationFrame(resolve)), 50);
  }
  scrollLink.scrollToOffset(slot, restore.topOffset, BYTES_PER_ROW);
}

/**
 * A session another window let go, shown here in `slot` (`Design/FILE_SESSIONS.md`, S8): the same
 * document, history and cuts with it, and the reader's place in it as it was there.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.movePaneHere
 */
export async function adoptMovedSession(
  slot: SlotId,
  view: SessionView,
  record: Parameters<typeof adoptSessionInPane>[2],
  saved: PaneState | undefined
): Promise<void> {
  pauseWorkspaceRecorder(true);
  try {
    adoptSessionInPane(slot, view, record);
    setActivePane(slot);
    if (saved !== undefined) await applyPlace(slot, paneRestore(saved, view.size, true));
  } finally {
    pauseWorkspaceRecorder(false);
  }
}

/** The minimap of `surface` as it was. */
function applyMinimap(surface: SurfaceId, state: SurfaceState): void {
  if (!state.minimapVisible) return;
  setMinimapVisible(surface, true);
  if (state.minimapMode === "detail" || state.minimapMode === "overview") {
    setMinimapMode(surface, state.minimapMode);
  }
}

/** What names a file of the workspace, to reach it once however many pieces link to it. */
const SEARCH_ENCODINGS: readonly string[] = ["hex", "ascii", "utf8", "utf16LE", "utf16BE"];

const stampKey = (stamp: FileStamp): string =>
  stamp.handle ?? stamp.path ?? `${stamp.name}|${stamp.size}|${stamp.modified}`;

/**
 * Puts a written partition back, minting each source's id again from the file reached for it — a
 * link whose file could not be reached comes back as a piece with no link. Not an undo step: the
 * session that made the cuts is over, and undo here would take the pane to a partition it never
 * had.
 *
 * @upstream ByteRipperApp/Workspace/PaneViewModel+Workspace.swift#PaneViewModel.restoreSegments
 */
async function restoreSegments(
  slot: PaneId,
  state: SegmentationState,
  linkFiles: ReadonlyMap<string, OpenedFile>
): Promise<void> {
  const view = paneState(slot)?.document;
  if (view === undefined) return;
  await operate(view, "restoreCuts", partitionData(partitionOf(slot, state, linkFiles)));
}

/** A partition as the workspace wrote it, its links to the files reached for them. */
function partitionOf(
  slot: PaneId,
  state: SegmentationState,
  linkFiles: ReadonlyMap<string, OpenedFile>
): Segmentation {
  const pieces = state.pieces.map((piece) => {
    const file = piece.link === undefined ? undefined : linkFiles.get(stampKey(piece.link.file));
    if (piece.link === undefined || file === undefined)
      return { start: piece.start, name: piece.name };
    return {
      start: piece.start,
      name: piece.name,
      link: new SegmentLink(
        sourceIDForFile(slot, file),
        piece.link.sourceStart,
        Math.max(piece.link.sourceStart, piece.link.sourceEnd)
      ),
    };
  });
  return new Segmentation(state.contentSize, pieces);
}

/**
 * The minimap as it was, and the find bar with its pattern.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.apply
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.reopenFindBar
 */
function applySurface(state: SurfaceState): void {
  applyMinimap(WORKSPACE_SURFACE, state);
  const find = state.findPattern;
  if (find !== undefined) {
    openSearch();
    editQuery(find.text);
    if (SEARCH_ENCODINGS.includes(find.encoding as SearchEncoding)) {
      setSearchEncoding(find.encoding as SearchEncoding);
    }
  }
}

/**
 * The Annotations panel as it was: up over the panes when it was up, with the cards that were
 * selected selected again. The annotations last between visits with their ids of their own, so
 * the workspace keeps only which were chosen.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.restore
 * @upstream-differs a panel of the dock that is up or folded, where upstream puts a window back at its place among tabs
 */
async function restoreNotes(notes: NotesState | undefined): Promise<void> {
  if (notes === undefined) return;
  await restoreAnnotations();
  // The desktop shell's Annotations window is the app's, not this window's, and is not reopened.
  if (notes.isUp && desktopOwnWindows() === undefined) openNotesPanel();
  if (notes.selected.length > 0) selectAnnotations(notes.selected, notes.selected[0]);
}

/**
 * Opens the tool panel on `pane` as it was. What the tool had chosen is handed back only for a
 * document that is the one it was chosen in, through the box a session parks into; the tool binds
 * to the active pane as it starts, so the one it read is made active for that moment.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.restoreTool
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.park
 * @upstream-differs nothing to keep still: upstream opens the panel without moving the window, whose frame already has it, and a page's panel takes its room from the panes
 */
function restoreTool(tool: ToolState, pane: PaneId, unchanged: boolean): void {
  const module = toolById(tool.identifier);
  if (module === undefined) return;
  const state =
    unchanged && tool.state !== undefined ? module.restoredState?.(tool.state) : undefined;
  if (state !== undefined) parkToolState(tool.identifier, pane, state);
  const surface = surfaceOf(pane);
  if (surface !== WORKSPACE_SURFACE) {
    activate(tool.identifier, surface);
    return;
  }
  const { activePane } = workspaceStore.getSnapshot();
  setActivePane(pane as SlotId);
  activate(tool.identifier, surface);
  setActivePane(activePane);
}

/** `work`, or a wait of a second (or of `milliseconds`), whichever ends first. */
const settledWithin = (work: Promise<unknown>, milliseconds = 1000): Promise<unknown> =>
  Promise.race([work, new Promise((resolve) => setTimeout(resolve, milliseconds))]);

/**
 * One warning for everything the restore could not bring back as it was, once everything is open.
 * Nothing to say, no warning.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.reportRestoreIssues
 */
// help: workspace.restore-warning
export function reportRestoreIssues(issues: readonly RestoreIssue[]): void {
  if (issues.length === 0) return;
  const list = (kind: RestoreIssue["kind"]) =>
    issues
      .filter((one) => one.kind === kind)
      .map((one) => `• ${one.name}`)
      .join("\n");
  const sections: string[] = [];
  const missing = list("missing");
  if (missing !== "") sections.push(`${L("No longer found, not opened:")}\n${missing}`);
  const unreachable = list("unreachable");
  if (unreachable !== "") {
    sections.push(`${L("Not opened — this browser keeps no way back to them:")}\n${unreachable}`);
  }
  const notAllowed = list("notAllowed");
  if (notAllowed !== "") {
    sections.push(`${L("Not opened — the browser was not allowed to read them:")}\n${notAllowed}`);
  }
  const unreadable = issues
    .filter((one) => one.kind === "unreadable")
    .map((one) => `• ${one.name} (${one.kind === "unreadable" ? one.reason : ""})`)
    .join("\n");
  if (unreadable !== "")
    sections.push(`${L("Not opened — they could not be read:")}\n${unreadable}`);
  const keptUnreadable = list("keptUnreadable");
  if (keptUnreadable !== "") {
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.reportRestoreIssues
    sections.push(
      `${L("Their kept changes could not be read. Files were opened as they are on disk and parts as their file holds them; documents with no file were not opened:")}\n${keptUnreadable}`
    );
  }
  const historyLost = list("historyLost");
  if (historyLost !== "") {
    sections.push(
      `${L("Their changes came back, but not the steps to undo them: the kept history no longer led back:")}\n${historyLost}`
    );
  }
  const changed = list("changed");
  if (changed !== "") {
    sections.push(
      `${L("Changed on disk since the last session. Opened without their unsaved changes, segments, parts and tool state:")}\n${changed}`
    );
  }
  reportAlert(L("The workspace was not restored in full"), sections.join("\n\n"));
}
