import { type KeyValueStore, openKeyValueStore } from "@/platform/storage/keyValueStore";
import { createStore } from "@/state/store";

/**
 * The files opened most recently, most recent first, for File ▸ Open Recent.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift
 * @upstream-differs a row holds a `FileSystemFileHandle`, not a path — the page
 * never sees a file's path (the File System Access API hides it), and the handle
 * is what re-opens the file *with its write access*, keeping Save in place.
 * @upstream-differs kept in IndexedDB (the web's preferences file), not
 * `UserDefaults`; the identity of a row is the file's name, the closest thing to
 * a path the page has, so two same-named files in different folders are one row.
 */

/**
 * The permission surface a browser's handle carries, typed where lib.dom stops:
 * `FileSystemFileHandle` there knows no `queryPermission` or `requestPermission`,
 * though a Chromium handle does.
 */
interface HandlePermissions {
  queryPermission?(descriptor: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

/**
 * How many opened files the menu is worth showing. More than a reader re-opens
 * from memory, and the menu's width is not an argument for hundreds of rows.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift#RecentFilesStore.limit
 */
export const RECENT_FILE_LIMIT = 10;

/** One row of File ▸ Open Recent: the handle that re-opens the file, and the name it shows. */
export interface RecentFileEntry {
  readonly handle: FileSystemFileHandle;
  readonly name: string;
}

export interface RecentFilesState {
  readonly rows: readonly RecentFileEntry[];
}

/**
 * One list for the whole origin, not per workspace: upstream's lives in
 * `UserDefaults`, per app, and so do these — every window and tab of the origin
 * shares what was opened last.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift
 */
export const recentFilesStore = createStore<RecentFilesState>({ rows: [] });

const DATABASE = "byteripper-recent-files";
const KEY = "recent";

let storage: KeyValueStore | undefined;
const values = (): KeyValueStore => {
  storage ??= openKeyValueStore(DATABASE);
  return storage;
};

/** Points the recent files at another store: a test's memory one. */
export function setRecentFilesStorage(store: KeyValueStore): void {
  storage = store;
}

function persist(rows: readonly RecentFileEntry[]): void {
  void values().put(KEY, rows);
}

/**
 * Records a successful open: moves the file to the front, drops any older entry
 * for the same name, and caps the list at the limit. A re-open hands a fresh
 * handle to the same file, so the new one replaces the old — its grant is the
 * one the next re-open will use. Returns whether the list changed: re-opening
 * the file already at the front is the common case, and it rewrites nothing.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift#RecentFilesStore.record
 * @upstream-differs keyed by name rather than by the standardized path
 */
export function recordRecentFile(handle: FileSystemFileHandle, name: string): boolean {
  const before = recentFilesStore.getSnapshot().rows;
  const next = [{ handle, name }, ...before.filter((row) => row.name !== name)].slice(
    0,
    RECENT_FILE_LIMIT
  );
  // The common case is re-opening the file already at the front, which changes
  // nothing; the list is read by name, so the list changed only when the names,
  // in order, changed.
  const changed =
    next.length !== before.length || next.some((row, at) => row.name !== before[at]?.name);
  if (!changed) return false;
  recentFilesStore.update(() => ({ rows: next }));
  persist(next);
  return true;
}

/**
 * Forgets every recent file — **Clear Menu** in File ▸ Open Recent. The menu
 * then empties of its own accord: it is rebuilt from this store, so the rows are
 * gone the moment the list is.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift#RecentFilesStore.clear
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.clearRecentFiles
 * @upstream-differs the menu is emptied by rebuilding it from the store, not by
 * `removeAllItems`
 */
export function clearRecentFiles(): void {
  recentFilesStore.update(() => ({ rows: [] }));
  void values().remove(KEY);
}

/**
 * Drops one row — a file that is gone, found out when re-opening it by name.
 * Rows are identified by name, and a name occurs at most once, so this is exact.
 */
export function dropRecentFile(name: string): void {
  const rows = recentFilesStore.getSnapshot().rows;
  const next = rows.filter((row) => row.name !== name);
  if (next.length === rows.length) return;
  recentFilesStore.update(() => ({ rows: next }));
  persist(next);
}

/**
 * The file a stored handle points at, its write permission asked for when it is
 * not already held, so the re-opened file keeps Save in place. The caller must
 * be the user gesture that may be allowed to ask — **File ▸ Open Recent**
 * clicking a row is; a launch, pruning at start, is not, and so does not call
 * this at all.
 *
 * @upstream-differs upstream re-opens by the path it kept; the page has no path,
 * only the handle, and the handle is what carries the write access with it
 */
export async function fileFromRecentHandle(handle: FileSystemFileHandle): Promise<File> {
  const permissions = handle as HandlePermissions;
  if (permissions.queryPermission !== undefined && permissions.requestPermission !== undefined) {
    const state = await permissions.queryPermission({ mode: "readwrite" });
    if (state !== "granted") await permissions.requestPermission({ mode: "readwrite" });
  }
  return handle.getFile();
}

/**
 * Drops rows whose file is no longer reachable. A row that cannot be opened is a
 * ghost in the menu, and the ghost outlives the file for as long as the list is
 * not touched — which can be forever. Called at launch, the way upstream prunes
 * its bookmarks.
 *
 * A row is dropped only when `getFile()` answers `NotFound`; a permission
 * refusal, or a file the reader has not yet re-allowed, is kept, so a valid file
 * is never mistaken for a deleted one.
 *
 * @upstream ByteRipperApp/Documents/RecentFilesStore.swift#RecentFilesStore.pruneMissing
 * @upstream-differs a handle that will not read is dropped only on `NotFound`,
 * never on a permission or I/O failure
 */
export async function pruneMissingRecentFiles(): Promise<void> {
  const current = recentFilesStore.getSnapshot().rows;
  if (current.length === 0) return;
  const kept: RecentFileEntry[] = [];
  for (const row of current) {
    try {
      const permissions = row.handle as HandlePermissions;
      const state =
        permissions.queryPermission === undefined
          ? "granted"
          : await permissions.queryPermission({ mode: "read" });
      // A launch has no gesture to ask with, so a not-granted handle is only
      // *read* when it already may be; the row stays, not deleted for asking.
      if (state === "granted") await row.handle.getFile();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFound") continue;
    }
    kept.push(row);
  }
  if (kept.length === current.length) return;
  recentFilesStore.update(() => ({ rows: kept }));
  persist(kept);
}

/**
 * Reads the origin's recents back, then sweeps the files that are gone. Called
 * once by the shell.
 *
 * @upstream-differs upstream reads its list synchron from `UserDefaults`; this
 * reads it from IndexedDB and prunes afterwards
 */
export async function restoreRecentFiles(): Promise<void> {
  const stored = await values().get<RecentFileEntry[]>(KEY);
  if (stored !== undefined && Array.isArray(stored)) {
    recentFilesStore.update(() => ({ rows: stored }));
  }
  await pruneMissingRecentFiles();
}
