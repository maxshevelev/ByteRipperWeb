import { L } from "@/core/localization/localization";
import { inDesktopShell } from "@/platform/desktop/desktopFiles";
import { isProjectFolderName, ProjectFolder } from "@/platform/files/projectFolder";
import { PANE_IDS } from "@/state/paneId";
import { createStore } from "@/state/store";
import { leaveWithoutAsking, unsavedPanes } from "@/state/unsavedWork";
import {
  currentProject,
  handOffProject,
  holdProject,
  newProjectId,
  projectIdOf,
  projectsStore,
  readProjectEntry,
  recordOpenedProject,
} from "@/state/workspace/projectRecords";
import {
  discardSession,
  pauseWorkspaceRecorder,
  recordInto,
  recordWorkspace,
} from "@/state/workspace/workspaceRecorder";
import { notesPanelIsUp, paneState, reportAlert, workspaceStore } from "@/state/workspaceStore";

/**
 * Projects (`Design/WORKSPACE.md`, "Projects"): a workspace kept in a folder the person names,
 * `.brw`, and switched between.
 *
 * A project is live. While it is open everything is recorded into it — the files, the untitled
 * documents, the unsaved changes of its files — so leaving it asks nothing: switching to another
 * project or closing it. Only the session without a project asks, when a project is about to
 * replace it. A switch is a reload of the tab, which says what it switched to
 * (`handOffProject`): nothing of the project left behind stays on the page.
 *
 * Kept where a page can write a folder — a Chromium browser and the desktop shell; Firefox and
 * Safari are not offered the commands.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift
 * @upstream-differs a folder picked with `showDirectoryPicker`; a switch reloads the tab
 */

/**
 * Whether projects are offered: in the desktop shell, which opens a project's files again by
 * their paths, and not in a browser (`inDesktopShell`).
 *
 * @web-only the owner's decision: a browser cannot open a project's files again by itself
 */
export const canKeepProjects = (): boolean =>
  inDesktopShell() && typeof window !== "undefined" && "showDirectoryPicker" in window;

/** The question the session without a project is asked before a project replaces it. */
export const projectQuestionStore = createStore<{
  readonly ask: ((answer: "save" | "discard" | "cancel") => void) | undefined;
}>({ ask: undefined });

/** Asks for a folder to keep a project in, or to open one from; nothing when cancelled. */
async function pickFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options: {
        id?: string;
        mode?: "read" | "readwrite";
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (picker === undefined) return undefined;
  try {
    return await picker({ id: "byteripper-project", mode: "readwrite" });
  } catch {
    return undefined;
  }
}

async function entryNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  const keys = (directory as unknown as { keys(): AsyncIterable<string> }).keys();
  for await (const name of keys) names.push(name);
  return names;
}

/**
 * The folder a project picked as `picked` is kept in: that folder itself when it is a project
 * already — written over: the person chose it — or empty, or named `.brw`; otherwise, a folder of
 * other things such as a job's, a `.brw` made inside it.
 */
async function projectFolderIn(
  picked: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  const folder = new ProjectFolder(picked);
  if (await folder.holdsProject()) {
    await folder.clear();
    return picked;
  }
  const names = await entryNames(picked);
  if (names.length === 0 || isProjectFolderName(picked.name)) return picked;
  const base = projectsStore.getSnapshot().current?.name ?? L("Project");
  let name = `${base}.brw`;
  for (let number = 2; names.includes(name); number++) name = `${base} ${number}.brw`;
  return picked.getDirectoryHandle(name, { create: true });
}

/**
 * File ▸ Save as Project…: the session — or the open project — written into a new project, which
 * is then the one open.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveAsProject
 */
// help: menu.file.save-as-project
export async function saveAsProject(): Promise<boolean> {
  const picked = await pickFolder();
  return picked === undefined ? false : saveSessionAsProject(picked);
}

/**
 * Writes the tab into a project in `picked` and makes it the open one.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveSession
 */
async function saveSessionAsProject(picked: FileSystemDirectoryHandle): Promise<boolean> {
  const was = currentProject();
  // The project being left keeps what it had up to now.
  await recordWorkspace(true);
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await projectFolderIn(picked);
  } catch {
    reportAlert(L("The project could not be written."), picked.name);
    return false;
  }
  const id = (await projectIdOf(directory)) ?? newProjectId();
  if (!(await holdProject(id))) {
    reportAlert(L("The project is open in another tab."), directory.name);
    return false;
  }
  await recordOpenedProject(id, directory);
  const folder = new ProjectFolder(directory);
  recordInto({ id, folder });
  if (!(await recordWorkspace(true)) || !(await folder.holdsProject())) {
    recordInto(was);
    reportAlert(L("The project could not be written."), directory.name);
    return false;
  }
  // The session without a project is this project now.
  if (was === undefined) await discardSession();
  return true;
}

