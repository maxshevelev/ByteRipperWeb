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
import { desktopFiles, isMissingFile, readFileByPath } from "@/platform/desktop/desktopFiles";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { setMinimapMode, setMinimapVisible } from "@/state/minimapStore";
import { PANE_IDS, type SlotId, WORKSPACE_SURFACE } from "@/state/paneId";
import { editQuery, openSearch, setSearchEncoding } from "@/state/searchStore";
import { sourceIDForFile } from "@/state/segmentSources";
import { restorePartition } from "@/state/segmentsStore";
import { settingsStore } from "@/state/settingsStore";
import { createStore } from "@/state/store";
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
  openInPane,
  openKeptUntitledInPane,
  paneState,
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
    reportRestoreIssues(issues);
  } finally {
    pauseWorkspaceRecorder(false);
  }
}

/**
 * The caret, the selection, the typing mode and the first row on screen — the last once the pane
 * is laid out and can scroll.
 *
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.apply
 * @upstream ByteRipperApp/Workspace/MainViewController+Workspace.swift#MainViewController.scroll
 */
async function applyPane(
  slot: SlotId,
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
  await pane.typing.setSelection(restore.selection.start, restore.selection.end);
  await pane.typing.setInputRegion(restore.inputRegion);
  if (pane.typing.isInsertMode !== restore.insertMode) {
    await pane.typing.setInsertMode(restore.insertMode);
  }
  // Laid out on a frame to come: the pane's scroller registers with the link as it mounts.
  for (let frame = 0; frame < 30; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (scrollLink.visibleRange(slot, BYTES_PER_ROW) !== undefined) break;
  }
  scrollLink.scrollToOffset(slot, restore.topOffset, BYTES_PER_ROW);
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
  slot: SlotId,
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
  if (state.minimapVisible) {
    setMinimapVisible(WORKSPACE_SURFACE, true);
    if (state.minimapMode === "detail" || state.minimapMode === "overview") {
      setMinimapMode(WORKSPACE_SURFACE, state.minimapMode);
    }
  }
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
