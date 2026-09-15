import {
  decodeFavoritesDocument,
  decodePatternLibrary,
  encodeFavoritesDocument,
  encodePatternLibrary,
  type FavoritesDocument,
  type LibraryConflict,
  type LibraryResolution,
  mergePatternLibraries,
  PATTERN_LIBRARY_RULES,
  type PatternLibrary,
  resolvePatternLibrary,
} from "@/core/search/patternLibrary";
import {
  entriesSayTheSame,
  isSameSearch,
  type SearchPatternEntry,
} from "@/core/search/searchPatternEntry";
import {
  type FolderAdoption,
  FolderSync,
  libraryNames,
  type SharedFileState,
  type SyncFolderFiles,
  writerOf,
} from "@/core/sync/folderSync";
import { syncDocument } from "@/core/sync/syncDocument";
import {
  canonicalCollection,
  collectionsEqual,
  mintId,
  orderedEntries,
  sortKeyBetween,
  withOrder,
} from "@/core/sync/syncedCollection";
import { libraryFileName, stampOf } from "@/core/sync/syncFolderNaming";
import type { MergeOutcome } from "@/core/sync/syncMerge";
import { incremented } from "@/core/sync/versionVector";
import { sha256 } from "@/firmware/me/crypto/digest";
import {
  browserFolderPlatform,
  type FolderAccess,
  type FolderPlatform,
  type LibraryFolder,
} from "@/platform/files/libraryFolder";
import { type KeyValueStore, openKeyValueStore } from "@/platform/storage/keyValueStore";
import { createStore } from "@/state/store";

/**
 * The patterns the user keeps: named searches that survive use of the app
 * (§11, `Design/FAVORITES_SYNC_WEB.md`).
 *
 * The counterpart of the find history, and deliberately its opposite in the two
 * ways that matter. The history is a cache — capped, written by every search,
 * evicted by the next one — while this is a list the user curates: no cap, no
 * eviction, and the order is theirs, because the order a bench keeps its
 * patterns in is knowledge too.
 *
 * What this browser keeps is upstream's document — its library, and the state
 * it last agreed with each other machine's file — in IndexedDB rather than in a
 * file. A folder the user shares is where the library meets the other machines:
 * the loop that keeps the two level is `FolderSync`, and this store is its owner
 * — the one instance, the folder it publishes to, and the events that make it
 * look again.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile
 * @upstream-differs a store over IndexedDB and a directory handle, where upstream has a file and a bookmark
 */

const DATABASE = "byteripper-favorites";
/** @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile.url */
const DOCUMENT_KEY = "Favorites";
const DEVICE_KEY = "Device";
/**
 * The folder the library is published to, kept as its handle.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.folderBookmarkKey
 */
const FOLDER_KEY = "Folder";
/** Other tabs of the app, on the same profile, are the same device. */
const CHANNEL_NAME = "byteripper-favorites";
/** Held around a merge-and-publish, so two tabs never publish over each other. */
const LOCK_NAME = "byteripper-favorites-sync";
/**
 * How often the folder is asked about when nothing has said it changed. A
 * backstop: the observer and the window coming forward carry a change promptly.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.pollInterval
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSyncSettings.pollInterval
 */
const POLL_MS = 60_000;

/**
 * This browser, as far as the library is concerned. The id never changes once
 * minted — except by the user saying a file in the folder was this browser's
 * before its data was lost — and the label is what a person reading the folder
 * is told.
 *
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#DeviceIdentity
 * @upstream-differs a random id kept with the library: a browser has no hardware id to take one from
 */
export interface DeviceIdentity {
  readonly id: string;
  readonly label: string;
}

/**
 * Where the library is published, and whether this visit may write there.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.sharedFolder
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.hasFolderAccess
 */
export interface FolderStatus {
  readonly name: string;
  readonly access: FolderAccess;
}

