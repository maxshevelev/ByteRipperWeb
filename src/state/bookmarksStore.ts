import { type Bookmark, BookmarkStore, rowContaining } from "@/core/bookmarks/bookmarkStore";
import { hexAddress } from "@/core/text/hexText";
import { openKeyValueStore } from "@/platform/storage/keyValueStore";
import { createStore } from "@/state/store";

/**
 * The workspace's bookmarks, and what keeps them across a reload.
 *
 * One store for the whole tab, not one per pane: a bookmark is an absolute
 * offset, not "an offset in file A", and it marks the same height in both panes
 * of a comparison. Upstream scopes them to a window; a browser tab *is* the
 * window (D11).
 *
 * They outlive the file, deliberately. Closing a dump and opening it again is
 * something a person does constantly while working — a save through another
 * tool, a re-dump of the same chip — and losing every mark to it would make
 * marks not worth setting. ANALYSIS.md § Bookmarks: the scope is the tab's
 * workspace, persisted so a reload keeps them.
 *
 * The tab's identity is in `sessionStorage`, which is exactly per-tab and
 * survives a reload; the marks themselves are in IndexedDB, which is neither.
 * Two tabs of the same application therefore keep their own marks, and a
 * duplicated tab starts a workspace of its own the first time it is asked who
 * it is.
 */

/**
 * The most recent addresses Go To offers back, newest first.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore.limit
 */
const RECENT_LIMIT = 10;

export interface BookmarksState {
  readonly bookmarks: readonly Bookmark[];
  /**
   * Addresses this workspace has been sent to, newest first.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore.recent
   * @upstream-differs kept with the workspace's bookmarks in IndexedDB
   */
  readonly recent: readonly number[];
}

/** The one store the panes, the minimap and the dialogs all read. */
export const bookmarks = new BookmarkStore();

/**
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.bookmarkStore
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.onBookmarksChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.bookmarkStore
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onBookmarksChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexBookmarkedRows
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexBookmark
 */
export const bookmarksStore = createStore<BookmarksState>({ bookmarks: [], recent: [] });

const WORKSPACE_KEY = "byteripper.workspace";
const DATABASE = "byteripper";
/** A workspace's record is dropped once it has not been seen for this long. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredWorkspace {
  readonly bookmarks: readonly Bookmark[];
  /** @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore.userDefaultsKey */
  readonly recent: readonly number[];
  readonly savedAt: number;
}

const values = openKeyValueStore(DATABASE);

/** This tab's workspace id, made once and kept for as long as the tab lives. */
function workspaceId(): string {
  try {
    const existing = sessionStorage.getItem(WORKSPACE_KEY);
    if (existing !== null) return existing;
    const made = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(WORKSPACE_KEY, made);
    return made;
  } catch {
    // Private mode, or storage refused. The workspace is then this page load,
    // which is the honest answer rather than sharing one id with every tab.
    return "w-transient";
  }
}

/** Publishes what the core store now holds, and writes it out. */
function publish(): void {
  bookmarksStore.update((state) => ({ ...state, bookmarks: [...bookmarks.bookmarks] }));
  void persist();
}

bookmarks.onChange = () => publish();

let writing: Promise<void> | undefined;
let writeAgain = false;

/**
 * Writes the workspace out, one write at a time.
 *
 * A drag fires a change per row it passes, and a write per row would queue
 * dozens of transactions behind the pointer. Coalesced instead: whatever the
 * state is when the running write finishes is what the next one writes.
 */
async function persist(): Promise<void> {
  if (writing !== undefined) {
    writeAgain = true;
    return;
  }
  const record: StoredWorkspace = {
    bookmarks: bookmarksStore.getSnapshot().bookmarks,
    recent: bookmarksStore.getSnapshot().recent,
    savedAt: Date.now(),
  };
  writing = values.put(workspaceId(), record).finally(() => {
    writing = undefined;
    if (writeAgain) {
      writeAgain = false;
      void persist();
    }
  });
  await writing;
}

/**
 * Reads this workspace back, and sweeps the ones nobody will ask for again.
 *
 * Called once by the shell. A tab that is never reopened leaves a record
 * behind, and without the sweep a year of benches leaves a year of them.
 */
