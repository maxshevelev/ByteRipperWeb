import { desktopProject } from "@/platform/desktop/desktopWindows";
import type { ProjectFolder } from "@/platform/files/projectFolder";
import { createStore } from "@/state/store";

/**
 * The project the app has open and the projects opened lately, as this window's page knows them
 * (`Design/DESKTOP_WINDOWS.md`, D3). The desktop shell keeps both — one project for the app,
 * holding every window, as upstream's — and names a project by its folder's path.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore
 * @upstream-differs the list is the shell's, kept beside its profile; the page asks for it
 */

export interface ProjectsState {
  /**
   * The project the app has open, by its folder's path, or nothing for the session without one.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.currentProject
   */
  readonly current: { readonly id: string; readonly name: string } | undefined;
  /**
   * The projects opened lately, newest first.
   *
   * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.recent
   */
  readonly recent: readonly { readonly id: string; readonly name: string }[];
}

export const projectsStore = createStore<ProjectsState>({ current: undefined, recent: [] });

let currentFolder: { readonly id: string; readonly folder: ProjectFolder } | undefined;

/**
 * The open project and its folder: what the recorder writes this window into instead of its
 * session.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.project
 */
export const currentProject = () => currentFolder;

/**
 * Records into the project of `id` from now on, or — nothing — into the window's session.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.switchTo
 */
export function switchToProject(project: { id: string; folder: ProjectFolder } | undefined): void {
  currentFolder = project;
  projectsStore.update((state) => ({
    ...state,
    current: project === undefined ? undefined : { id: project.id, name: project.folder.name },
  }));
}

/** Reads the list of projects opened lately into the store. */
export async function loadRecentProjects(): Promise<void> {
  const list =
    (await desktopProject()
      ?.recent()
      .catch(() => undefined)) ?? [];
  const recent = list.map((one) => ({ id: one.path, name: one.name }));
  projectsStore.update((state) => ({ ...state, recent }));
}

/**
 * Open Recent Project ▸ Clear Menu.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.clear
 */
export async function clearRecentProjects(): Promise<void> {
  await desktopProject()
    ?.clearRecent()
    .catch(() => undefined);
  await loadRecentProjects();
}