export interface FavoritesState {
  /** What this browser believes, and what it has agreed with others. */
  readonly document: FavoritesDocument;
  /**
   * The kept patterns, in the order the user put them in.
   *
   * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.favorites
   */
  readonly favorites: readonly SearchPatternEntry[];
  readonly device: DeviceIdentity;
  /** Whether what was kept from an earlier visit has been read back yet. */
  readonly restored: boolean;
  /** An import that raised questions, waiting for their answers. */
  readonly pendingImport: PendingImport | undefined;
  /**
   * What a merge with the folder could not decide. While this is non-empty the
   * library is read-only.
   *
   * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.conflicts
   */
  readonly conflicts: readonly LibraryConflict[];
  /** The folder the library is published to, or `undefined` while it is kept to this browser. */
  readonly folder: FolderStatus | undefined;
  /**
   * Why the library could not be published, if it could not.
   *
   * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.publishError
   */
  readonly publishError: string | undefined;
  /**
   * When the library and the folder were last agreed.
   *
   * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.lastPublished
   */
  readonly lastPublished: number | undefined;
  /**
   * Whether the last answer failed to take, because the folder changed again
   * before it could be published.
   *
   * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.answerDidNotTake
   */
  readonly answerDidNotTake: boolean;
}

/**
 * A library file merged into this browser's list that could not be merged
 * silently. Nothing of it is kept until the questions are answered — and if they
 * are not, nothing of it is kept at all.
 *
 * @web-only upstream has no import; its questions come from the folder
 */
export interface PendingImport {
  readonly fileName: string;
  readonly outcome: MergeOutcome<SearchPatternEntry>;
}

/** What an import did, for the line that reports it. */
export type ImportResult =
  | { readonly kind: "unreadable" }
  | { readonly kind: "readOnly" }
  | { readonly kind: "asking"; readonly questions: number }
  | {
      readonly kind: "imported";
      readonly added: number;
      readonly changed: number;
      readonly removed: number;
    };

/** One library file in the folder, as the Favorites tab lists them. */
export interface FolderLibraryFile {
  readonly name: string;
  /** Who wrote it, in its own words; empty for a file that cannot be read. */
  readonly machine: string;
  readonly entries: number;
  readonly readable: boolean;
  /** This browser's own file. */
  readonly own: boolean;
  /**
   * Another file that carries this browser's name and says whose it is: one
   * this browser may have written before its data was lost.
   */
  readonly adoptable: boolean;
}

/**
 * The list's one channel: the find bar's menu and the Favorites tab both read
 * it, and neither owns it.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.didChangeNotification
 */
export const favoritesStore = createStore<FavoritesState>({
  document: syncDocument(),
  favorites: [],
  device: { id: "", label: deviceLabel() },
  restored: false,
  pendingImport: undefined,
  conflicts: [],
  folder: undefined,
  publishError: undefined,
  lastPublished: undefined,
  answerDidNotTake: false,
});

let storage: KeyValueStore | undefined;
const values = (): KeyValueStore => {
  storage ??= openKeyValueStore(DATABASE);
  return storage;
};

/** Points the favourites at another store: a test's memory one. */
export function setFavoritesStorage(store: KeyValueStore): void {
  storage = store;
}

let platform: FolderPlatform = browserFolderPlatform;

/** Points the favourites at another way of reaching folders: a test's memory one. */
export function setFolderPlatform(next: FolderPlatform): void {
  platform = next;
}

/**
 * The loop, and the folder it publishes to. One instance per page, rebuilt only
 * when this browser takes another device's identity.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.sync
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.syncInstance
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.publishedFolder
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.restoredLocation
 */
let loopInstance: FolderSync<SearchPatternEntry> | undefined;
let folder: LibraryFolder | undefined;
let stopWatching: (() => void) | undefined;
let channel: BroadcastChannel | undefined;
let listeningForReturn = false;

/**
 * Reads the library and this browser's identity back, minting the identity the
 * first time; finds the folder it was published to, and — where this visit may
 * still write there — merges what the folder holds and begins watching it.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.start
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile.read
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#DeviceIdentity.current
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.restore
 */
export async function restoreFavorites(): Promise<void> {
  detachFolder();
  const device = await storedDevice();
  const document = await storedDocument();
  favoritesStore.update((state) => ({ ...state, device, restored: true, folder: undefined }));
  build(device.id, document);
  refresh();
  askToPersist();
  listenToOtherTabs();
  listenForReturn();

  const kept = await values().get<unknown>(FOLDER_KEY);
  const restored = kept === undefined ? undefined : platform.restore(kept);
  if (restored === undefined) return;
  folder = restored;
  const access = await restored.permission(false);
  setFolderStatus(restored, access);
  if (access === "granted") await attach(restored);
  refresh();
}

