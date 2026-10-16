import { type FileIdentity, sameFile } from "@/core/agent/agentAnnotation";
import {
  desktopFiles,
  isMissingFile,
  readFileByPath,
  shellReason,
} from "@/platform/desktop/desktopFiles";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";
import { fileFromRecentHandle } from "@/state/recentFilesStore";

/**
 * Opening again a file the window once held, by what is known of it: what a card in the
 * Annotations panel does for a file no pane has now.
 *
 * Two ways back, tried in order. The handle the picker or a drop gave — kept here for every file a
 * pane opened, so this is File ▸ Open Recent's own way, with the same one question for access
 * where a grant has lapsed. Then the full path, where the desktop shell gave one, read through the
 * shell. A browser that gave no handle — Firefox, Safari, the file input — leaves no way back.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.show
 * @upstream-differs upstream re-opens by the URL every document has; the page re-opens by the handle
 * it was given and, in the shell, by the path
 */

/** What an attempt to open the file again came to. */
export type Reopened =
  | { readonly kind: "opened"; readonly file: OpenedFile }
  /** Nothing is at the place the file was: moved or deleted. */
  | { readonly kind: "gone"; readonly where: string }
  /** The file is there and could not be read: a refused permission, a read that failed. */
  | { readonly kind: "failed"; readonly reason: string }
  /** No handle and no path: the page has no way back to the file. */
  | { readonly kind: "unreachable" };

/** How many handles are kept: more files than a bench opens in one sitting. */
const HANDLE_LIMIT = 64;

/** The handles of the files the window has opened, newest last, with what tells each apart. */
let handles: { readonly identity: FileIdentity; readonly handle: FileSystemFileHandle }[] = [];

const identityOf = (file: OpenedFile): FileIdentity => ({
  name: file.name,
  size: file.size,
  modified: file.lastModified,
  ...(file.path === undefined ? {} : { path: file.path }),
});

/** What keeps the handles from one visit to the next is told when they change. */
const listeners = new Set<() => void>();

/** Calls `listener` whenever the kept handles change; returns the way to stop. */
export function onHandlesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The handles kept, oldest first, as they are written for the next visit. */
export const keptHandles = (): readonly {
  readonly identity: FileIdentity;
  readonly handle: FileSystemFileHandle;
}[] => handles;

/**
 * Takes up the handles the last visit kept, under the ones this visit has gathered already: an
 * annotation made then still finds its file now, as a row of Open Recent does.
 */
export function restoreHandles(
  kept: readonly { identity: FileIdentity; handle: FileSystemFileHandle }[]
): void {
  const fresh = handles;
  handles = [
    ...kept.filter((one) => !fresh.some((now) => sameFile(now.identity, one.identity))),
    ...fresh,
  ].slice(-HANDLE_LIMIT);
}

/** Keeps the handle `file` came with, to open it again by. Called for every file a pane opens. */
export function rememberOpenedFile(file: OpenedFile): void {
  const handle = file.handle;
  if (handle === undefined) return;
  const identity = identityOf(file);
  handles = handles.filter((one) => !sameFile(one.identity, identity));
  handles.push({ identity, handle });
  if (handles.length > HANDLE_LIMIT) handles = handles.slice(-HANDLE_LIMIT);
  for (const listener of listeners) listener();
}

/** The handle kept for the file `identity` names, the newest first. */
function handleFor(identity: FileIdentity): FileSystemFileHandle | undefined {
  for (let index = handles.length - 1; index >= 0; index--) {
    const one = handles[index];
    if (one !== undefined && sameFile(one.identity, identity)) return one.handle;
  }
  return undefined;
}

/** Forgets every kept handle. */
export function forgetOpenedFilesForTesting(): void {
  handles = [];
}

/** Who follows a file that a save in place gave a new date, and maybe a new size. */
const replacedListeners = new Set<(from: FileIdentity, to: FileIdentity) => void>();

/** Calls `listener` with the old identity and the new whenever a save in place changes one. */
export function onFileReplaced(
  listener: (from: FileIdentity, to: FileIdentity) => void
): () => void {
  replacedListeners.add(listener);
  return () => replacedListeners.delete(listener);
}

/**
 * A file saved in place: the same file, which the page now knows by the date — and the size —
 * the save gave it. Its handle is kept under that, and what was known by the old is told.
 *
 * @web-only upstream knows a file by its URL, which a save leaves as it was; a page without a path
 * knows one by its name, size and date, which a save changes
 */
export function rememberSavedFile(before: OpenedFile, after: OpenedFile): void {
  const from = identityOf(before);
  const to = identityOf(after);
  if (after.handle !== undefined) handles = handles.filter((one) => !sameFile(one.identity, from));
  rememberOpenedFile(after);
  if (sameFile(from, to)) return;
  for (const listener of replacedListeners) listener(from, to);
}

/** Opens the file `identity` names again, by its handle and then by its path. */
export async function reopenFile(identity: FileIdentity): Promise<Reopened> {
  const handle = handleFor(identity);
  let missing = false;
  if (handle !== undefined) {
    try {
      return { kind: "opened", file: openedFileFrom(await fileFromRecentHandle(handle), handle) };
    } catch (error) {
      // A handle whose file is gone may still have a path that leads somewhere else; any other
      // failure is the file's own, and is said.
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
      }
      missing = true;
    }
  }
  const files = desktopFiles();
  const path = identity.path;
  if (path !== undefined && files !== undefined) {
    try {
      const { stat, blob } = await readFileByPath(files, path);
      return {
        kind: "opened",
        file: {
          name: stat.path.split(/[\\/]/).pop() ?? identity.name,
          size: stat.size,
          lastModified: Math.floor(stat.modified),
          source: blob,
          path: stat.path,
        },
      };
    } catch (error) {
      if (isMissingFile(error)) return { kind: "gone", where: path };
      return { kind: "failed", reason: shellReason(error) };
    }
  }
  return missing ? { kind: "gone", where: path ?? identity.name } : { kind: "unreachable" };
}
