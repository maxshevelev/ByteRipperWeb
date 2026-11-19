import type { DiffEdit } from "@/core/diff/diffEngine";
import { type FindRange, type SearchDirection, sameRange } from "@/core/find/findContent";
import { FindIndexer } from "@/core/find/findIndexer";
import { L } from "@/core/localization/localization";
import {
  ByteFindContent,
  type ByteFindIndexer,
  type ByteMatchSet,
  type ByteQuery,
} from "@/core/search/byteFindContent";
import { type MaskedPattern, maskedPattern } from "@/core/search/maskedSearch";
import {
  encodingTitle,
  foldingFor,
  parsePattern,
  patternHexText,
  SEARCH_ENCODINGS,
  type SearchEncoding,
  type SearchFailure,
  searchFailureText,
} from "@/core/search/searchPattern";
import { forBytes, forText, type SelectionFindPattern } from "@/core/search/selectionFindPattern";
import {
  type Attempt,
  attemptEncoding,
  attemptQuery,
  attemptsFor,
} from "@/core/search/smartSearch";
import { recordJump } from "@/state/navigationStore";
import { dismissNotice, showNotice, showWrapNotice } from "@/state/noticeStore";
import { BackgroundOperation, beginOperation } from "@/state/operationStore";
import { WorkerByteFindContent } from "@/state/searchWorkerContent";
import { createStore } from "@/state/store";
import { createTimeSlicer } from "@/state/timeSlice";
import {
  frontSurface,
  isSlot,
  PANE_IDS,
  type PaneId,
  type PaneState,
  type PartId,
  paneIn,
  paneInFront,
  paneState,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The find bars' state, and the searches behind them.
 *
 * Every surface has a find bar of its own — the tab's, over its panes, and each fragment
 * panel's, over its dump — with its own pattern, encoding and case rule, and each searches only
 * its own panes: the tab's active pane, or the panel's part (`SurfaceFindController` upstream).
 * The search itself — the pass, the index as it fills, the steps and the wrap — is the searched
 * pane's own `FindIndexer`, so a search in one panel neither stops nor touches the search in
 * another.
 *
 * The shape follows the engine's: a match arrives first and the index streams in behind it, so
 * the bar can say "found it" long before it can say "3 of 128". Both are shown as they arrive
 * rather than the first waiting for the second.
 */

export type SearchStatus = "idle" | "searching" | "found" | "notFound" | "failed";

/**
 * What one pane's file was found to contain.
 *
 * Kept per pane, not per search. Each dump has its own results list under it, and a list is a
 * claim about *that* file — clicking into the other pane does not make it untrue, so it does not
 * clear. Searching a pane replaces only that pane's.
 *
 * `matches` and `current` are the pane's indexer's, as it shows them — the dump and the map draw
 * them; `listed` is the set it holds, which outlives the showing; the rest is what the bar says
 * about them.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.finder
 */
export interface PaneResults {
  readonly status: SearchStatus;
  /** The encoding that actually found it, which Smart Search discovers. */
  readonly foundEncoding: SearchEncoding | undefined;
  readonly current: FindRange | undefined;
  /** True when the last step came round the end of the file. */
  readonly wrapped: boolean;
  readonly matches: ByteMatchSet | undefined;
  /**
   * The set the pane's indexer holds, shown or not: what the results panel lists. Done, Esc and
   * a pattern typed over end the showing and leave the set, so an open panel goes on listing the
   * search that was run; an edit of the bytes drops it, a list of offsets the file no longer has
   * being worse than no list.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.matchSet
   */
  readonly listed: ByteMatchSet | undefined;
  /**
   * Whether the pane's results panel is up.
   *
   * Only the find bar's results button opens it; the × or the button closes it. A new search
   * leaves it where it is, and it lists that search from then on.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.searchResultsPanelVisible
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.syncSearchResults
   */
  readonly resultsShown: boolean;
}

const NO_RESULTS: PaneResults = {
  status: "idle",
  foundEncoding: undefined,
  current: undefined,
  wrapped: false,
  matches: undefined,
  listed: undefined,
  resultsShown: false,
};

/**
 * One surface's find bar: whether it is up, what its field says, how it reads it, and the
 * complaint it is making, if any.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.bar
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.Request
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.Request
 */
export interface FindBarState {
  /**
   * Whether the bar is on screen — over its surface's content, which for a folded panel is in
   * the dock's pill with it: it comes back up with the panel.
   *
   * Deliberately not derived from the query or the status. An empty query is a search with
   * nothing to look for, not a closed find bar. Only {@link closeSearch} closes it.
   *
   * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.isShown
   */
  readonly open: boolean;
  readonly query: string;
  /**
   * The encoding the field is read in.
   *
   * With Smart Search on this is a *result* rather than an instruction: the pass tries it first
   * and then its own order, and whatever worked is written back here. With Smart Search off it
   * is the only encoding tried.
   */
  readonly encoding: SearchEncoding;
  /**
   * The bar's own case rule, open or closed: kept in the workspace, and inherited by a panel
   * taken out of the surface (§11). A toggle also stores it as the choice a new bar starts with.
   *
   * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.caseSensitive
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.caseRule
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.keepsOwnCaseRule
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.isCaseSensitive
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.isCaseSensitive
   */
  readonly caseSensitive: boolean;
  /**
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onError
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.onError
   */
  readonly problem: string | undefined;
  /**
   * The pattern a selection was put into, kept so the *next* open offers it (§11, Use
   * Selection for Find). Dropped by the next keystroke in the field and by a search.
   *
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.stagedPattern
   */
  readonly stagedPattern: SelectionFindPattern | undefined;
}

/** What the find bars, the tools' pattern fields and the results lists read. */
export interface SearchState {
  /**
   * Whether the encoding is discovered rather than dictated. On unless turned off, and
   * remembered — upstream keeps it in `UserDefaults`. The app's, not a bar's.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.isSmartSearchEnabled
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.isSmartSearchEnabled
   */
  readonly smart: boolean;
  /**
   * The case rule last chosen anywhere: what a new bar starts with, and what a tool's pattern
   * field reads.
   *
   * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.storedCaseSensitive
   */
  readonly caseSensitive: boolean;
  /**
   * The encoding a tool's pattern field reads in. A find bar has its own.
   *
   * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls
   * @upstream-differs one encoding for every tool's field, where each upstream has its own popup
   */
  readonly encoding: SearchEncoding;
  /**
   * The searches that found something, most recent first, kept between visits in
   * `localStorage`.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.recent
   */
  readonly history: readonly FindHistoryEntry[];
  /**
   * Every surface's find bar.
   *
   * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.find
   */
  readonly bars: Readonly<Partial<Record<SurfaceId, FindBarState>>>;
  readonly results: Readonly<Record<PaneId, PaneResults>>;
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.smartSearchKey
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.smartSearchKey
 */
const SMART_STORAGE_KEY = "byteripper.smartSearch";

/**
 * On unless the user has turned it off.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.storedSmartSearch
 */
function storedSmart(): boolean {
  try {
    return localStorage.getItem(SMART_STORAGE_KEY) !== "off";
  } catch {
    // A private window may refuse to read it; on is the better default.
    return true;
  }
}

/**
 * One remembered search: the text, the encoding it was found in, and its case rule — all
 * three, or picking it back would search for something else.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.Entry
 */
export interface FindHistoryEntry {
  readonly pattern: string;
  readonly encoding: SearchEncoding;
  readonly caseSensitive: boolean;
}

/** @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.limit */
export const FIND_HISTORY_LIMIT = 10;

/**
 * Where the recent searches are kept between visits.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.userDefaultsKey
 */
const HISTORY_STORAGE_KEY = "byteripper.findHistory";

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.caseSensitiveKey
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.caseSensitiveKey
 */
const CASE_STORAGE_KEY = "byteripper.findCaseSensitive";

/**
 * Records a search that found something: most recent first, and bounded. The same text under
 * another encoding is another search and both stay; the same pair again replaces the older
 * entry, its case rule with it. Hands back the history it was given when the search is already
 * at the front, so nothing that reads it has to redraw for a press of ‹ ›.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.recordFoundSearch
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.recordFoundSearch
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.entryForField
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.entryForField
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.record
 */
export function recordFindHistory(
  history: readonly FindHistoryEntry[],
  entry: FindHistoryEntry
): readonly FindHistoryEntry[] {
  const pattern = entry.pattern.trim();
  if (pattern.length === 0) return history;
  const first = history[0];
  if (
    first !== undefined &&
    first.pattern === pattern &&
    first.encoding === entry.encoding &&
    first.caseSensitive === entry.caseSensitive
  ) {
    return history;
  }
  const rest = history.filter(
    (kept) => !(kept.pattern === pattern && kept.encoding === entry.encoding)
  );
  return [{ ...entry, pattern }, ...rest].slice(0, FIND_HISTORY_LIMIT);
}

/**
 * The remembered searches as they were stored, with anything unreadable left out: a row from
 * another build, or one edited by hand, costs that row and not the history.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.recent
 */
export function parseFindHistory(raw: string | null): FindHistoryEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: FindHistoryEntry[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const { pattern, encoding, caseSensitive } = row as Record<string, unknown>;
    if (typeof pattern !== "string" || pattern.trim().length === 0) continue;
    if (!SEARCH_ENCODINGS.includes(encoding as SearchEncoding)) continue;
    entries.push({
      pattern,
      encoding: encoding as SearchEncoding,
      caseSensitive: caseSensitive === true,
    });
  }
  return entries.slice(0, FIND_HISTORY_LIMIT);
}

function storedHistory(): FindHistoryEntry[] {
  try {
    return parseFindHistory(localStorage.getItem(HISTORY_STORAGE_KEY));
  } catch {
    // A private window may refuse to read it; the tab starts with none.
    return [];
  }
}

function storeHistory(history: readonly FindHistoryEntry[]): void {
  try {
    if (history.length === 0) localStorage.removeItem(HISTORY_STORAGE_KEY);
    else localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Not storable here; the history still holds for this tab.
  }
}

/**
 * Off unless the user turned it on.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.storedCaseSensitive
 */
function storedCaseSensitive(): boolean {
  try {
    return localStorage.getItem(CASE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/** A bar nobody has opened: closed, empty, on the case rule it starts with. */
const closedBar = (caseSensitive: boolean): FindBarState => ({
  open: false,
  query: "",
  encoding: "hex",
  caseSensitive,
  problem: undefined,
  stagedPattern: undefined,
});

const startingCaseRule = storedCaseSensitive();

export const searchStore = createStore<SearchState>({
  smart: storedSmart(),
  caseSensitive: startingCaseRule,
  encoding: "hex",
  history: storedHistory(),
  bars: { [WORKSPACE_SURFACE]: closedBar(startingCaseRule) },
  results: { a: NO_RESULTS, b: NO_RESULTS },
});

/**
 * One surface's find bar. A surface whose bar nobody has asked about yet reads as a closed one
 * on the standing case rule — which is what it is.
 *
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.find
 */
export function barFor(state: SearchState, surface: SurfaceId = WORKSPACE_SURFACE): FindBarState {
  return state.bars[surface] ?? closedBar(state.caseSensitive);
}

/** Replaces part of one surface's bar, leaving every other bar alone. */
function updateBar(surface: SurfaceId, patch: Partial<FindBarState>): void {
  searchStore.update((state) => ({
    ...state,
    bars: { ...state.bars, [surface]: { ...barFor(state, surface), ...patch } },
  }));
}

/**
 * One pane's results, which is what its list and the bar's counters read.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.matchSet
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setMatches
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.currentMatchRange
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.currentMatchIndex
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexMatchRanges
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexCurrentMatch
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.highlightedMatchSet
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onMatchesChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onMatchSetChanged
 */
export function resultsFor(state: SearchState, pane: PaneId): PaneResults {
  // A pane nothing has searched yet has no row of its own — a part opened over a file starts
  // that way — and reads as a search that found nothing, which is what it is.
  return state.results[pane] ?? NO_RESULTS;
}

/** Replaces part of one pane's results, leaving every other pane's alone. */
function updateResults(pane: PaneId, patch: Partial<PaneResults>): void {
  searchStore.update((state) => ({
    ...state,
    results: { ...state.results, [pane]: { ...resultsFor(state, pane), ...patch } },
  }));
}

/**
 * The pane a surface's bar searches: the tab's active pane, or the panel's part.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.searchedPane
 */
export function searchedPane(surface: SurfaceId): PaneId {
  return surface === WORKSPACE_SURFACE ? workspaceStore.getSnapshot().activePane : surface;
}

/**
 * The panes a surface shows: the tab's two, or the panel's part.
 *
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.panesInMapOrder
 */
function panesOf(surface: SurfaceId): readonly PaneId[] {
  return surface === WORKSPACE_SURFACE ? PANE_IDS : [surface];
}

// MARK: - Each pane's own search

/** Every pane's search: the pane's `FindIndexer`, made the first time the pane is searched. */
const finders = new Map<PaneId, ByteFindIndexer>();

/**
 * The pane's search, its every change mirrored into the pane's results.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.finder
 */
function finderFor(pane: PaneId): ByteFindIndexer {
  const held = finders.get(pane);
  if (held !== undefined) return held;
  const finder: ByteFindIndexer = new FindIndexer<ByteQuery>();
  const follow = () => mirror(pane, finder);
  finder.onSetChanged = follow;
  finder.onAppearanceChanged = follow;
  finder.onFilled = follow;
  finders.set(pane, finder);
  return finder;
}

/**
 * Takes what the pane's indexer shows into the pane's results: the set as everything that draws
 * it sees it, and the match the reader stands on.
 *
 * A reader put on a match has jumped: the place left is a way back (§10.6), recorded before the
 * caret goes there — the bar reveals the match the moment the results say so.
 *
 * A search with no pass in flight whose index has covered the whole file has answered: found,
 * or nothing anywhere — which is how the results button's search, which runs no pass, says so.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.appearanceChanged
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.sync
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.show
 */
function mirror(pane: PaneId, finder: ByteFindIndexer): void {
  const results = resultsFor(searchStore.getSnapshot(), pane);
  const matches = finder.highlightedMatches;
  const current = finder.current;
  if (current !== undefined && !sameRange(current, results.current)) recordJump(pane);
  const answered =
    results.status === "searching" &&
    finder.passInFlight === undefined &&
    matches?.isComplete === true;
  updateResults(pane, {
    matches,
    listed: finder.matches,
    current,
    ...(answered ? { status: matches?.isEmpty === false ? "found" : "notFound" } : {}),
  });
}

/**
 * Readies `pane`'s search: its bytes, and the operation strip its scans show in.
 *
 * The worker is handed the *file*. A document with unsaved edits is not its file, so searching
 * it there would answer about the bytes on disk while the screen shows something else. An
 * edited document is searched here instead, against the document, in chunks with a turn for the
 * event loop between them, so the interface keeps drawing and taking keys while it runs.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.prepare
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#BackgroundOperation
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.prepareFinder
 */
function prepare(pane: PaneId, surface: SurfaceId, slot: PaneState): ByteFindIndexer {
  const finder = finderFor(pane);
  const file = slot.file.source;
  finder.content =
    !slot.document.isDirty && file instanceof Blob
      ? new WorkerByteFindContent(file, slot.document.size)
      : new ByteFindContent(slot.document, { pause: createTimeSlicer });
  finder.beginActivity = (cancel) => {
    const operation = new BackgroundOperation(L("Searching…"), () => {
      cancel();
      // The (×): the running search stops, and whatever it had found so far stays.
      if (resultsFor(searchStore.getSnapshot(), pane).status === "searching") {
        updateResults(pane, { status: "idle" });
      }
    });
    beginOperation(pane, operation);
    return { report: (fraction) => operation.report(fraction), finish: () => operation.finish() };
  };
  // An index that turned up matches is a search that found something, so it is remembered —
  // the results button's own case, where no pass ran to say so (§11).
  finder.onFoundSomething = () => {
    if (resultsFor(searchStore.getSnapshot(), pane).status === "searching") {
      updateResults(pane, { status: "found" });
    }
    recordFoundSearch(surface);
  };
  return finder;
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.reportNoUsablePattern
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.reportNoUsablePattern
 */
const failureMessage = (failure: SearchFailure): string => searchFailureText(failure);

/**
 * What the field is asking for, as things to look for: one attempt for a chosen encoding, Smart
 * Search's list otherwise (§11). A complaint when there is nothing to look for.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.attempts
 */
function attemptsForField(
  query: string,
  encoding: SearchEncoding,
  smart: boolean,
  caseSensitive: boolean
): readonly Attempt[] | string {
  const attempts = smart
    ? attemptsFor(query, caseSensitive, encoding)
    : resolveOne(query, encoding, caseSensitive);
  if (typeof attempts === "string") return failureMessage(attempts);
  if (attempts.length === 0) return L("There is no way to write that as bytes.");
  return attempts;
}

/**
 * A press of Return or ‹ › (§11): a step through the search already in hand, or a new search.
 *
 * A search already running in the pane is stepped rather than started again — including the one
 * a Smart Search settled on, whose attempt is usually not the first (the popup names it).
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.runSearch
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.steppable
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onSearch
 * @upstream-differs every attempt may be stepped: the web has no encoding a picked row brings of
 * its own (`pickedEncoding`), so there is none to narrow the steppable ones to
 */
export function runSearch(
  query: string,
  direction: SearchDirection = "forward",
  surface: SurfaceId = frontSurface()
): void {
  const state = searchStore.getSnapshot();
  const bar = barFor(state, surface);
  const pane = searchedPane(surface);
  const finder = finders.get(pane);
  const attempts = attemptsForField(query, bar.encoding, state.smart, bar.caseSensitive);
  if (
    finder !== undefined &&
    typeof attempts !== "string" &&
    finder.passInFlight === undefined &&
    attempts.some((attempt) => finder.hasMatches(attemptQuery(attempt)))
  ) {
    stepSearch(direction, surface);
    return;
  }
  startSearch({ query, direction, surface });
}

/**
 * Starts a search: the pass — the candidates in turn until one finds something; then the search
 * is that one's (§11).
 *
 * Smart Search resolves the encodings here, on the main thread: choosing which questions to ask
 * is arithmetic over the query string, and only the asking is worth a worker.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.pass
 * @upstream-differs the anchor may be given by the caller; otherwise it is `searchAnchor`'s
 */
export function startSearch(options: {
  readonly query: string;
  readonly encoding?: SearchEncoding;
  readonly smart?: boolean;
  readonly caseSensitive?: boolean;
  /** Whose bar asks; the surface in front, unless said. */
  readonly surface?: SurfaceId;
  /** The pane searched; the bar's own, unless said. */
  readonly pane?: PaneId;
  readonly direction?: SearchDirection;
  readonly from?: number;
  /** What the search is for: going to a match, or listing them all. */
  readonly goal?: SearchGoal;
  /**
   * False for a search picked from the menu: the history is what was typed, and spending it on
   * what is already kept elsewhere is the problem the favourites solve.
   */
  readonly recordHistory?: boolean;
}): void {
  // A plate reports a search, so it goes the moment another one starts.
  dismissNotice();
  const surface =
    options.surface ?? (options.pane === undefined ? frontSurface() : surfaceOf(options.pane));
  const pane = options.pane ?? searchedPane(surface);
  const state = searchStore.getSnapshot();
  const bar = barFor(state, surface);
  const query = options.query;
  const encoding = options.encoding ?? bar.encoding;
  const smart = options.smart ?? state.smart;
  const caseSensitive = options.caseSensitive ?? bar.caseSensitive;
  // A search supersedes a staged pattern: what it finds goes into the history, which is what
  // the next open offers (§11).
  updateBar(surface, { stagedPattern: undefined });

  const slot = paneState(pane);
  if (slot === undefined || query.length === 0) {
    finders.get(pane)?.invalidate();
    updateResults(pane, {
      status: "idle",
      matches: undefined,
      current: undefined,
      resultsShown: false,
    });
    updateBar(surface, { query, encoding, caseSensitive, problem: undefined });
    return;
  }

  // Smart Search asks several questions in order, starting with the encoding the popup is
  // showing — which is either what the user chose or what the last pass settled on, and either
  // way the likeliest answer. Off, it asks one.
  const attempts = attemptsForField(query, encoding, smart, caseSensitive);
  if (typeof attempts === "string") {
    finders.get(pane)?.invalidate();
    updateResults(pane, {
      status: "failed",
      matches: undefined,
      current: undefined,
      resultsShown: false,
    });
    updateBar(surface, { query, encoding, caseSensitive, problem: attempts });
    return;
  }

  const goal = options.goal ?? "show";
  updateResults(pane, {
    status: "searching",
    foundEncoding: undefined,
    wrapped: false,
    // The results button opens the panel whatever the search has to say: on the rows as they
    // arrive, or on "No matches." where they would have been.
    resultsShown: goal === "list" || resultsFor(state, pane).resultsShown,
  });
  // A search told to read hex shows its bytes back as the dump prints them, and that is the
  // text remembered. A Smart Search has not decided yet what the text is: its pass says so when
  // it lands (`adopt`).
  const shown = smart ? query : hexFieldText(query, encoding);
  updateBar(surface, { query: shown, encoding, caseSensitive, problem: undefined });
  // Remembered only once it finds something: a pattern that occurs nowhere is not one worth
  // offering again. A pick from the menu is not remembered at all.
  noteSearchStarted(surface, options.recordHistory === false ? undefined : shown);

  const direction = options.direction ?? "forward";
  const finder = prepare(pane, surface, slot);
  const search = finder.start(
    attempts.map(attemptQuery),
    options.from ??
      searchAnchor(
        slot.document.selection,
        slot.document.caret,
        direction,
        Math.max(1, ...attempts.map((attempt) => attempt.pattern.bytes.length))
      ),
    direction,
    goal === "show"
  );
  void search.then((outcome) => {
    if (paneState(pane) === undefined) return;
    switch (outcome.kind) {
      case "found":
        adoptAttempt(surface, pane, attempts[outcome.index], outcome.wrapped, direction, goal);
        break;
      case "nothing":
        reportNothingFound(attempts, pane);
        break;
      case "cancelled":
      case "alreadyRunning":
        break;
    }
  });
}

/**
 * The attempt that found something is *the* search: the bar's popup says which encoding it was,
 * and the search goes into the history (§11).
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.adopt
 */
function adoptAttempt(
  surface: SurfaceId,
  pane: PaneId,
  attempt: Attempt | undefined,
  wrapped: boolean,
  direction: SearchDirection,
  goal: SearchGoal
): void {
  const found = attempt === undefined ? undefined : attemptEncoding(attempt);
  adopt(surface, found);
  recordFoundSearch(surface);
  // The results button is not a Find Next: the caret stays where it is, and the panel opens on
  // the index as it fills (§11).
  const lands = goal === "show";
  updateResults(pane, { status: "found", foundEncoding: found, wrapped: lands && wrapped });
  if (lands && wrapped) showWrapNotice(direction);
}

/**
 * A pass where every attempt came back empty (§11). Where there was a choice of encodings, a
 * plate says which ones were tried: the answer is about the pass, not about any one of its
 * scans.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.reportNothingFound
 */
function reportNothingFound(attempts: readonly Attempt[], pane: PaneId): void {
  updateResults(pane, { status: "notFound", current: undefined });
  if (attempts.length > 1) showNotice("smartSearch", nothingFoundLines(attempts));
}

/**
 * What a search is for.
 *
 * `show` goes to the match, as ‹ › and Return do. `list` is the results button: pressing it is
 * not a Find Next, so the caret stays where it is and the panel opens on the matches as the
 * index fills.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.Goal
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.Goal.showTheMatch
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.Goal.listTheMatches
 */
export type SearchGoal = "show" | "list";

/**
 * The find bar's results button: shows or hides the searched pane's results panel.
 *
 * It is not a search of its own. A search already in hand for what the field asks is simply
 * presented; a pattern typed but not yet searched is searched here, so the panel is never a list
 * of the previous pattern's matches. One thing to look for needs no scan to pick it: the index
 * itself finds every occurrence, and the panel fills as it does. Which of several encodings to
 * list is the question Smart Search answers for a jump, so it is answered the same way.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.toggleSearchResults
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.presentSearchResults
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showSearchResults
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onSearchAll
 */
export function toggleSearchResults(query: string, surface: SurfaceId = frontSurface()): void {
  const state = searchStore.getSnapshot();
  const pane = searchedPane(surface);
  const slot = paneState(pane);
  if (slot === undefined) return;
  const results = resultsFor(state, pane);
  if (results.resultsShown) {
    hideSearchResults(pane);
    return;
  }
  const bar = barFor(state, surface);
  const attempts = attemptsForField(query, bar.encoding, state.smart, bar.caseSensitive);
  if (typeof attempts === "string") {
    startSearch({ query, surface, pane, goal: "list" });
    return;
  }
  const finder = finders.get(pane);
  if (attempts.some((attempt) => finder?.hasMatches(attemptQuery(attempt)) === true)) {
    updateResults(pane, { resultsShown: true });
    return;
  }
  const only = attempts.length === 1 ? attempts[0] : undefined;
  if (only === undefined) {
    startSearch({ query, surface, pane, goal: "list" });
    return;
  }
  dismissNotice();
  const encoding = attemptEncoding(only);
  updateResults(pane, {
    status: "searching",
    foundEncoding: encoding,
    wrapped: false,
    current: undefined,
    resultsShown: true,
  });
  const shown = state.smart ? query : hexFieldText(query, bar.encoding);
  updateBar(surface, { query: shown, problem: undefined, stagedPattern: undefined });
  noteSearchStarted(surface, shown);
  prepare(pane, surface, slot).index(attemptQuery(only));
  adopt(surface, encoding);
}

/**
 * Takes a pane's results panel down: the ×, or the button pressed again. The search is not
 * touched — hiding a list is not the end of the search it listed.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.hideSearchResults
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onSearchResultsClose
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.onClose
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.clear
 */
export function hideSearchResults(pane: PaneId): void {
  if (!resultsFor(searchStore.getSnapshot(), pane).resultsShown) return;
  updateResults(pane, { resultsShown: false });
}

function resolveOne(
  query: string,
  encoding: SearchEncoding,
  caseSensitive: boolean
): Attempt[] | SearchFailure {
  const parsed = parsePattern(query, encoding, true);
  if (!parsed.ok) return parsed.reason;
  return [
    {
      pattern: parsed.pattern,
      folding: foldingFor(encoding, caseSensitive),
      encodings: [encoding],
    },
  ];
}

/**
 * How an attempt is named when it has to be reported — every encoding it answered for, so "no
 * results" is honest about what was tried.
 *
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SmartSearch.Attempt.label
 */
export function attemptLabel(attempt: Attempt): string {
  return attempt.encodings.map(encodingTitle).join(", ");
}

/**
 * The plate a Smart Search that found nothing shows: the pass, then one line per question it
 * asked.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.reportNothingFound
 */
export function nothingFoundLines(attempts: readonly Attempt[]): string[] {
  return [
    L("Smart search."),
    ...attempts.map((attempt) => L("%1$@ — no results.", attemptLabel(attempt))),
  ];
}

/**
 * Drops a pane's matches when the bytes under them change: every offset in the set is a guess
 * now. The greys go rather than shift — a grey in the wrong place is worse than none — and
 * nothing is searched again, so the caret stays where the typing is. The next Return or step
 * scans afresh. An index still being built over bytes that just moved stops with the set.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.invalidateMatches
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.clearMatches
 */
export function noteSearchEdit(pane: PaneId, _edit: DiffEdit): void {
  const results = resultsFor(searchStore.getSnapshot(), pane);
  finders.get(pane)?.invalidate();
  if (results.status === "idle" && results.matches === undefined && results.current === undefined) {
    return;
  }
  updateResults(pane, {
    status: "idle",
    matches: undefined,
    current: undefined,
    wrapped: false,
    resultsShown: false,
  });
}

/**
 * Where a search starts from: the caret, or the selection (§11). Find Previous is the last match
 * starting before the selection's start (`ByteFindContent`, `MatchSet.indexBefore`).
 *
 * Find Next depends on what is selected. A selection no longer than a match — the match the
 * reader stands on — is passed by one byte, not by its length: matches overlap (#33), and the next
 * one can begin inside it, so `FF FF` over a run of 0xFF is found a byte at a time. A longer
 * selection is a stretch the reader marked, and the search goes on after it. `matchLength` is the
 * longest match the search can make.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.searchAnchor
 * @upstream-differs takes the selection and the caret rather than the pane
 */
export function searchAnchor(
  selection: { readonly start: number; readonly end: number },
  caret: number,
  direction: SearchDirection,
  matchLength: number
): number {
  if (selection.end <= selection.start) return caret;
  if (direction !== "forward") return selection.start;
  return selection.end - selection.start <= Math.max(matchLength, 1)
    ? selection.start + 1
    : selection.end;
}

/**
 * The next or previous match of the search in hand (§11): from the index where it can answer —
 * at once, so the press lands before it returns — and by one scan where it cannot.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.step
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.land
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.Request
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.Request
 * @upstream-differs the match the reader stands on counts as the selection — the current one,
 * or, with the bar closed, a match of the set starting at the caret: landing on a match here
 * puts the caret on it rather than selecting it. A selection the reader made comes first.
 */
export function stepSearch(direction: SearchDirection, surface: SurfaceId = frontSurface()): void {
  const pane = searchedPane(surface);
  const finder = finders.get(pane);
  const slot = paneState(pane);
  if (finder?.matches === undefined || slot === undefined) return;
  const results = resultsFor(searchStore.getSnapshot(), pane);
  const { selection, caret } = slot.document;
  const matches = finder.matches;
  // What the reader stands on, as upstream's selection after a landing: a stretch they selected
  // by hand first, then the match the search put them on — and, once the bar is closed and
  // `current` with it, a match of the set starting at the caret, which is where a landing left it.
  const atCaret =
    matches.indexStartingAt(caret) === undefined
      ? undefined
      : { start: caret, end: caret + Math.max(matches.patternLength, 1) };
  const from = searchAnchor(
    selection.end > selection.start
      ? selection
      : // The current match only while the caret is still on it: a click elsewhere is upstream's
        // deselection, and the search steps from the click.
        ((results.current?.start === caret ? results.current : undefined) ?? atCaret ?? selection),
    caret,
    direction,
    finder.highlightedMatches?.matchLength ?? Math.max(matches.patternLength, 1)
  );
  const land = (wrapped: boolean) => {
    updateResults(pane, { status: "found", wrapped });
    // Said after the move, not instead of it: the plate is the answer and this is the footnote.
    if (wrapped) showWrapNotice(direction);
  };
  const step = finder.indexedStep(direction, from);
  if (step !== undefined) {
    land(step.wrapped);
    return;
  }
  void finder.step(direction, from).then((outcome) => {
    if (paneState(pane) === undefined) return;
    if (outcome.kind === "indexed") land(outcome.step.wrapped);
    else if (outcome.kind === "scanned") land(outcome.wrapped);
    else if (outcome.kind === "notFound") updateResults(pane, { status: "notFound" });
  });
}

/**
 * Takes the encoding a Smart Search settled on into the bar.
 *
 * What worked replaces what was asked for: leaving the asked-for one standing meant the next
 * press started another pass from it instead of stepping the index it now has. Only Smart Search
 * adopts. With it off the encoding is the user's instruction, and an instruction is not
 * something the application rewrites.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.adopt
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.adopt
 */
function adopt(surface: SurfaceId, encoding: SearchEncoding | undefined): void {
  const state = searchStore.getSnapshot();
  if (encoding === undefined || !state.smart) {
    updateBar(surface, { problem: undefined });
    return;
  }
  // A pass that landed on hex found *bytes*, so the field says so the way a dump does — and
  // what is remembered says it too.
  const query = hexFieldText(barFor(state, surface).query, encoding);
  const toRecord = searchToRecord.get(surface);
  if (toRecord !== undefined) searchToRecord.set(surface, hexFieldText(toRecord, encoding));
  updateBar(surface, { encoding, query, problem: undefined });
}

/**
 * The field's text after a search: a hex pattern written back in the form a dump prints it —
 * `deadbeef` becomes `DE AD BE EF` (§11).
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.normalizeHexText
 */
export function hexFieldText(query: string, encoding: SearchEncoding): string {
  if (encoding !== "hex") return query;
  const parsed = parsePattern(query, encoding, true);
  return parsed.ok ? patternHexText(parsed.pattern) : query;
}

/**
 * The query each bar's search was started with, until that search finds something.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.searchToRecord
 */
const searchToRecord = new Map<SurfaceId, string>();

/** @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.noteSearchStarted */
function noteSearchStarted(surface: SurfaceId, query: string | undefined): void {
  if (query === undefined) searchToRecord.delete(surface);
  else searchToRecord.set(surface, query);
}

/**
 * The search a bar started found something, so it is worth offering again — in every bar, the
 * history being the app's.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.recordFoundSearch
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.recordFoundSearch
 */
function recordFoundSearch(surface: SurfaceId): void {
  const query = searchToRecord.get(surface);
  if (query === undefined) return;
  searchToRecord.delete(surface);
  // The encoding is the one the search settled on — adopt runs before this — so picking it back
  // later asks the question that was answered.
  const state = searchStore.getSnapshot();
  const bar = barFor(state, surface);
  const history = recordFindHistory(state.history, {
    pattern: query,
    encoding: bar.encoding,
    caseSensitive: bar.caseSensitive,
  });
  if (history === state.history) return;
  storeHistory(history);
  searchStore.update((current) => ({ ...current, history }));
}

/**
 * The field's text has changed without being searched for — a keystroke, or a selection staged
 * into it. Either way what was on screen a moment ago was a count or a complaint about the text
 * that was there, and the search it described is no longer the one the field names (§11).
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.controlTextDidChange
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onPatternEdited
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.onPatternEdited
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.init
 */
function patternReplaced(surface: SurfaceId, query: string, patch: Partial<FindBarState>): void {
  dismissNotice();
  searchToRecord.delete(surface);
  const pane = searchedPane(surface);
  // The showing ends and the set stays: the file has not moved under it, so a results panel
  // listing it is still telling the truth, until the next search replaces it.
  finders.get(pane)?.endHighlighting();
  updateResults(pane, {
    status: "idle",
    matches: undefined,
    current: undefined,
    wrapped: false,
  });
  updateBar(surface, { query, problem: undefined, ...patch });
}

/**
 * Typing in a bar's pattern field ends the search that was running — the count clears and the
 * matches go, so nothing on screen describes a pattern that is no longer in the field. It starts
 * nothing: a search starts on Return.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.controlTextDidChange
 */
export function editQuery(query: string, surface: SurfaceId = frontSurface()): void {
  // Typed over: a pattern a selection staged is not about this text.
  patternReplaced(surface, query, { stagedPattern: undefined });
}

/**
 * A selection becomes the pattern a bar will search for, and nothing else happens — the bar is
 * not opened, no search is run, and the focus stays where the user is (§11, Use Selection for
 * Find).
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.stage
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.stage
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.stage
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.applyStaged
 * @upstream-differs `applyStaged` is folded in: the web field reads the store, so writing the
 * text and the encoding is the same one update
 */
export function stageFindPattern(
  pattern: SelectionFindPattern,
  surface: SurfaceId = frontSurface()
): void {
  patternReplaced(surface, pattern.text, { encoding: pattern.encoding, stagedPattern: pattern });
}

/**
 * How long a selection may be to be used as a pattern.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.maxSelectionFindBytes
 */
export const MAX_SELECTION_FIND_BYTES = 1024;

/**
 * The selection in the pane in front becomes the pattern its surface's find bar will search for
 * (§11, Use Selection for Find).
 *
 * Everything that can say no says it here rather than at the bar: nothing selected is nothing to
 * take, and a selection past the limit is refused with the two lines upstream refuses it with.
 * Where the caret was typing is where the selection was made (§7): the hex column asks about
 * bytes, the decoded-text column about text.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.useSelectionForFind
 * @upstream-differs the web has no action of its own for this: the command is folded into ⌘F
 * (`AppShell`), which takes the selection before it opens the bar. The refusal plate and the
 * region rule are upstream's.
 */
export async function useSelectionForFind(): Promise<void> {
  const workspace = workspaceStore.getSnapshot();
  const pane = paneInFront();
  const slot = paneIn(workspace, pane);
  if (slot === undefined) return;
  const { start, end } = slot.document.selection;
  if (end <= start) return;
  if (end - start > MAX_SELECTION_FIND_BYTES) {
    showNotice("warning", [
      L("Selection too long to search for"),
      L("Up to %1$@ bytes can be used as a find pattern.", MAX_SELECTION_FIND_BYTES),
    ]);
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await slot.document.read(start, end - start);
  } catch {
    // Nothing to take; the bar still opens on what it last searched for.
    return;
  }
  stageFindPattern(
    slot.typing.inputRegion === "text" ? forText(bytes) : forBytes(bytes),
    surfaceOf(pane)
  );
}

/**
 * Picks the encoding a bar's next search is told to use. Nothing is searched until Return; a
 * complaint about the text no longer stands, since the same text means something else now.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.encodingChanged
 */
export function setSearchEncoding(
  encoding: SearchEncoding,
  surface: SurfaceId = frontSurface()
): void {
  updateBar(surface, { encoding, problem: undefined });
}

/**
 * A bar's case toggle: the bar's own rule, and the choice a new bar starts with.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.caseToggled
 */
export function setCaseSensitive(
  caseSensitive: boolean,
  surface: SurfaceId = frontSurface()
): void {
  setFindCaseRule(caseSensitive, surface);
  setStandingCaseSensitive(caseSensitive);
}

/**
 * Sets a bar's own case rule and nothing else — a restored workspace's, which says nothing about
 * what a new bar starts with.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.caseSensitive
 */
export function setFindCaseRule(caseSensitive: boolean, surface: SurfaceId): void {
  updateBar(surface, { caseSensitive });
}

/**
 * A tool's pattern field's case toggle — the app's standing choice, which is also what the next
 * new bar starts with.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.caseToggled
 */
export function setStandingCaseSensitive(caseSensitive: boolean): void {
  searchStore.update((state) =>
    state.caseSensitive === caseSensitive ? state : { ...state, caseSensitive }
  );
  try {
    localStorage.setItem(CASE_STORAGE_KEY, caseSensitive ? "on" : "off");
  } catch {
    // Not storable here; the choice still holds for this tab.
  }
}

/**
 * Picks the encoding a tool's pattern field reads in.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.encodingChanged
 */
export function setToolEncoding(encoding: SearchEncoding): void {
  searchStore.update((state) => (state.encoding === encoding ? state : { ...state, encoding }));
}

/**
 * Forgets the recent queries.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.clearRecents
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.clear
 */
export function clearRecents(): void {
  storeHistory([]);
  searchStore.update((state) => (state.history.length === 0 ? state : { ...state, history: [] }));
}

/** Turns Smart Search on or off, and remembers which. */
export function setSmartSearch(smart: boolean): void {
  if (searchStore.getSnapshot().smart === smart) return;
  searchStore.update((state) => ({ ...state, smart }));
  try {
    localStorage.setItem(SMART_STORAGE_KEY, smart ? "on" : "off");
  } catch {
    // Not storable here; the choice still holds for this session.
  }
}

/**
 * Shows a surface's find bar, and says whether it was already up.
 *
 * A bar that opens starts from the last search — its text and the encoding it was found in —
 * so repeating yesterday's search is ⌘F, Return. A pattern a selection was staged into outranks
 * it: it is the newer statement of what to look for. On a bar that is already open nothing is
 * prefilled: the field is focused and selected, and keeps the pattern the user came back to fix.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.show
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.prepareForShow
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.prepareForShow
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.mostRecent
 */
export function openSearch(surface: SurfaceId = frontSurface()): boolean {
  const state = searchStore.getSnapshot();
  const bar = barFor(state, surface);
  if (bar.open) return true;
  const staged = bar.stagedPattern;
  const last = state.history[0];
  updateBar(
    surface,
    staged !== undefined
      ? { open: true, query: staged.text, encoding: staged.encoding }
      : last === undefined
        ? { open: true }
        : { open: true, query: last.pattern, encoding: last.encoding }
  );
  return false;
}

/**
 * Opens a surface's bar on `text`, read as `encoding` — a restored workspace's bar. Runs no
 * search: the highlights come back when the person searches again.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.reopen
 */
export function reopenSearch(surface: SurfaceId, text: string, encoding: SearchEncoding): void {
  openSearch(surface);
  editQuery(text, surface);
  setSearchEncoding(encoding, surface);
}

/**
 * The pattern of a surface's bar while it is open, for the workspace.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.openPattern
 */
export function openPattern(
  surface: SurfaceId
): { readonly text: string; readonly encoding: SearchEncoding } | undefined {
  const bar = barFor(searchStore.getSnapshot(), surface);
  return bar.open ? { text: bar.query, encoding: bar.encoding } : undefined;
}

/**
 * Makes the match starting at `offset` the current one: what a click in the results list
 * means. Without it the list moved the panes but left the find bar and the grid pointing at
 * whichever match was current.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onWillJump
 */
export function selectMatch(pane: PaneId, offset: number): void {
  const finder = finders.get(pane);
  const index = finder?.matches?.indexStartingAt(offset);
  if (finder === undefined || index === undefined) return;
  finder.highlight(index);
  updateResults(pane, { status: "found", wrapped: false });
}

/**
 * Done, Esc: a surface's bar goes, and so does every search on that surface's panes — the bar's
 * pattern with it. What is remembered between visits outlives the bar: the history, the bar's
 * encoding and case rule, and a pattern a selection was staged into.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.hide
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onClose
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.cancelOperation
 */
export function closeSearch(surface: SurfaceId = frontSurface()): void {
  // The plate is about a search, and closing the bar means that search is over.
  dismissNotice();
  searchToRecord.delete(surface);
  // Every search's showing goes; the sets survive, so an open results panel goes on listing the
  // search that was actually run.
  for (const pane of panesOf(surface)) {
    const finder = finders.get(pane);
    finder?.cancel();
    finder?.endHighlighting();
    updateResults(pane, {
      status: "idle",
      matches: undefined,
      current: undefined,
      wrapped: false,
    });
  }
  updateBar(surface, { open: false, query: "", problem: undefined });
}

/**
 * Stops every search on a surface: its panes are being rebuilt.
 *
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.cancelAll
 */
export function cancelSurfaceSearches(surface: SurfaceId): void {
  for (const pane of panesOf(surface)) finders.get(pane)?.cancel();
}

/**
 * A part's surface gets its bar as the part arrives — closed, on the case rule of the bar it was
 * taken out under: its parent panel's, or the tab's for a part of File A or B. A part that goes
 * takes its bar, its search and its results with it.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.open
 */
function followParts(): void {
  const parts = workspaceStore.getSnapshot().parts;
  const state = searchStore.getSnapshot();
  let bars: Partial<Record<SurfaceId, FindBarState>> | undefined;
  for (const [pane, part] of Object.entries(parts) as [PartId, PaneState | undefined][]) {
    if (part === undefined || state.bars[pane] !== undefined || bars?.[pane] !== undefined) {
      continue;
    }
    const parent = part.origin?.parent;
    const caseRule =
      parent === undefined ? state.caseSensitive : barFor(state, surfaceOf(parent)).caseSensitive;
    bars ??= { ...state.bars };
    bars[pane] = closedBar(caseRule);
  }
  const gone = (pane: string): boolean => !isSlot(pane as PaneId) && !(pane in parts);
  const goneBars = Object.keys(state.bars).filter(
    (surface) => surface !== WORKSPACE_SURFACE && gone(surface)
  );
  const goneResults = Object.keys(state.results).filter(gone);
  for (const pane of [...finders.keys()]) {
    if (!gone(pane)) continue;
    finders.get(pane)?.cancel();
    finders.delete(pane);
    searchToRecord.delete(pane as SurfaceId);
  }
  if (bars === undefined && goneBars.length === 0 && goneResults.length === 0) return;
  searchStore.update((current) => {
    const nextBars: Partial<Record<SurfaceId, FindBarState>> = { ...(bars ?? current.bars) };
    for (const surface of goneBars) delete nextBars[surface as SurfaceId];
    const nextResults: Record<PaneId, PaneResults> = { ...current.results };
    for (const pane of goneResults) delete nextResults[pane as PaneId];
    return { ...current, bars: nextBars, results: nextResults };
  });
}
workspaceStore.subscribe(followParts);

/** The document each pane's search was made over, by the pane. */
const searchedDocuments = new Map<PaneId, unknown>();

/**
 * A pane given another document — another file opened into it, its file closed — is a pane
 * whose search was made of other bytes: its set goes, and its results with it, as a new pane's
 * search starts empty. Done keeps a set for a results panel to go on listing; this does not,
 * a list of another file's offsets being worse than no list.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.finder
 * @upstream-differs upstream makes a pane's view model, and its finder with it, afresh for each
 *   document; here a pane's indexer outlives its documents, and is emptied when one replaces another
 */
function followDocuments(): void {
  const { panes, parts } = workspaceStore.getSnapshot();
  const now = new Map<PaneId, unknown>();
  for (const [pane, state] of [...Object.entries(panes), ...Object.entries(parts)] as [
    PaneId,
    PaneState | undefined,
  ][]) {
    if (state !== undefined) now.set(pane, state.document);
  }
  for (const pane of new Set([...searchedDocuments.keys(), ...now.keys()])) {
    const before = searchedDocuments.get(pane);
    const after = now.get(pane);
    if (before === after) continue;
    if (after === undefined) searchedDocuments.delete(pane);
    else searchedDocuments.set(pane, after);
    if (before === undefined) continue;
    finders.get(pane)?.invalidate();
    if (resultsFor(searchStore.getSnapshot(), pane) !== NO_RESULTS) updateResults(pane, NO_RESULTS);
  }
}
workspaceStore.subscribe(followDocuments);

/**
 * The recent searches and the two switches as another window — or another tab of this edition —
 * leaves them: the history is the app's, not a window's, so a search made in one window is the
 * first recent search in every other, and Smart Search turned in one is turned in all. A bar's
 * own case rule is the bar's; what another window turns is the choice the next new bar starts
 * with. What is typed in a field stays that field's.
 *
 * @web-only upstream's windows share one `UserDefaults` and one find pasteboard; here each window
 * is a page, and the browser's `storage` event says what another page wrote
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === HISTORY_STORAGE_KEY || event.key === null) {
      const history = parseFindHistory(event.key === null ? null : event.newValue);
      searchStore.update((state) =>
        JSON.stringify(state.history) === JSON.stringify(history) ? state : { ...state, history }
      );
    }
    if (event.key === CASE_STORAGE_KEY || event.key === null) {
      const caseSensitive = storedCaseSensitive();
      searchStore.update((state) =>
        state.caseSensitive === caseSensitive ? state : { ...state, caseSensitive }
      );
    }
    if (event.key === SMART_STORAGE_KEY || event.key === null) {
      const smart = storedSmart();
      searchStore.update((state) => (state.smart === smart ? state : { ...state, smart }));
    }
  });
}

/**
 * One way of reading a tool's pattern field: the masked pattern to scan for, and the encoding it
 * is in.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPatternQuery.swift#ToolPatternAttempt
 */
export interface ToolPatternAttempt {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPatternQuery.swift#ToolPatternAttempt.pattern */
  readonly pattern: MaskedPattern;
  /**
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPatternQuery.swift#ToolPatternAttempt.encoding
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPatternQuery.swift#ToolPatternAttempt.encodingName
   * @upstream-differs the encoding itself, which `encodingTitle` names, where upstream's
   * ToolModuleKit cannot see the app's encodings
   */
  readonly encoding: SearchEncoding;
}

/**
 * What a tool's pattern field asks for, read by the standing choices — the tools' encoding,
 * Smart Search and the case rule last chosen: one attempt for the encoding chosen, or Smart
 * Search's, one encoding after another. The field is read as the dump's bar reads it —
 * `24 ?? 4D 49` is bytes with a hole in them, in hex and in Smart Search's hex attempt alike — so
 * a pattern finds in a panel what it finds in the dump. A problem with the text, in the Find bar's
 * words, where it asks for nothing.
 *
 * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls.attempts
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.searchRequest
 */
export function toolPatternAttempts(
  text: string
): { readonly attempts: readonly ToolPatternAttempt[] } | { readonly problem: string } {
  const state = searchStore.getSnapshot();
  if (text.length === 0) return { problem: failureMessage("emptyPattern") };
  const attempts = attemptsForField(text, state.encoding, state.smart, state.caseSensitive);
  if (typeof attempts === "string") return { problem: attempts };
  return {
    attempts: attempts.map((attempt) => ({
      pattern: maskedPattern(attempt.pattern.bytes, {
        isWild: attempt.pattern.isWild,
        folding: attempt.folding,
      }),
      encoding: attemptEncoding(attempt),
    })),
  };
}

/**
 * A tool's search with `text` found something in `encoding`: Smart Search shows the encoding it
 * settled on, and the search goes into the recent queries — only a search that found something
 * does.
 *
 * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls.found
 */
export function noteToolPatternFound(text: string, encoding: SearchEncoding): void {
  const state = searchStore.getSnapshot();
  if (state.smart) setToolEncoding(encoding);
  const history = recordFindHistory(state.history, {
    pattern: text,
    encoding,
    caseSensitive: state.caseSensitive,
  });
  if (history === state.history) return;
  storeHistory(history);
  searchStore.update((current) => ({ ...current, history }));
}