/**
 * Keeps `entry`, at the end of the list. Refused — `false` — when the same search
 * is already kept, whatever it is called, and while a question about the library
 * stands.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.add
 */
export function addFavorite(entry: SearchPatternEntry, now: number = Date.now()): boolean {
  const device = ensureDevice().id;
  return change((library) => {
    if (library.entries.some((kept) => isSameSearch(kept, entry))) return undefined;
    const last = orderedEntries(library).at(-1);
    const kept: SearchPatternEntry = {
      ...entry,
      sortKey: sortKeyBetween(last?.sortKey, undefined),
      modifiedAt: now,
      device,
    };
    return { ...library, entries: [...library.entries, kept] };
  });
}

/**
 * Replaces the list — what the Favorites tab saves, a reorder, an edit and a
 * removal included. The order given is the order kept; an entry whose content
 * changed is stamped with the time and this device, and an entry that is gone
 * leaves a tombstone, both so another machine can make sense of the result.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.replace
 */
export function replaceFavorites(
  entries: readonly SearchPatternEntry[],
  now: number = Date.now()
): boolean {
  const device = ensureDevice().id;
  return change((library) => {
    const before = new Map<string, SearchPatternEntry>();
    for (const entry of library.entries) if (!before.has(entry.id)) before.set(entry.id, entry);
    const stamped = entries.map((entry) => {
      const old = before.get(entry.id);
      if (old === undefined || entriesSayTheSame(old, entry)) return entry;
      return { ...entry, modifiedAt: now, device };
    });
    const survivors = new Set(stamped.map((entry) => entry.id));
    const tombstones = [
      ...library.tombstones,
      ...library.entries
        .filter((gone) => !survivors.has(gone.id))
        .map((gone) => ({ id: gone.id, deletedAt: now, device })),
    ];
    return withOrder({ ...library, tombstones }, stamped);
  });
}

/**
 * The kept entry for the same search as `entry`, if there is one — what
 * "already a favourite, as *Foo*" is read from.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.existing
 */
export function existingFavorite(entry: {
  readonly pattern: string;
  readonly encoding: SearchPatternEntry["encoding"];
  readonly caseSensitive: boolean;
}): SearchPatternEntry | undefined {
  return favoritesStore
    .getSnapshot()
    .favorites.find((kept) => isSameSearch(kept, entry as SearchPatternEntry));
}

/**
 * A short, stable stand-in for a device id: the head of its SHA-256, in hex —
 * what this browser's library file is named by.
 *
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#DeviceIdentity.digest
 */
export function deviceStamp(deviceId: string): string {
  return stampOf(sha256(new TextEncoder().encode(deviceId)));
}

// MARK: - The folder

/**
 * What is wrong with the library, in a few words, or `undefined` when nothing
 * is. One wording for every place that says it — the Favorites tab and the Find
 * bar's menu — because a problem met in two places under two names is two
 * problems as far as anyone can tell.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.syncProblem
 */
export function syncProblem(state: FavoritesState): string | undefined {
  const count = state.conflicts.length;
  if (count > 0) return count === 1 ? "1 conflicting change" : `${count} conflicting changes`;
  if (state.folder === undefined) return undefined;
  if (state.folder.access !== "granted") return "no access to the library folder";
  if (state.publishError !== undefined) return "not syncing";
  return undefined;
}

/** True where the library can be kept in a folder and written there: Chromium. */
export function canKeepLibraryFolder(): boolean {
  return platform.canKeepFolder;
}

/**
 * Why the library cannot be kept in a folder here, when it is something the user
 * can change — a page opened at an insecure address — or `undefined`.
 */
export function whyNoLibraryFolder(): string | undefined {
  return platform.whyNoFolder;
}

/**
 * Asks for a folder to keep the library in, and reads what it already holds —
 * which decides whether publishing into it is a question at all.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.inspectShared
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.runFolderPanel
 */