export async function restoreBookmarks(): Promise<void> {
  const stored = await values.get<StoredWorkspace>(workspaceId());
  if (stored !== undefined) {
    // Seeded rather than replayed: `seed` reports nothing, which is what a
    // store nothing is drawing yet wants.
    bookmarks.seed(stored.bookmarks ?? []);
    bookmarksStore.update((state) => ({
      ...state,
      bookmarks: [...bookmarks.bookmarks],
      recent: stored.recent ?? [],
    }));
  }
  void sweep();
}

async function sweep(): Promise<void> {
  const now = Date.now();
  const mine = workspaceId();
  for (const entry of await values.entries<StoredWorkspace>()) {
    if (entry.key === mine) continue;
    const savedAt = entry.value?.savedAt ?? 0;
    if (now - savedAt > STALE_AFTER_MS) await values.remove(entry.key);
  }
}

// MARK: - What the commands do

/**
 * Marks an unmarked row, unmarks a marked one — the store's own toggle, with no
 * popover. ⌘D and a double-click go through `bookmarkEditStore`, which names
 * the mark it makes.
 */
export function toggleBookmark(offset: number): Bookmark | undefined {
  return bookmarks.toggle(offset);
}

export function addBookmark(offset: number, name = ""): Bookmark {
  return bookmarks.add(offset, name);
}

export function removeBookmark(offset: number): boolean {
  return bookmarks.remove(offset);
}

export function editBookmark(from: number, to: number, name: string): Bookmark | undefined {
  return bookmarks.edit(from, to, name);
}

export function moveBookmark(from: number, to: number, lastRow: number): number | undefined {
  return bookmarks.move(from, to, lastRow);
}

/**
 * How far past a row's edge the pointer must travel before a dragged mark
 * counts it as being on the next row (§20.6).
 *
 * A hand resting on a mouse jitters by about a pixel, and on a row boundary
 * that jitter would step the mark to and fro; two points of hysteresis costs
 * nothing at the speed a drag actually moves and makes the boundary hold still.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkDragHysteresis
 */
export const BOOKMARK_DRAG_HYSTERESIS = 2;

/**
 * The row a mark's drag counts the pointer as being on, given the row it was
 * last counted on: a new row is taken only once the pointer is
 * {@link BOOKMARK_DRAG_HYSTERESIS} points inside it, so a pointer resting on a
 * row boundary stays on the row it came from (§20.6).
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.pointerRow
 */
export function pointerRow(y: number, comingFrom: number, rowHeight: number): number {
  if (rowHeight <= 0) return comingFrom;
  const raw = Math.max(0, Math.floor(y / rowHeight));
  if (raw === comingFrom) return comingFrom;
  if (raw > comingFrom) {
    // Downwards: far enough below the new row's top edge.
    return y >= raw * rowHeight + BOOKMARK_DRAG_HYSTERESIS ? raw : comingFrom;
  }
  // Upwards: far enough above the new row's bottom edge.
  return y <= (raw + 1) * rowHeight - BOOKMARK_DRAG_HYSTERESIS ? raw : comingFrom;
}

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.bookmarkRowBytes */
export function bookmarkAt(offset: number): Bookmark | undefined {
  return bookmarks.at(offset);
}

/**
 * Remembers where the user went.
 *
 * Go To offers these back, which is what makes a second visit to the same
 * structure a keystroke rather than a retyped address. The row, not the byte:
 * two addresses in the same row are the same place to come back to, and a list
 * of sixteen near-identical entries is a list of one useful one.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore.record
 */
export function noteVisited(offset: number): void {
  const row = rowContaining(offset);
  bookmarksStore.update((state) => ({
    ...state,
    recent: [row, ...state.recent.filter((entry) => entry !== row)].slice(0, RECENT_LIMIT),
  }));
  void persist();
}

export function clearRecentAddresses(): void {
  bookmarksStore.update((state) => ({ ...state, recent: [] }));
  void persist();
}

/** `00001000` — what the lists and the menus call a row. */
export { hexAddress };
