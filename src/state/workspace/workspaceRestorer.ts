import { L } from "@/core/localization/localization";
import type { SearchEncoding } from "@/core/search/searchPattern";
import { Segmentation, SegmentLink } from "@/core/segments/segmentation";
import type { OverlayEdits } from "@/core/storage/editOverlayStorage";
import {
  type FileStamp,
  type PaneState,
  paneRestore,
  type RestoreIssue,
  type SegmentationState,
  type SurfaceState,
  segmentationApplies,
  stampIsUnchanged,
  WORKSPACE_VERSION,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { desktopFiles, isMissingFile, readFileByPath } from "@/platform/desktop/desktopFiles";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { setMinimapMode, setMinimapVisible } from "@/state/minimapStore";
import { openLinkedPart } from "@/state/openLinkedPart";
import {
  PANE_IDS,
  type PaneId,
  type PartId,
  type SlotId,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
} from "@/state/paneId";
import { editQuery, openSearch, setSearchEncoding } from "@/state/searchStore";
import { sourceIDForFile } from "@/state/segmentSources";
import { restorePartition } from "@/state/segmentsStore";
import { settingsStore } from "@/state/settingsStore";
import { createStore } from "@/state/store";
import { codecOf, type PartCodecState } from "@/state/workspace/partCodecState";
import { workspaceId } from "@/state/workspace/workspaceIdentity";
import {
  keepWaitingWorkspace,
  pauseWorkspaceRecorder,
  readOwnWorkspace,
} from "@/state/workspace/workspaceRecorder";
import type { WorkspaceRecord } from "@/state/workspace/workspaceRecords";
import { readKeptBytes } from "@/state/workspace/workspaceRecords";
import {
  applyKeptEdits,
  foldParts,
  openInPane,
  openKeptUntitledInPane,
  openPart,
  paneState,
  raisePart,
  reportAlert,
  setActivePane,
} from "@/state/workspaceStore";
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
 * which is inside a click — and then by its path, where the shell can read one.
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
      state = await permissions.queryPermission({ mode: "readwrite" }).catch(() => "prompt");
      if (state !== "granted" && asking && permissions.requestPermission !== undefined) {
        state = await permissions.requestPermission({ mode: "readwrite" }).catch(() => "denied");
      }
    }
    if (state === "granted") {
      try {
        return { kind: "opened", file: openedFileFrom(await handle.getFile(), handle) };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          return { kind: "issue", issue: { kind: "missing", name: stamp.name } };
        }
      }
    } else if (state === "prompt" && !asking) {
      return { kind: "asks" };
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

/** The record this restore works from, kept while it waits for a click. */
let waitingRecord: WorkspaceRecord | undefined;

/**
 * Restores the workspace this tab is, when the setting is on and there is one: called once, as the
 * window comes up.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.restoreWorkspace
 */
export async function restoreWorkspace(): Promise<void> {
  if (!settingsStore.getSnapshot().restoresWorkspace) return;
  const record = await readOwnWorkspace();
  if (record === undefined || record.workspace.version !== WORKSPACE_VERSION) return;
  if (workspaceIsEmpty(record.workspace)) return;
  // A file opened before the restore got here — dropped on the page while it loaded — is the
  // reader's answer: nothing is put back over it.
  if (PANE_IDS.some((slot) => paneState(slot) !== undefined)) return;
  await restoreFrom(record, false);
}

/**
 * The empty window's **Reopen the workspace**, inside the click: asks for the files that need it,
 * and puts the workspace back.
 */
export async function reopenWaitingWorkspace(): Promise<void> {
  const record = waitingRecord;
  if (record === undefined) return;
  await restoreFrom(record, true);
}

async function restoreFrom(record: WorkspaceRecord, asking: boolean): Promise<void> {
  pauseWorkspaceRecorder(true);
  try {
    const { tab } = record.workspace;
    const reachOne = (stamp: FileStamp) =>
      reach(stamp, stamp.handle === undefined ? undefined : record.handles[stamp.handle], asking);
    const reached = await Promise.all(
      tab.panes.map((pane) =>
        pane === undefined || pane.document.kind !== "file"
          ? Promise.resolve(undefined)
          : reachOne(pane.document.file)
      )
    );
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
      waitingRecord = record;
      keepWaitingWorkspace(true);
      workspaceRestoreStore.update(() => ({
        waiting: tab.panes.flatMap((pane) =>
          pane?.document.kind === "file" ? [pane.document.file.name] : []
        ),
      }));
      return;
    }
    waitingRecord = undefined;
    keepWaitingWorkspace(false);
    workspaceRestoreStore.update(() => ({ waiting: undefined }));

    const issues: RestoreIssue[] = [];
    const opened: { slot: SlotId; saved: PaneState; unchanged: boolean }[] = [];
    const id = workspaceId();
    for (const [index, saved] of tab.panes.entries()) {
      const slot = PANE_IDS[index];
      if (saved === undefined || slot === undefined) continue;
      // A document never saved: its bytes, from beside the workspace, still unsaved.
      // @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.openWorkspaceDocument
      if (saved.document.kind === "untitled") {
        const stamp = saved.document.untitled;
        const bytes = await readKeptBytes<Blob>(id, stamp.id);
        if (bytes === undefined) {
          issues.push({ kind: "missing", name: stamp.name ?? L("Untitled") });
          continue;
        }
        openKeptUntitledInPane(slot, bytes, stamp.name ?? L("Untitled"), stamp.dirty);
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
      const unchanged = stampIsUnchanged(saved.document.file, {
        size: one.file.size,
        modified: one.file.lastModified,
      });
      if (!unchanged) issues.push({ kind: "changed", name: one.file.path ?? one.file.name });
      // Its unsaved changes, laid over it only when it is the file they were made on.
      if (unchanged && saved.edits !== undefined) {
        const edits = await readKeptBytes<OverlayEdits>(id, saved.edits);
        try {
          if (edits !== undefined) applyKeptEdits(slot, edits);
        } catch {
          issues.push({ kind: "changed", name: one.file.path ?? one.file.name });
        }
      }
      opened.push({ slot, saved, unchanged });
    }
    const active = PANE_IDS[tab.activePane];
    if (active !== undefined && paneState(active) !== undefined) setActivePane(active);
    const linkFiles = new Map<string, OpenedFile>();
    for (const [key, one] of links) if (one.kind === "opened") linkFiles.set(key, one.file);
    await Promise.all(
      opened.map((one) => applyPane(one.slot, one.saved, one.unchanged, linkFiles))
    );
    if (opened.length > 0) applySurface(tab.surface);
    await restoreFragments(record, opened, issues);
    reportRestoreIssues(issues);
  } finally {
    pauseWorkspaceRecorder(false);
  }
}

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
  issues: RestoreIssue[]
): Promise<void> {
  const { tab } = record.workspace;
  if (tab.fragments.length === 0) return;
  const id = workspaceId();
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
    if (source.kind === "part") {
      const origin = source.part;
      const parent = panes.get(origin.parent);
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
        const edits = origin.edits;
        if (part !== undefined && edits !== undefined) {
          const bytes = await readKeptBytes<Blob>(id, edits.id);
          if (bytes !== undefined) layOver(part, bytes);
        }
      }
      if (part === undefined) {
        // No way home: its own changes come back as bytes of their own, or nothing does.
        const bytes =
          origin.edits === undefined ? undefined : await readKeptBytes<Blob>(id, origin.edits.id);
        if (bytes !== undefined) {
          part = openPart(new Uint8Array(await bytes.arrayBuffer()), origin.name);
        } else {
          issues.push({ kind: "missing", name: origin.name });
        }
      }
    } else if (source.kind === "untitled") {
      const bytes = await readKeptBytes<Blob>(id, source.untitled.id);
      if (bytes !== undefined) {
        part = openPart(
          new Uint8Array(await bytes.arrayBuffer()),
          source.untitled.name ?? L("Untitled")
        );
        if (source.untitled.dirty) paneState(part)?.document.undoHistory.clearKeepingDirty();
      }
    }
    if (part === undefined) continue;
    if (fragment.pane.id !== undefined)
      panes.set(fragment.pane.id, { pane: part, unchanged: true });
    if (index === tab.expandedFragment) expanded = part;
    await applyPane(part, fragment.pane, true, new Map());
    if (fragment.surface.minimapVisible) applyMinimap(surfaceOf(part), fragment.surface);
  }
  if (expanded !== undefined) raisePart(expanded);
  else foldParts();
}

