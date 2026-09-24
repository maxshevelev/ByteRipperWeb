import { BookmarkSpace } from "@/core/bookmarks/bookmarkSpace";
import { type Bookmark, BookmarkStore, rowContaining } from "@/core/bookmarks/bookmarkStore";
import { hexAddress } from "@/core/text/hexText";
import { openKeyValueStore } from "@/platform/storage/keyValueStore";
import { isSlot, type PaneId } from "@/state/paneId";
import { createStore } from "@/state/store";
import { paneState } from "@/state/workspaceStore";

/**
 * The workspace's bookmarks, and what keeps them across a reload.
 *
 * One store for the whole tab rather than one per pane: a bookmark is an
 * absolute offset, not "an offset in file A", and it marks the same height in
 * both panes of a comparison. Upstream scopes them to a window; a browser tab
 * *is* the window (D11).
 *
 * **A fragment panel reads the same list, at the part's offsets** (§20.7). A
 * bookmark is a row of a *file*, and a panel is a window onto that file, not a
 * different one: a row marked in the dump is marked in the part taken out of
 * it, and marking it in either place marks it in the other. `BookmarkSpace` is
 * the whole of the translation — the list, plus the pane's byte 0 in it.
 *
 * **A decompressed body is the exception**, and the only one: its bytes are
 * what a section unpacks to, so no offset in them is an offset in the file. A
 * pane showing one is given no space at all, and with none there is nothing to
 * draw and nothing to make.
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
  /**
   * The workspace's marks, at the workspace's own offsets. Every surface reads
   * these — the two panes as they are, a fragment panel through its own
   * {@link BookmarkSpace}.
   */
  readonly bookmarks: readonly Bookmark[];
  /**
   * Addresses this workspace has been sent to, newest first.
   *
   * The workspace's, not a surface's: Go To offers back what was typed into it,
   * and the form is the window's one form wherever the address was meant.
   *
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore
   * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToHistoryStore.recent
   * @upstream-differs kept with the workspace's bookmarks in IndexedDB
   */
  readonly recent: readonly number[];
}

/** The list the workspace's panes, its panels, the minimap and the dialogs read. */
export const bookmarks = new BookmarkStore();

/** Nothing, shared, so a pane with no marks hands back the same array every time. */
const NO_MARKS: readonly Bookmark[] = [];

/**
 * Where a pane's marks live: the workspace's list, at that pane's own offsets
 * (§20.7).
 *
 * The list is shared, so a mark made in the dump shows in the panel at the
 * offset the part has it at, and one made in the panel shows in the dump at the
 * offset the file has it at. The offset is the parent's own plus the part's
 * within it, which is what makes a part opened out of a part come out right
 * without this having to know how deep it is.
 *
 * Nothing — no marks at all — for a decompressed body, and for anything opened
 * out of one: its bytes are not the file's bytes, so the file's offsets do not
 * reach them and a mark in either place would mean nothing in the other.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.bookmarkSpace
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.bookmarkStore
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.bookmarks
 */
export function marksFor(pane: PaneId): BookmarkSpace | undefined {
  const origin = isSlot(pane) ? undefined : paneState(pane)?.origin;
  // Not a part of anything: it reads the workspace's list as the dump does, at
  // the dump's own offsets.
  if (origin === undefined) return new BookmarkSpace(bookmarks);
  if (origin.kind !== "copy") return undefined;
  const parent = marksFor(origin.parent);
  if (parent === undefined) return undefined;
  return new BookmarkSpace(parent.store, parent.origin + origin.sourceRange[0]);
}

/**
 * The marks of one pane, out of a snapshot the caller already has — what a
 * component subscribed to the store draws.
 *
 * Derived from the one published list rather than from the live store, so the
 * answer is a function of the snapshot: a caller that memoises on the snapshot
 * gets a stable array, and the panes redraw when the list changes rather than
 * on every render.
 */