export async function chooseLibraryFolder(): Promise<
  | { readonly folder: LibraryFolder; readonly holds: SharedFileState }
  | { readonly refused: string }
  | undefined
> {
  const picked = await platform.pick();
  if (picked === undefined) return undefined;
  const access = await picked.permission(true);
  if (access !== "granted") return { refused: picked.name };
  return { folder: picked, holds: await loop().inspect(picked.files) };
}

/**
 * Publishes into `picked`, deciding what to do with a library already there, and
 * remembers the folder for the next visit. Returns the folder the library was
 * published to before, when it was a different one: its copy of this browser's
 * file is left there, and whether to remove it is the user's to say.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.publish
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.remember
 */
export async function publishFavoritesTo(
  picked: LibraryFolder,
  adopting: FolderAdoption
): Promise<LibraryFolder | undefined> {
  const previous = folder;
  const moved = previous !== undefined && !(await previous.isSame(picked)) ? previous : undefined;
  detachFolder();
  folder = picked;
  await withLock(() => loop().publish(picked.files, adopting));
  await values().put(FOLDER_KEY, picked.stored);
  setFolderStatus(picked, "granted");
  stopWatching = watchFolder(picked);
  refresh();
  return favoritesStore.getSnapshot().publishError === undefined ? moved : undefined;
}

/**
 * Stops publishing: the library carries on in this browser, where it always
 * was, and the folder's files are left where they are. Returns the folder it
 * was published to, whose copy of this browser's file the user may remove.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.keepHerePressed
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.forget
 */
export async function keepFavoritesInBrowser(): Promise<LibraryFolder | undefined> {
  const previous = folder;
  detachFolder();
  await loop().setFolder(undefined);
  await values().remove(FOLDER_KEY);
  setFolderStatus(undefined);
  refresh();
  return previous;
}

/**
 * Removes this browser's file from a folder the library no longer lives in.
 * Only ever this browser's own: another machine's file is never the app's to
 * remove.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.offerToTrash
 */
export async function removeOwnFileFrom(previous: LibraryFolder): Promise<void> {
  if (previous.files.remove === undefined) return;
  await previous.files.remove(loop().ownFileName);
}

/**
 * Asks, from a click, for the permission a new visit has not been given yet.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.hasAccess
 */
export async function allowFolderAccess(): Promise<void> {
  const current = folder;
  if (current === undefined) return;
  const access = await current.permission(true);
  setFolderStatus(current, access);
  if (access === "granted") await attach(current);
  refresh();
}

/**
 * Merges what the folder holds, and publishes this browser's file.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.start
 */
export async function syncFavorites(): Promise<void> {
  if (folder === undefined || favoritesStore.getSnapshot().folder?.access !== "granted") return;
  await withLock(() => loop().sync());
  refresh();
}

/**
 * Applies the user's answers to a merge that had questions, and publishes the
 * result.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.resolve
 */
export async function resolveFavorites(
  answers: ReadonlyMap<string, LibraryResolution>
): Promise<void> {
  await withLock(() => loop().resolve(answers));
  refresh();
}

/**
 * The library files in the folder, each with who wrote it — so a browser whose
 * data was lost can see its old file there, and say it was its own.
 *
 * @web-only upstream's device id is the hardware's and is never lost
 */
export async function folderLibraries(): Promise<FolderLibraryFile[]> {
  const current = folder;
  if (current === undefined) return [];
  const own = loop().ownFileName;
  const label = favoritesStore.getSnapshot().device.label;
  const listed: FolderLibraryFile[] = [];
  for (const name of await libraryNames(current.files)) {
    try {
      const library = decodePatternLibrary((await current.files.read(name)) ?? "{}");
      listed.push({
        name,
        machine: library.machine,
        entries: library.entries.length,
        readable: true,
        own: name === own,
        adoptable:
          name !== own &&
          library.machine === label &&
          writerOf(library, name, deviceStamp) !== undefined,
      });
    } catch {
      listed.push({
        name,
        machine: "",
        entries: 0,
        readable: false,
        own: name === own,
        adoptable: false,
      });
    }
  }
  return listed;
}

