import { L } from "@/core/localization/localization";
import {
  desktopProject,
  type ProjectRefusal,
  type ShellProject,
} from "@/platform/desktop/desktopWindows";
import { ProjectFolder } from "@/platform/files/projectFolder";
import { PANE_IDS } from "@/state/paneId";
import { createStore } from "@/state/store";
import { leaveWithoutAsking, unsavedPanes } from "@/state/unsavedWork";
import {
  currentProject,
  loadRecentProjects,
  projectsStore,
} from "@/state/workspace/projectRecords";
import { discardSession, recordInto, recordWorkspace } from "@/state/workspace/workspaceRecorder";
import { notesPanelIsUp, paneState, reportAlert, workspaceStore } from "@/state/workspaceStore";

/**
 * Projects (`Design/DESKTOP_WINDOWS.md`, D3): every window of the app kept in a folder the person
 * names, `.brw`, and switched between as one.
 *
 * A project is the app's, as upstream's: one open at a time, holding every window. The desktop
 * shell keeps its folder and carries out the commands — opening one replaces every window, saving
 * as one has every window record into it, closing one leaves one empty window — and asks each
 * window's page what only the page knows: whether it holds anything, whether to save the session
 * as a project, what may be lost (`shellWorkspace.ts`). While a project is open everything is
 * recorded into it, so leaving it asks nothing.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift
 * @upstream-differs the shell's main process holds the project and its windows; a page records its
 * own window into it
 */

/**
 * Whether projects are offered: in the desktop shell, which keeps them, and not in a browser.
 *
 * @web-only the owner's decision: a browser cannot open a project's files again by itself
 */
export const canKeepProjects = (): boolean => desktopProject() !== undefined;

/** The question the session without a project is asked before a project replaces it. */
export const projectQuestionStore = createStore<{
  readonly ask: ((answer: "save" | "discard" | "cancel") => void) | undefined;
}>({ ask: undefined });

/** The name a new project is offered: the open one's, or a word for it. */
const suggestedName = () => projectsStore.getSnapshot().current?.name ?? L("Project");

/** What the shell said it could not do, said here. */
function report(refusal: ProjectRefusal): void {
  const name = refusal.name ?? "";
  if (refusal.error === "unreadable") reportAlert(L("The project could not be read."), name);
  if (refusal.error === "unwritable") reportAlert(L("The project could not be written."), name);
}

/**
 * File ▸ Save as Project…: every window — the session, or the open project — written into a new
 * project, which is then the one open.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveAsProject
 */
// help: menu.file.save-as-project
export async function saveAsProject(): Promise<void> {
  const answer = await desktopProject()?.saveAs(suggestedName());
  if (answer !== undefined) report(answer);
  await loadRecentProjects();
}

/**
 * File ▸ Open Project…: a folder holding a project — or a folder holding one project folder —
 * opened in place of every window.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openProject
 * @upstream-differs a command of its own: the shell's Open… panel picks files, not folders
 */
// help: menu.file.open-project
export async function openProjectFromPicker(): Promise<void> {
  const answer = await desktopProject()?.open(undefined, suggestedName());
  if (answer !== undefined) report(answer);
}

/**
 * File ▸ Open Recent Project ▸ a project, by its folder's path.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openRecentProject
 */
export async function openRecentProject(path: string): Promise<void> {
  const answer = await desktopProject()?.open(path, suggestedName());
  if (answer !== undefined) report(answer);
}

/**
 * File ▸ Close Project: the project left as it is — everything in it is written already — and one
 * empty window in place of its windows.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.closeProject
 */
// help: menu.file.close-project
export async function closeProject(): Promise<void> {
  if (currentProject() === undefined) return;
  await desktopProject()?.close();
}

/**
 * The shell's question to this window before a project replaces the session: Save…, Don't Save or
 * Cancel, asked in this window, the one the command came from.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.askToSaveSessionAsProject
 */
export async function askToSaveSession(): Promise<"save" | "discard" | "cancel"> {
  const answer = await new Promise<"save" | "discard" | "cancel">((resolve) =>
    projectQuestionStore.update(() => ({ ask: resolve }))
  );
  projectQuestionStore.update(() => ({ ask: undefined }));
  return answer;
}

/**
 * Don't Save: each document with unsaved changes in this window asked about, one by one. Answers
 * whether every one may go.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.askToClose
 */
export function confirmDiscardingSession(): boolean {
  for (const one of unsavedPanes()) {
    if (!window.confirm(L("%1$@ has unsaved edits. Close it and lose them?", one.name))) {
      return false;
    }
  }
  return true;
}

/** The session this window kept, discarded for a project; the window goes without asking again. */
export async function discardSessionForProject(): Promise<void> {
  leaveWithoutAsking();
  await discardSession();
}

/**
 * Whether this window holds anything a project would keep: a file, a panel, or the Annotations
 * panel up.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.sessionHoldsAnything
 */
export function sessionHoldsAnything(): boolean {
  const state = workspaceStore.getSnapshot();
  return (
    PANE_IDS.some((slot) => paneState(slot) !== undefined) ||
    Object.keys(state.parts).length > 0 ||
    notesPanelIsUp(state)
  );
}

/**
 * Records this window into `project` from now on — or, nothing, into its session — as the shell
 * says the app's project changed: saved as a new one. The session the window kept before is
 * discarded once the project holds it.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.switchTo
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveSession
 */
export async function followProject(
  project: ShellProject | null | undefined,
  fromSession: boolean
): Promise<boolean> {
  enterProject(project ?? undefined);
  const wrote = await recordWorkspace(true);
  if (project && fromSession && wrote) await discardSession();
  await loadRecentProjects();
  return wrote;
}

/** This window, one of `project`'s — or of none — from now on. */
export function enterProject(project: ShellProject | undefined): void {
  const bridge = desktopProject();
  if (project === undefined || bridge === undefined) {
    recordInto(undefined);
    return;
  }
  recordInto({ id: project.path, folder: new ProjectFolder(project.name, bridge) });
}