export const bookmarksIn = (state: BookmarksState, pane: PaneId): readonly Bookmark[] => {
  const space = marksFor(pane);
  if (space === undefined) return NO_MARKS;
  if (!space.isShifted) return state.bookmarks;
  const rows: Bookmark[] = [];
  for (const mark of state.bookmarks) {
    const local = space.localRowOf(mark.row);
    if (local !== undefined) rows.push({ row: local, name: mark.name });
  }
  return rows;
};

/**
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.bookmarkStore
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.onBookmarksChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.bookmarks
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onBookmarksChanged
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.bookmarksChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexBookmarkedRows
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexBookmark
 */
export const bookmarksStore = createStore<BookmarksState>({
  bookmarks: [],
  recent: [],
});

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

/** Publishes what the workspace's store now holds, and writes it out. */
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
 * Marks an unmarked row of `pane`, unmarks a marked one — the store's own
 * toggle, with no popover. ⌘D and a double-click go through
 * `bookmarkEditStore`, which names the mark it makes.
 *
 * Every command below takes the pane it is about, because which row it means is
 * not a property of the offset: the same number is a row of the workspace's
 * file and a row of a part, and the two are different rows of the one list. A
 * pane with no list at all — a decompressed body — answers each of them with
 * nothing done.
 */
export function toggleBookmark(pane: PaneId, offset: number): Bookmark | undefined {
  return marksFor(pane)?.toggle(offset);
}

export function addBookmark(pane: PaneId, offset: number, name = ""): Bookmark | undefined {
  return marksFor(pane)?.add(offset, name);
}

export function removeBookmark(pane: PaneId, offset: number): boolean {
  return marksFor(pane)?.remove(offset) ?? false;
}

export function editBookmark(
  pane: PaneId,
  from: number,
  to: number,
  name: string
): Bookmark | undefined {
  return marksFor(pane)?.edit(from, to, name);
}

export function moveBookmark(
  pane: PaneId,
  from: number,
  to: number,
  lastRow: number
): number | undefined {
  return marksFor(pane)?.move(from, to, lastRow);
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
export function bookmarkAt(pane: PaneId, offset: number): Bookmark | undefined {
  return marksFor(pane)?.at(offset);
}

/**
 * The file this pane's bookmarks belong to: the document at the far end of the
 * chain of parts this pane was opened out of, whose offsets the list is in.
 * Nothing for a pane that is itself that document.
 *
 * Walked rather than remembered, so it follows a rename in the parent the way
 * the origin's own header link does.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.bookmarkHostName
 */
export function bookmarkHostName(pane: PaneId): string | undefined {
  let next = paneState(pane)?.origin?.parent;
  let name: string | undefined;
  while (next !== undefined) {
    const state = paneState(next);
    name = state?.name;
    next = state?.origin?.parent;
  }
  return name;
}

/**
 * What the mark's tooltip says on the row containing `offset`, and nothing when
 * there is nothing to say (§20.2, §20.7).
 *
 * In a pane showing a file whole that is the mark's name and nothing else: the
 * address is drawn on the mark, right under the pointer, and a tooltip
 * repeating it would explain a thing to itself. In a fragment panel the address
 * under the pointer is the *part's*, so the tooltip adds the one the same row
 * has in the file the mark belongs to — which is the address the reader will
 * come back to it by, and the only place the panel says it. That line shows for
 * an unnamed mark too, because there it is not a repetition of anything.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexBookmarkTooltip
 * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexBookmarkTooltip
 */
export function bookmarkTooltip(pane: PaneId, offset: number): string {
  const space = marksFor(pane);
  const mark = space?.at(offset);
  if (space === undefined || mark === undefined) return "";
  if (!space.isShifted) return mark.name;
  const there = hexAddress(space.storeRowOf(offset));
  const host = bookmarkHostName(pane);
  const line = host === undefined ? there : `${there} in ${host}`;
  return mark.name.length === 0 ? line : `${mark.name}\n${line}`;
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