/**
 * **This was me.** Takes the device a file in the folder belongs to as this
 * browser's own, and carries on writing that file instead of a second one — for
 * a browser whose data was cleared, or that Safari evicted, and which came back
 * as a stranger. The file this browser had started since is its own, and goes.
 *
 * @web-only upstream's device id is the hardware's and is never lost
 */
export async function adoptLibraryFile(name: string): Promise<boolean> {
  const current = folder;
  if (current === undefined) return false;
  const text = await current.files.read(name);
  if (text === undefined) return false;
  const writer = writerOf(decodePatternLibrary(text), name, deviceStamp);
  if (writer === undefined) return false;

  const previous = loop();
  await previous.idle();
  const abandoned = previous.ownFileName;
  const device = { id: writer, label: favoritesStore.getSnapshot().device.label };
  await values().put(DEVICE_KEY, device);
  favoritesStore.update((state) => ({ ...state, device }));
  const adopted = build(writer, previous.document);
  await withLock(() => adopted.setFolder(current.files));
  if (abandoned !== name && current.files.remove !== undefined) {
    try {
      if ((await current.files.read(abandoned)) !== undefined)
        await current.files.remove(abandoned);
    } catch {
      // Left where it is: another machine reads it, and it says nothing the
      // adopted file does not now say too.
    }
  }
  refresh();
  return true;
}

/**
 * Takes what a folder holds without writing to it — for a browser that cannot
 * keep a folder, handed one for the occasion. What both sides changed is asked
 * in the resolver, like any merge.
 *
 * @web-only Firefox and Safari read a folder the user picks; upstream always writes one
 */
export async function getFavoritesFromFolder(): Promise<
  { readonly folder: string; readonly read: number; readonly problems: number } | undefined
> {
  const files = await platform.pickToRead();
  if (files === undefined) return undefined;
  const result = await loop().fetchFrom(files);
  refresh();
  return { folder: files.name, ...result };
}

/** Settles once the library has done everything asked of it so far. */
export async function favoritesSettled(): Promise<void> {
  await loop().idle();
}

// MARK: - Carrying the library by hand

/**
 * The library as a file: named and written exactly as this browser's file in a
 * shared folder would be, so an export can be put into one by hand and every
 * machine reading the folder takes it for what it is.
 *
 * @web-only upstream keeps its library in a folder and never hands it over as a file
 */
export function exportFavorites(): { readonly name: string; readonly contents: string } {
  const device = ensureDevice();
  const library = favoritesStore.getSnapshot().document.local;
  return {
    name: libraryFileName(deviceStamp(device.id)),
    contents: encodePatternLibrary(canonicalCollection({ ...library, machine: device.label })),
  };
}

/**
 * Merges a library file into this browser's list — a merge, never a
 * replacement. The file is a peer this browser has agreed nothing with, as
 * upstream joins a folder: everything either side holds is kept, a deletion wins
 * only over what it is later than, and what both sides hold differently is
 * asked — in which case nothing is kept until {@link answerImport}.
 *
 * @web-only upstream has no import
 */
export function importFavorites(
  contents: string,
  fileName: string,
  now: number = Date.now()
): ImportResult {
  let theirs: PatternLibrary;
  try {
    // A JSON object without entries would read as an empty library, which is
    // not what a person who picked the wrong file should be told.
    const raw: unknown = JSON.parse(contents);
    if (typeof raw !== "object" || raw === null || !("entries" in raw)) {
      return { kind: "unreadable" };
    }
    theirs = decodePatternLibrary(contents);
  } catch {
    return { kind: "unreadable" };
  }

  const state = favoritesStore.getSnapshot();
  if (state.conflicts.length > 0) return { kind: "readOnly" };
  const local = state.document.local;
  const outcome = mergePatternLibraries(undefined, local, theirs, { assumeConcurrent: true, now });
  if (outcome.conflicts.length > 0) {
    favoritesStore.update((current) => ({ ...current, pendingImport: { fileName, outcome } }));
    return { kind: "asking", questions: outcome.conflicts.length };
  }
  return keepImported(
    local,
    outcome.library,
    (current) =>
      mergePatternLibraries(undefined, current, theirs, { assumeConcurrent: true, now }).library
  );
}

