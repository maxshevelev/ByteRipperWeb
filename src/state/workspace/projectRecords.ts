import { ProjectFolder } from "@/platform/files/projectFolder";
import { openKeyValueStore } from "@/platform/storage/keyValueStore";
import { createStore } from "@/state/store";

/**
 * The projects this browser knows (`Design/WORKSPACE.md`, "Projects"): for each, the handle of
 * its folder and the handles of its files, which a project's own `Project.json` cannot hold — a
 * browser hands a page no path — and which of them the project is that this tab has open.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore
 * @upstream-differs entries in IndexedDB holding the folder's handle and its files' handles, where
 * upstream keeps the packages' paths in the app's defaults
 */

/** One project as this browser knows it. */
export interface ProjectEntry {
  readonly name: string;
  readonly folder: FileSystemDirectoryHandle;
  /** The handles of its files, by the key each `FileStamp.handle` names. */
  readonly handles: Readonly<Record<string, FileSystemFileHandle>>;
  /** When it was last opened: what Open Recent Project sorts by. */
  readonly openedAt: number;
  /** Whether Open Recent Project lists it; Clear Menu takes it off the list, not out of reach. */
  readonly listed: boolean;
}

/** @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.limit */
export const RECENT_PROJECTS_LIMIT = 10;

const entries = openKeyValueStore("byteripper-projects");

export interface ProjectsState {
  /**
   * The project this tab has open, or nothing for the session without one.
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
 * The open project and its folder: what the recorder writes into instead of the tab's session.
 *
 * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.project
 */
export const currentProject = () => currentFolder;

/**
 * Records into the project of `id` from now on, or — nothing — into the tab's session.
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

export async function readProjectEntry(id: string): Promise<ProjectEntry | undefined> {
  return entries.get<ProjectEntry>(id).catch(() => undefined);
}

/** The id this browser knows the project in `folder` by, if it knows it. */
export async function projectIdOf(folder: FileSystemDirectoryHandle): Promise<string | undefined> {
  for (const { key, value } of await entries.entries<ProjectEntry>().catch(() => [])) {
    if (await value.folder.isSameEntry(folder).catch(() => false)) return key;
  }
  return undefined;
}

/** A new id for a project this browser has not seen. */
export const newProjectId = () =>
  `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Puts the project on top of the list, as opened now.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.record
 */
export async function recordOpenedProject(id: string, folder: FileSystemDirectoryHandle) {
  const known = await readProjectEntry(id);
  await entries
    .put(id, {
      name: new ProjectFolder(folder).name,
      folder,
      handles: known?.handles ?? {},
      openedAt: Date.now(),
      listed: true,
    } satisfies ProjectEntry)
    .catch(() => undefined);
  await loadRecentProjects();
}

/** Keeps the handles of the project's files, which its folder cannot. */
export async function recordProjectHandles(
  id: string,
  handles: Readonly<Record<string, FileSystemFileHandle>>
): Promise<void> {
  const known = await readProjectEntry(id);
  if (known === undefined) return;
  await entries.put(id, { ...known, handles }).catch(() => undefined);
}

/** Reads the list of projects opened lately into the store. */
export async function loadRecentProjects(): Promise<void> {
  const all = await entries.entries<ProjectEntry>().catch(() => []);
  const recent = all
    .filter(({ value }) => value.listed)
    .sort((left, right) => right.value.openedAt - left.value.openedAt)
    .slice(0, RECENT_PROJECTS_LIMIT)
    .map(({ key, value }) => ({ id: key, name: value.name }));
  projectsStore.update((state) => ({ ...state, recent }));
}

/**
 * Open Recent Project ▸ Clear Menu: the list emptied, each project still reachable from the tab
 * that has it open.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.clear
 */
export async function clearRecentProjects(): Promise<void> {
  for (const { key, value } of await entries.entries<ProjectEntry>().catch(() => [])) {
    await entries.put(key, { ...value, listed: false }).catch(() => undefined);
  }
  await loadRecentProjects();
}

/**
 * The project the next load of this tab opens — or, empty, that it opens nothing: a switch between
 * projects is a reload, which leaves nothing of the one before behind.
 *
 * @web-only upstream switches by closing and opening windows; a page starts over
 */
const HANDOFF_KEY = "byteripper.openProject";

export function handOffProject(id: string | undefined): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, id ?? "");
  } catch {
    // Storage refused: the reload restores what it would have.
  }
}

/** What the last load handed to this one: a project's id, "" for nothing, or no hand-off at all. */
export function takeProjectHandoff(): string | undefined {
  try {
    const value = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

const LOCK_PREFIX = "byteripper-project:";
/** The projects this tab holds. */
const heldHere = new Set<string>();

/**
 * Holds the project of `id` for this tab, so that a second tab does not write into it too.
 * Answers false when another tab has it.
 *
 * @web-only upstream's app has one project open at a time; a browser has tabs
 */
export function holdProject(id: string): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined || heldHere.has(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(`${LOCK_PREFIX}${id}`, { ifAvailable: true }, (lock) => {
      if (lock !== null) heldHere.add(id);
      resolve(lock !== null);
      // Held for as long as the tab is: a project is left by a reload.
      return lock === null ? undefined : new Promise<void>(() => undefined);
    });
  });
}