/** A part's changes, kept as its whole content, laid over what its parent gives. */
function layOver(part: PartId, bytes: Blob): void {
  void bytes.arrayBuffer().then((buffer) => {
    const added = new Uint8Array(buffer);
    applyKeptEdits(part, {
      baseSize: 0,
      runs: added.length === 0 ? [] : [{ kind: "added", start: 0, end: added.length }],
      added,
    });
  });
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
    restoreSegments(slot, segments, linkFiles);
  }
  // Queued behind whatever the pane's typing is doing as it mounts, and never waited on for long:
  // a restore that hung on one would keep the recorder paused for good.
  await settledWithin(pane.typing.setSelection(restore.selection.start, restore.selection.end));
  void pane.typing.setInputRegion(restore.inputRegion);
  if (pane.typing.isInsertMode !== restore.insertMode) {
    void pane.typing.setInsertMode(restore.insertMode);
  }
  // Laid out on a frame to come: the pane's scroller registers with the link as it mounts. A tab
  // reloaded behind another draws no frames, so a frame is never waited on for long either.
  for (let frame = 0; frame < 30; frame++) {
    await settledWithin(new Promise((resolve) => requestAnimationFrame(resolve)), 50);
    if (scrollLink.visibleRange(slot, BYTES_PER_ROW) !== undefined) break;
  }
  scrollLink.scrollToOffset(slot, restore.topOffset, BYTES_PER_ROW);
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
function restoreSegments(
  slot: PaneId,
  state: SegmentationState,
  linkFiles: ReadonlyMap<string, OpenedFile>
): void {
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
  restorePartition(slot, new Segmentation(state.contentSize, pieces));
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
  const changed = list("changed");
  if (changed !== "") {
    sections.push(
      `${L("Changed on disk since the last session. Opened without their unsaved changes, segments, parts and tool state:")}\n${changed}`
    );
  }
  reportAlert(L("The workspace was not restored in full"), sections.join("\n\n"));
}