/**
 * Applies the answers to a pending import and keeps the result.
 *
 * @web-only the import's half of `FolderSync.resolve`
 */
export function answerImport(
  answers: ReadonlyMap<string, LibraryResolution>,
  now: number = Date.now()
): ImportResult | undefined {
  const { pendingImport, document } = favoritesStore.getSnapshot();
  if (pendingImport === undefined) return undefined;
  favoritesStore.update((state) => ({ ...state, pendingImport: undefined }));
  const resolved = resolvePatternLibrary(pendingImport.outcome, answers, now);
  return keepImported(document.local, resolved, () => resolved);
}

/** Drops a pending import: the list stays as it was before the file was opened. */
export function abandonImport(): void {
  favoritesStore.update((state) => ({ ...state, pendingImport: undefined }));
}

/**
 * What a browser is called where it has to be told apart from the others:
 * "Chrome on Windows". Read from the user agent, which says both.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.thisMachine
 * @upstream-differs the browser and the system, where upstream has the Mac's own name
 */
export function deviceLabelFor(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Android/.test(userAgent)
          ? "Android"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : undefined;
  return system === undefined ? browser : `${browser} on ${system}`;
}

// MARK: - Inside

/** The loop, built on first use when nothing has restored one yet. */
function loop(): FolderSync<SearchPatternEntry> {
  return loopInstance ?? build(ensureDevice().id, favoritesStore.getSnapshot().document);
}

/**
 * Builds the loop for `device` over `document`, and makes it the one.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.sync
 */
function build(device: string, document: FavoritesDocument): FolderSync<SearchPatternEntry> {
  const made = new FolderSync<SearchPatternEntry>({
    rules: PATTERN_LIBRARY_RULES,
    device,
    machine: () => favoritesStore.getSnapshot().device.label,
    stamp: deviceStamp,
    document,
    persist: (kept) => {
      void values().put(DOCUMENT_KEY, encodeFavoritesDocument(kept));
      channel?.postMessage("changed");
    },
  });
  made.onChange(() => {
    if (loopInstance === made) refresh();
  });
  loopInstance = made;
  return made;
}

/**
 * A change made here: applied to the list on screen at once, and handed to the
 * loop to apply to what it holds when its turn comes. Refused while a question
 * about the library stands.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.library
 */
function change(transform: (library: PatternLibrary) => PatternLibrary | undefined): boolean {
  const state = favoritesStore.getSnapshot();
  if (state.conflicts.length > 0) return false;
  const next = transform(state.document.local);
  if (next === undefined) return false;
  const running = loop();
  const shown: PatternLibrary = { ...next, vector: incremented(next.vector, running.device) };
  favoritesStore.update((current) => ({
    ...current,
    document: { ...current.document, local: shown },
    favorites: orderedEntries(shown),
  }));
  void running.edit(transform).then(refresh);
  return true;
}

/**
 * Keeps a merged import, if it changed anything, and counts what it did. A file
 * that holds nothing new is not a write: the counters stay where they were.
 */
function keepImported(
  before: PatternLibrary,
  merged: PatternLibrary,
  transform: (current: PatternLibrary) => PatternLibrary
): ImportResult {
  const was = new Map(before.entries.map((entry) => [entry.id, entry]));
  const kept = new Set(merged.entries.map((entry) => entry.id));
  let added = 0;
  let changed = 0;
  for (const entry of merged.entries) {
    const old = was.get(entry.id);
    if (old === undefined) added += 1;
    else if (!entriesSayTheSame(old, entry)) changed += 1;
  }
  const removed = before.entries.filter((entry) => !kept.has(entry.id)).length;

  const same = collectionsEqual(
    canonicalCollection({ ...merged, vector: before.vector }),
    canonicalCollection(before),
    PATTERN_LIBRARY_RULES
  );
  if (!same) change(transform);
  return { kind: "imported", added, changed, removed };
}

/** Puts what the loop holds on screen. */
function refresh(): void {
  const running = loopInstance;
  if (running === undefined) return;
  const error = running.publishError;
  favoritesStore.update((state) => ({
    ...state,
    document: running.document,
    favorites: orderedEntries(running.library),
    conflicts: running.conflicts,
    publishError:
      error === undefined ? undefined : error instanceof Error ? error.message : String(error),
    lastPublished: running.lastPublished,
    answerDidNotTake: running.answerDidNotTake,
  }));
}

