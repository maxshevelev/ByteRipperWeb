import {
  decodeFavoritesDocument,
  decodePatternLibrary,
  encodeFavoritesDocument,
  encodePatternLibrary,
  type FavoritesDocument,
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
 * What this browser keeps is upstream's document — its library, and later the
 * state it last agreed with each other machine's file — in IndexedDB rather
 * than in a file, written whole on every change. Every write counts against this
 * browser's device in the version vector, so that when the library meets a
 * folder (stage 4) the other machines can tell a later version from a stale one.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile
 * @upstream-differs a store over IndexedDB; the folder half arrives with stage 4
 */

const DATABASE = "byteripper-favorites";
/** @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile.url */
const DOCUMENT_KEY = "Favorites";
const DEVICE_KEY = "Device";
/** Other tabs of the app, on the same profile, are the same device. */
const CHANNEL_NAME = "byteripper-favorites";

/**
 * This browser, as far as the library is concerned. The id never changes once
 * minted — an id that changed would leave this browser's own past looking like a
 * stranger's — and the label is what a person reading the folder is told.
 *
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#DeviceIdentity
 * @upstream-differs a random id kept with the library: a browser has no hardware id to take one from
 */
export interface DeviceIdentity {
  readonly id: string;
  readonly label: string;
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
  | { readonly kind: "asking"; readonly questions: number }
  | {
      readonly kind: "imported";
      readonly added: number;
      readonly changed: number;
      readonly removed: number;
    };

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

let channel: BroadcastChannel | undefined;

/**
 * Reads the library and this browser's identity back, minting the identity the
 * first time, and asks the browser to keep the site's data rather than evict it
 * — a browser that loses it is a new device with an empty list.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.start
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#FavoritesFile.read
 * @upstream ByteRipperApp/Search/FavoritesFile.swift#DeviceIdentity.current
 */
export async function restoreFavorites(): Promise<void> {
  const device = await storedDevice();
  const document = await storedDocument();
  publish(document, device, true);
  askToPersist();
  listenToOtherTabs();
}

/**
 * Keeps `entry`, at the end of the list. Refused — `false` — when the same search
 * is already kept, whatever it is called: a second copy under another name is
 * two answers to one question.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.add
 */
export function addFavorite(entry: SearchPatternEntry, now: number = Date.now()): boolean {
  const library = favoritesStore.getSnapshot().document.local;
  if (library.entries.some((kept) => isSameSearch(kept, entry))) return false;
  const last = orderedEntries(library).at(-1);
  const kept: SearchPatternEntry = {
    ...entry,
    sortKey: sortKeyBetween(last?.sortKey, undefined),
    modifiedAt: now,
    device: ensureDevice().id,
  };
  save({ ...library, entries: [...library.entries, kept] });
  return true;
}

/**
 * Replaces the list — what the Favorites tab saves, a reorder, an edit and a
 * removal included. The order given is the order kept, and two things a plain
 * assignment would miss happen here, both so another machine can make sense of
 * the result: an entry whose content changed is stamped with the time and this
 * device, and an entry that is gone leaves a tombstone.
 *
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.replace
 */
export function replaceFavorites(
  entries: readonly SearchPatternEntry[],
  now: number = Date.now()
): void {
  const library = favoritesStore.getSnapshot().document.local;
  const device = ensureDevice().id;
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
  save(withOrder({ ...library, tombstones }, stamped));
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
 * replacement.
 *
 * The file is a peer this browser has agreed nothing with: no base, and its
 * counters taken as a lack of information rather than as evidence, as upstream
 * joins a folder. So everything either side holds is kept, a deletion wins only
 * over what it is later than, and what both sides hold differently is asked —
 * in which case nothing is kept until {@link answerImport}.
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

  const local = favoritesStore.getSnapshot().document.local;
  const outcome = mergePatternLibraries(undefined, local, theirs, { assumeConcurrent: true, now });
  if (outcome.conflicts.length > 0) {
    favoritesStore.update((state) => ({ ...state, pendingImport: { fileName, outcome } }));
    return { kind: "asking", questions: outcome.conflicts.length };
  }
  return keepImported(local, outcome.library);
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
  return keepImported(document.local, resolvePatternLibrary(pendingImport.outcome, answers, now));
}

/** Drops a pending import: the list stays as it was before the file was opened. */
export function abandonImport(): void {
  favoritesStore.update((state) => ({ ...state, pendingImport: undefined }));
}

/**
 * What a browser is called where it has to be told apart from the others:
 * "Chrome on Windows". Read from the user agent, which says both.
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

/**
 * Records a change made here: counted against this device, kept, and told to
 * the other tabs.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.save
 * @upstream ByteRipperApp/Search/FavoritePatternStore.swift#FavoritePatternStore.library
 */
function save(library: PatternLibrary): void {
  const state = favoritesStore.getSnapshot();
  const device = ensureDevice();
  const written: PatternLibrary = { ...library, vector: incremented(library.vector, device.id) };
  const document: FavoritesDocument = { ...state.document, local: written };
  publish(document, device, state.restored);
  void values().put(DOCUMENT_KEY, encodeFavoritesDocument(document));
  channel?.postMessage("changed");
}

/**
 * Keeps a merged import, if it changed anything, and counts what it did. A file
 * that holds nothing new is not a write: the counters stay where they were.
 */
function keepImported(before: PatternLibrary, merged: PatternLibrary): ImportResult {
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
  if (!same) save(merged);
  return { kind: "imported", added, changed, removed };
}

function publish(document: FavoritesDocument, device: DeviceIdentity, restored: boolean): void {
  favoritesStore.update((state) => ({
    ...state,
    document,
    favorites: orderedEntries(document.local),
    device,
    restored,
  }));
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

/** Another tab of the app changed the list: read it back. */
function listenToOtherTabs(): void {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => {
    void storedDocument().then((document) => {
      const state = favoritesStore.getSnapshot();
      publish(document, state.device, true);
    });
  };
  // Node keeps a channel with a listener alive; a list of patterns is no reason to.
  (channel as { unref?: () => void }).unref?.();
}
