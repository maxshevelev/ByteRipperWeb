import { L } from "@/core/localization/localization";
import {
  type FileStamp,
  type PaneState,
  paneRestore,
  type RestoreIssue,
  stampIsUnchanged,
  WORKSPACE_VERSION,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";
import { desktopFiles, isMissingFile, readFileByPath } from "@/platform/desktop/desktopFiles";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";
import { PANE_IDS, type SlotId } from "@/state/paneId";
import { settingsStore } from "@/state/settingsStore";
import { createStore } from "@/state/store";
import {
  keepWaitingWorkspace,
  pauseWorkspaceRecorder,
  readOwnWorkspace,
} from "@/state/workspace/workspaceRecorder";
import type { WorkspaceRecord } from "@/state/workspace/workspaceRecords";
import { openInPane, paneState, reportAlert, setActivePane } from "@/state/workspaceStore";
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
    const reached = await Promise.all(
      tab.panes.map((pane) =>
        pane === undefined || pane.document.kind !== "file"
          ? Promise.resolve(undefined)
          : reach(
              pane.document.file,
              pane.document.file.handle === undefined
                ? undefined
                : record.handles[pane.document.file.handle],
              asking
            )
      )
    );
    // Something is behind a click: the whole workspace waits for it, rather than coming back in
    // halves.
    if (reached.some((one) => one?.kind === "asks")) {
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
    reached.forEach((one, index) => {
      const saved = tab.panes[index];
      const slot = PANE_IDS[index];
      if (one === undefined || saved === undefined || slot === undefined) return;
      if (one.kind === "issue") {
        issues.push(one.issue);
        return;
      }
      if (one.kind !== "opened" || saved.document.kind !== "file") return;
      openInPane(slot, one.file);
      const unchanged = stampIsUnchanged(saved.document.file, {
        size: one.file.size,
        modified: one.file.lastModified,
      });
      if (!unchanged) issues.push({ kind: "changed", name: one.file.path ?? one.file.name });
      opened.push({ slot, saved, unchanged });
    });
    const active = PANE_IDS[tab.activePane];
    if (active !== undefined && paneState(active) !== undefined) setActivePane(active);
    await Promise.all(opened.map((one) => applyPane(one.slot, one.saved, one.unchanged)));
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
async function applyPane(slot: SlotId, saved: PaneState, unchanged: boolean): Promise<void> {
  const pane = paneState(slot);
  if (pane === undefined) return;
  const restore = paneRestore(saved, pane.document.size, unchanged);
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