function setFolderStatus(current: LibraryFolder | undefined, access?: FolderAccess): void {
  favoritesStore.update((state) => ({
    ...state,
    folder: current === undefined ? undefined : { name: current.name, access: access ?? "granted" },
  }));
}

/** Starts publishing into a folder this visit may write, and watching it. */
async function attach(current: LibraryFolder): Promise<void> {
  await withLock(() => loop().setFolder(current.files));
  stopWatching?.();
  stopWatching = watchFolder(current);
}

function detachFolder(): void {
  stopWatching?.();
  stopWatching = undefined;
  folder = undefined;
}

/**
 * Hears about another machine's change: the folder's own events where the
 * browser has them, and a slow poll for the providers that announce nothing.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.watchShared
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.presentEveryFile
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.stopPresenting
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.watcher
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.presenters
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.poll
 */
function watchFolder(current: LibraryFolder): () => void {
  const stopObserving = current.watch(() => void syncFavorites());
  const poll =
    typeof window === "undefined"
      ? undefined
      : window.setInterval(() => void syncFavorites(), POLL_MS);
  return () => {
    stopObserving();
    if (poll !== undefined) window.clearInterval(poll);
  };
}

/**
 * Coming back to the window is a reason to look again: a machine that was
 * asleep, or a tab in the background, heard nothing meanwhile.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.start
 */
function listenForReturn(): void {
  if (listeningForReturn || typeof window === "undefined") return;
  listeningForReturn = true;
  window.addEventListener("focus", () => void syncFavorites());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncFavorites();
  });
}

/** Runs `work` holding the lock every tab of the app takes around a merge-and-publish. */
function withLock<T>(work: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { locks?: { request<R>(name: string, run: () => Promise<R>): Promise<R> } })
          .locks;
  return locks === undefined ? work() : locks.request(LOCK_NAME, work);
}

/** This browser's identity, minted and kept the first time anything asks. */
function ensureDevice(): DeviceIdentity {
  const current = favoritesStore.getSnapshot().device;
  if (current.id !== "") return current;
  const minted = { id: mintId(), label: current.label };
  void values().put(DEVICE_KEY, minted);
  favoritesStore.update((state) => ({ ...state, device: minted }));
  return minted;
}

async function storedDevice(): Promise<DeviceIdentity> {
  const stored = await values().get<Partial<DeviceIdentity>>(DEVICE_KEY);
  if (typeof stored?.id === "string" && stored.id !== "") {
    return { id: stored.id, label: stored.label ?? deviceLabel() };
  }
  const current = favoritesStore.getSnapshot().device;
  const minted = current.id !== "" ? current : { id: mintId(), label: deviceLabel() };
  await values().put(DEVICE_KEY, minted);
  return minted;
}

/**
 * The document as it was kept, or an empty one: a fresh browser is a normal
 * state, and a record that cannot be read keeps the list this page already has
 * rather than presenting an empty one as if everything were gone.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.loadLocal
 */
async function storedDocument(): Promise<FavoritesDocument> {
  const current = favoritesStore.getSnapshot().document;
  const stored = await values().get<string>(DOCUMENT_KEY);
  if (stored === undefined) return syncDocument();
  if (typeof stored !== "string") return current;
  try {
    return decodeFavoritesDocument(stored);
  } catch {
    return current;
  }
}

function deviceLabel(): string {
  return typeof navigator === "undefined" ? "Browser" : deviceLabelFor(navigator.userAgent);
}

function askToPersist(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // No storage manager here; the data lives as long as the browser keeps it.
  }
}

/**
 * Another tab of the app changed the list: take its record, which publishes it
 * here as well.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.watchLocal
 */
function listenToOtherTabs(): void {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => {
    void storedDocument().then(async (document) => {
      await loop().reload(document);
      refresh();
    });
  };
  // Node keeps a channel with a listener alive; a list of patterns is no reason to.
  (channel as { unref?: () => void }).unref?.();
}

export type { FolderAccess, LibraryFolder, SyncFolderFiles };