/**
 * File ▸ Open Project…: a folder holding a project — or a folder holding one project folder —
 * opened in place of what is open now.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openProject
 * @upstream-differs a command of its own: a browser's Open… panel cannot choose a folder
 */
// help: menu.file.open-project
export async function openProjectFromPicker(): Promise<void> {
  const picked = await pickFolder();
  if (picked === undefined) return;
  let directory: FileSystemDirectoryHandle | undefined = picked;
  if (!(await new ProjectFolder(picked).holdsProject())) {
    const inside = (await entryNames(picked)).filter(isProjectFolderName);
    directory =
      inside.length === 1 && inside[0] !== undefined
        ? await picked.getDirectoryHandle(inside[0]).catch(() => undefined)
        : undefined;
  }
  if (directory === undefined || (await new ProjectFolder(directory).read()) === undefined) {
    reportAlert(L("The project could not be read."), picked.name);
    return;
  }
  const id = (await projectIdOf(directory)) ?? newProjectId();
  await recordOpenedProject(id, directory);
  await openProject(id);
}

/**
 * File ▸ Open Recent Project ▸ a project.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openRecentProject
 */
export async function openRecentProject(id: string): Promise<void> {
  const entry = await readProjectEntry(id);
  if (entry === undefined) return;
  // The folder may need asking for again; the menu's click is what may ask.
  const permissions = entry.folder as unknown as {
    requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  };
  const state = await permissions.requestPermission?.({ mode: "readwrite" }).catch(() => "denied");
  if (state !== undefined && state !== "granted") return;
  if ((await new ProjectFolder(entry.folder).read()) === undefined) {
    reportAlert(L("The project could not be read."), entry.name);
    return;
  }
  await openProject(id);
}

/**
 * Opens the project of `id` in place of what is open now. The open project is left as it stands;
 * a session without a project that holds anything is offered to be saved as one first.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openProject
 */
async function openProject(id: string): Promise<void> {
  if (currentProject()?.id === id) return;
  if (!(await leaveCurrentSession())) return;
  leaveFor(id);
}

/**
 * File ▸ Close Project: the project is left as it is — everything in it is written already — and
 * the tab goes back to an empty window.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.closeProject
 */
// help: menu.file.close-project
export async function closeProject(): Promise<void> {
  if (currentProject() === undefined) return;
  await recordWorkspace(true);
  // The tab's own record no longer says which project it had open.
  await discardSession();
  leaveFor(undefined);
}

/**
 * Clears the tab for another project: the open project is written and goes without a question;
 * the session without a project asks whether to keep it as a project, and otherwise asks about
 * what would be lost. Answers whether to go on.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.leaveCurrentSession
 */
async function leaveCurrentSession(): Promise<boolean> {
  if (currentProject() !== undefined) {
    await recordWorkspace(true);
    return true;
  }
  if (!sessionHoldsAnything()) return true;
  const answer = await new Promise<"save" | "discard" | "cancel">((resolve) =>
    projectQuestionStore.update(() => ({ ask: resolve }))
  );
  projectQuestionStore.update(() => ({ ask: undefined }));
  if (answer === "save") return saveAsProject();
  if (answer === "cancel") return false;
  for (const one of unsavedPanes()) {
    if (!window.confirm(L("%1$@ has unsaved edits. Close it and lose them?", one.name))) {
      return false;
    }
  }
  await discardSession();
  return true;
}

/**
 * Whether the session without a project has anything a project would keep: a file, a panel, or
 * the Annotations panel up.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.sessionHoldsAnything
 */
function sessionHoldsAnything(): boolean {
  const state = workspaceStore.getSnapshot();
  return (
    PANE_IDS.some((slot) => paneState(slot) !== undefined) ||
    Object.keys(state.parts).length > 0 ||
    notesPanelIsUp(state)
  );
}

/**
 * Reloads the tab into the project of `id`, or into an empty window: everything it held is
 * written already, or was answered for.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.closeEverythingKept
 * @upstream-differs a reload, where upstream closes every window
 */
function leaveFor(id: string | undefined): void {
  pauseWorkspaceRecorder(true);
  leaveWithoutAsking();
  handOffProject(id);
  location.reload();
}
