import type { DiffEdit } from "@/core/diff/diffEngine";
import { MatchBitmap, MatchSet, MatchSetBuilder } from "@/core/search/matchSet";
import { findOne, foldedPattern, SearchCancelled, scanAll } from "@/core/search/searchEngine";
import {
  encodingTitle,
  foldingFor,
  parsePattern,
  patternHexText,
  SEARCH_ENCODINGS,
  type SearchEncoding,
  type SearchFailure,
} from "@/core/search/searchPattern";
import { type Attempt, attemptEncoding, attemptsFor } from "@/core/search/smartSearch";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { dismissNotice, showNotice, showWrapNotice } from "@/state/noticeStore";
import { BackgroundOperation, beginOperation } from "@/state/operationStore";
import { createStore } from "@/state/store";
import { createTimeSlicer } from "@/state/timeSlice";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";
import type { JobId, SearchWorkerRequest, SearchWorkerResponse } from "@/workers/protocol";

/**
 * The find bar's state, and the worker behind it.
 *
 * The shape follows the engine's: a match arrives first and the index streams
 * in behind it, so the bar can say "found it" long before it can say "3 of
 * 128". Both are shown as they arrive rather than the first waiting for the
 * second.
 */

export type SearchStatus = "idle" | "searching" | "found" | "notFound" | "failed";

/**
 * What one pane's file was found to contain.
 *
 * Kept per pane, not per search. Each dump has its own results list under it,
 * and a list is a claim about *that* file — clicking into the other pane does
 * not make it untrue, so it does not clear. Searching a pane replaces only that
 * pane's.
 */
export interface PaneResults {
  readonly status: SearchStatus;
  /** The encoding that actually found it, which Smart Search discovers. */
  readonly foundEncoding: SearchEncoding | undefined;
  readonly current: { readonly start: number; readonly end: number } | undefined;
  /** True when the last step came round the end of the file. */
  readonly wrapped: boolean;
  readonly matches: MatchSet | undefined;
  /**
   * Whether the pane's results panel is up.
   *
   * Only the find bar's results button opens it; the × or the button closes it.
   * It goes with the set — typing a new pattern, an edit, closing the bar — since
   * a list of offsets the file no longer has is worse than no list. A new search
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
  resultsShown: false,
};

/** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.Request */
export interface SearchState {
  /**
   * Whether the find bar is on screen.
   *
   * Deliberately not derived from the query or the status. An empty query is a
   * search with nothing to look for, not a closed find bar — deleting the last
   * character used to make the bar vanish out from under the cursor that was
   * still deleting. Only {@link closeSearch} closes it.
   */
  readonly open: boolean;
  readonly query: string;
  /**
   * The encoding the field is read in.
   *
   * With Smart Search on this is a *result* rather than an instruction: the
   * pass tries it first and then its own order, and whatever worked is written
   * back here. With Smart Search off it is the only encoding tried.
   */
  readonly encoding: SearchEncoding;
  /**
   * Whether the encoding is discovered rather than dictated. On unless turned
   * off, and remembered — upstream keeps it in `UserDefaults`.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.isSmartSearchEnabled
   */
  readonly smart: boolean;
  /** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.isCaseSensitive */
  readonly caseSensitive: boolean;
  /** Which pane the bar acts on — the active one. */
  readonly pane: PaneId;
  /** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onError */
  readonly problem: string | undefined;
  /**
   * The searches that found something, most recent first, kept between visits
   * in `localStorage`.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.recent
   */
  readonly history: readonly FindHistoryEntry[];
  readonly results: Readonly<Record<PaneId, PaneResults>>;
}

/** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.smartSearchKey */
const SMART_STORAGE_KEY = "byteripper.smartSearch";

/**
 * On unless the user has turned it off.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.storedSmartSearch
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
 * One remembered search: the text, the encoding it was found in, and its case
 * rule — all three, or picking it back would search for something else.
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

/** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.caseSensitiveKey */
const CASE_STORAGE_KEY = "byteripper.findCaseSensitive";

/**
 * Records a search that found something: most recent first, and bounded. The
 * same text under another encoding is another search and both stay; the same
 * pair again replaces the older entry, its case rule with it. Hands back the
 * history it was given when the search is already at the front, so nothing
 * that reads it has to redraw for a press of ‹ ›.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.recordFoundSearch
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.entryForField
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
 * The remembered searches as they were stored, with anything unreadable left
 * out: a row from another build, or one edited by hand, costs that row and not
 * the history.
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

/** Off unless the user turned it on. */
function storedCaseSensitive(): boolean {
  try {
    return localStorage.getItem(CASE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

const IDLE: SearchState = {
  open: false,
  query: "",
  encoding: "hex",
  smart: storedSmart(),
  caseSensitive: storedCaseSensitive(),
  pane: "a",
  problem: undefined,
  history: storedHistory(),
  results: { a: NO_RESULTS, b: NO_RESULTS },
};

/**
 * One pane's results, which is what its list and the bar's counters read.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.matchSet
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setMatches
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.currentMatch
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.currentMatchRange
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.currentMatchIndex
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.clearMatches
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexMatchRanges
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexCurrentMatch
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.highlightedMatchSet
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onMatchesChanged
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onMatchSetChanged
 */
export function resultsFor(state: SearchState, pane: PaneId): PaneResults {
  return state.results[pane];
}

/** Replaces part of one pane's results, leaving the other pane's alone. */
function updateResults(pane: PaneId, patch: Partial<PaneResults>): void {
  searchStore.update((state) => ({
    ...state,
    results: { ...state.results, [pane]: { ...state.results[pane], ...patch } },
  }));
  followSearchOperation(pane);
}

/** The strip of the search running now, on the pane it searches. */
let searchOperation: BackgroundOperation | undefined;
let searchOperationPane: PaneId = "a";

/**
 * Ends the strip along with the results: the search is over once it has
 * answered for the whole file — found with every match counted, found nothing,
 * failed, or been cleared.
 */
function followSearchOperation(pane: PaneId): void {
  const operation = searchOperation;
  if (operation === undefined || pane !== searchOperationPane) return;
  const results = searchStore.getSnapshot().results[pane];
  const over =
    results.status === "notFound" ||
    results.status === "failed" ||
    results.status === "idle" ||
    (results.status === "found" && results.matches?.isComplete === true);
  if (over) finishSearchOperation();
}

function finishSearchOperation(): void {
  searchOperation?.finish();
  searchOperation = undefined;
}

/**
 * Fills the strip's bar as the index is built.
 *
 * Straight to the strip rather than through the store: the strip is the only
 * thing that shows the fraction, and a store update per chunk re-rendered the
 * whole window once per megabyte scanned.
 */
function reportSearchProgress(pane: PaneId, fraction: number): void {
  if (searchOperation !== undefined && pane === searchOperationPane) {
    searchOperation.report(fraction);
  }
}

/**
 * The strip's (×): the running search stops, and whatever it had found so far
 * stays.
 */
function cancelSearch(pane: PaneId): void {
  cancelRunning();
  finishSearchOperation();
  if (resultsFor(searchStore.getSnapshot(), pane).status === "searching") {
    updateResults(pane, { status: "idle" });
  }
}

export const searchStore = createStore<SearchState>(IDLE);

let worker: Worker | undefined;
let nextJobId: JobId = 1;
let currentJobId: JobId | undefined;
/** The attempt the running job is for, so its reply can name the encoding. */
let currentAttempt: Attempt | undefined;
/** Which pane the running job is searching, so its replies land there. */
let currentPane: PaneId = "a";
/** Whether the running job goes to its match or only lists the matches. */
let currentGoal: SearchGoal = "show";

/**
 * The patch a found first match makes. Listing leaves the current match unset,
 * so nothing moves: the caret stays where it is and the panel does the showing.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.adopt
 */
function foundPatch(
  match: { readonly start: number; readonly end: number },
  wrapped: boolean,
  foundEncoding: SearchEncoding | undefined
): Partial<PaneResults> {
  return currentGoal === "list"
    ? { status: "found", current: undefined, wrapped: false, foundEncoding }
    : { status: "found", current: match, wrapped, foundEncoding };
}

function ensureWorker(): Worker {
  if (worker !== undefined) return worker;
  worker = new Worker(new URL("../workers/search.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<SearchWorkerResponse>) => {
    const response = event.data;
    if (response.id !== currentJobId) return;

    switch (response.kind) {
      case "first":
        // Only a *found* first match is news here. An attempt that found
        // nothing is the pass's business — it moves on to the next encoding —
        // and reporting "not found" from here would end a Smart Search at its
        // first miss, which for a UTF-16 string is always the ASCII attempt.
        if (response.match === undefined) break;
        {
          const found = currentAttempt === undefined ? undefined : attemptEncoding(currentAttempt);
          updateResults(currentPane, foundPatch(response.match, response.wrapped, found));
          adopt(found);
          recordFoundSearch();
        }
        break;

      case "indexed": {
        const attempt = currentAttempt;
        if (attempt === undefined) break;
        const storage =
          response.countedOnly === true
            ? ({ kind: "counted" } as const)
            : response.bitmapWords !== undefined
              ? ({
                  kind: "bitmap",
                  bitmap: MatchBitmap.fromWords(response.extent, response.bitmapWords),
                } as const)
              : ({ kind: "sparse", starts: response.starts ?? new Float64Array(0) } as const);

        updateResults(currentPane, {
          matches: new MatchSet(
            attempt.pattern,
            attempt.folding,
            response.extent,
            response.total,
            storage,
            response.indexedUpTo
          ),
        });
        break;
      }

      case "searchProgress":
        reportSearchProgress(currentPane, response.fraction);
        break;

      case "cancelled":
        currentJobId = undefined;
        finishSearchOperation();
        break;

      case "error":
        updateResults(currentPane, { status: "failed" });
        searchStore.update((state) => ({ ...state, problem: response.message }));
        currentJobId = undefined;
        break;
    }
  });
  return worker;
}

const send = (request: SearchWorkerRequest) => ensureWorker().postMessage(request);

function cancelRunning(): void {
  if (currentJobId === undefined) return;
  send({ kind: "cancel", id: currentJobId });
  currentJobId = undefined;
}

/** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.reportNoUsablePattern */
const FAILURE_MESSAGE: Record<SearchFailure, string> = {
  emptyPattern: "Type something to look for.",
  invalidHexPattern: "That is not a hexadecimal byte sequence.",
  undecodableText: "That text cannot be written in this encoding.",
};

/**
 * Starts a search.
 *
 * Smart Search resolves the encoding here, on the main thread: choosing which
 * questions to ask is arithmetic over the query string, and only the asking is
 * worth a worker. The attempts are tried in order, so the worker is asked about
 * one at a time and the first that finds something is the answer.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onSearch
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.runSearch
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.beginPass
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.searchAnchor
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.SearchPassGoal
 */
export function startSearch(options: {
  readonly query: string;
  readonly encoding?: SearchEncoding;
  readonly smart?: boolean;
  readonly caseSensitive?: boolean;
  readonly pane?: PaneId;
  readonly direction?: "forward" | "backward";
  readonly from?: number;
  /** What the search is for: going to a match, or listing them all. */
  readonly goal?: SearchGoal;
  /**
   * False for a search picked from the menu: the history is what was typed, and
   * spending it on what is already kept elsewhere is the problem the favourites
   * solve.
   */
  readonly recordHistory?: boolean;
}): void {
  // A plate reports a search, so it goes the moment another one starts.
  dismissNotice();
  const state = searchStore.getSnapshot();
  const query = options.query;
  const encoding = options.encoding ?? state.encoding;
  const smart = options.smart ?? state.smart;
  const caseSensitive = options.caseSensitive ?? state.caseSensitive;
  const pane = options.pane ?? state.pane;

  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined || query.length === 0) {
    cancelRunning();
    updateResults(pane, {
      status: "idle",
      matches: undefined,
      current: undefined,
      resultsShown: false,
    });
    searchStore.update((current) => ({
      ...current,
      query,
      encoding,
      smart,
      caseSensitive,
      problem: undefined,
    }));
    return;
  }

  // Smart Search asks several questions in order, starting with the encoding
  // the popup is showing — which is either what the user chose or what the last
  // pass settled on, and either way the likeliest answer. Off, it asks one.
  const attempts = smart
    ? attemptsFor(query, caseSensitive, encoding)
    : resolveOne(query, encoding, caseSensitive);

  if (typeof attempts === "string") {
    updateResults(pane, {
      status: "failed",
      matches: undefined,
      current: undefined,
      resultsShown: false,
    });
    searchStore.update((current) => ({
      ...current,
      query,
      encoding,
      smart,
      caseSensitive,
      problem: FAILURE_MESSAGE[attempts],
    }));
    return;
  }
  if (attempts.length === 0) {
    updateResults(pane, { status: "failed", resultsShown: false });
    searchStore.update((current) => ({
      ...current,
      query,
      encoding,
      smart,
      caseSensitive,
      problem: "There is no way to write that as bytes.",
    }));
    return;
  }

  cancelRunning();
  const goal = options.goal ?? "show";
  updateResults(pane, {
    status: "searching",
    matches: undefined,
    current: undefined,
    // The results button opens the panel whatever the search has to say: on
    // the rows as they arrive, or on "No matches." where they would have been.
    resultsShown: goal === "list" || resultsFor(state, pane).resultsShown,
  });
  // A search told to read hex shows its bytes back as the dump prints them, and
  // that is the text remembered. A Smart Search has not decided yet what the
  // text is: its pass says so when it lands (`adopt`).
  const shown = smart ? query : hexFieldText(query, encoding);
  searchStore.update((current) => ({
    ...current,
    query: shown,
    encoding,
    smart,
    caseSensitive,
    pane,
    problem: undefined,
  }));
  // Remembered only once it finds something: a pattern that occurs nowhere is
  // not one worth offering again. A pick from the menu is not remembered at all.
  searchToRecord = options.recordHistory === false ? undefined : shown;

  void runAttempts(
    attempts,
    pane,
    options.from ?? slot.document.caret,
    options.direction ?? "forward",
    goal
  );
}

/**
 * What a search is for.
 *
 * `show` goes to the match, as ‹ › and Return do. `list` is the results button:
 * pressing it is not a Find Next, so the caret stays where it is and the panel
 * opens on the matches as the index fills.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.SearchPassGoal
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.SearchPassGoal.showTheMatch
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.SearchPassGoal.listTheMatches
 */
export type SearchGoal = "show" | "list";

/**
 * The find bar's results button: shows or hides the active pane's results
 * panel.
 *
 * It is not a search of its own. A search that is already in hand for the
 * pattern in the field is simply presented; a pattern typed but not yet
 * searched is searched here, so the panel is never a list of the previous
 * pattern's matches.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleSearchResults
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentSearchResults
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showSearchResults
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onSearchAll
 * @upstream-differs the pass that lists is the same pass that finds, run with the caret left alone, rather than an index started without a first-match scan
 */
export function toggleSearchResults(query: string): void {
  const state = searchStore.getSnapshot();
  const pane = state.pane;
  const results = resultsFor(state, pane);
  if (results.resultsShown) {
    hideSearchResults(pane);
    return;
  }
  // The search in hand wrote a hex pattern back in the dump's form, so the text
  // the button is given counts as the same pattern once it is written that way.
  const samePattern = query === state.query || hexFieldText(query, state.encoding) === state.query;
  const inHand = samePattern && results.status !== "idle" && results.status !== "failed";
  if (inHand) {
    updateResults(pane, { resultsShown: true });
    return;
  }
  startSearch({ query, pane, goal: "list" });
}

/**
 * Takes a pane's results panel down: the ×, or the button pressed again. The
 * search is not touched — hiding a list is not the end of the search it listed.
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
  const parsed = parsePattern(query, encoding);
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
 * Asks the worker about each attempt until one finds something.
 *
 * Sequential, because that is what "the first encoding that finds anything"
 * means — running them together would not tell you which one a reader should
 * adopt, and would scan the file four times to answer a question one scan
 * usually settles.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.attempts
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.steppable
 */
async function runAttempts(
  attempts: readonly Attempt[],
  pane: PaneId,
  from: number,
  direction: "forward" | "backward",
  goal: SearchGoal
): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;

  // The worker is handed the *file*. A document with unsaved edits is not its
  // file, so searching it there would answer about the bytes on disk while the
  // screen shows something else — the comparison learned this the hard way in
  // M4. An edited document is searched here instead, against the document, in
  // chunks with a turn for the event loop between them, so the interface keeps
  // drawing and taking keys while it runs.
  finishSearchOperation();
  const operation = new BackgroundOperation("Searching…", () => cancelSearch(pane));
  searchOperation = operation;
  searchOperationPane = pane;
  beginOperation(pane, operation);

  const file = slot.file.source;
  const inWorker = !slot.document.isDirty && file instanceof Blob;

  for (const attempt of attempts) {
    const id = nextJobId++;
    currentJobId = id;
    currentAttempt = attempt;
    currentPane = pane;
    currentGoal = goal;

    const found = inWorker
      ? await askWorker(id, attempt, file as Blob, from, direction)
      : await askHere(id, attempt, slot.document, from, direction);
    // A newer search started while this one was in flight.
    if (currentJobId !== id) return;
    if (found) return;
  }

  updateResults(pane, { status: "notFound", current: undefined, matches: undefined });
  currentJobId = undefined;
  // Where there was a choice of encodings, a plate says which were tried: the
  // answer is about the pass, not about any one of its scans.
  if (attempts.length > 1) showNotice("smartSearch", nothingFoundLines(attempts));
}

/**
 * How an attempt is named when it has to be reported — every encoding it
 * answered for, so "no results" is honest about what was tried.
 *
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SmartSearch.Attempt.label
 */
export function attemptLabel(attempt: Attempt): string {
  return attempt.encodings.map(encodingTitle).join(", ");
}

/**
 * The plate a Smart Search that found nothing shows: the pass, then one line
 * per question it asked.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.reportNothingFound
 */
export function nothingFoundLines(attempts: readonly Attempt[]): string[] {
  return ["Smart search.", ...attempts.map((attempt) => `${attemptLabel(attempt)} — no results.`)];
}

/** One attempt, resolving to whether it found anything. */
function askWorker(
  id: JobId,
  attempt: Attempt,
  file: Blob,
  from: number,
  direction: "forward" | "backward"
): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent<SearchWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.kind === "first") {
        ensureWorker().removeEventListener("message", listener);
        if (response.match !== undefined && response.wrapped && currentGoal === "show") {
          showWrapNotice(direction);
        }
        resolve(response.match !== undefined);
      } else if (response.kind === "cancelled" || response.kind === "error") {
        ensureWorker().removeEventListener("message", listener);
        resolve(true); // stop the pass; the store already carries the reason
      }
    };
    ensureWorker().addEventListener("message", listener);

    send({
      kind: "search",
      id,
      file,
      pattern: foldedPattern(attempt.pattern.bytes, attempt.folding),
      patternBytes: attempt.pattern.bytes,
      encoding: attemptEncoding(attempt),
      folding: attempt.folding,
      from,
      direction,
      index: true,
    });
  });
}

/**
 * One attempt, run on this thread against the live document.
 *
 * The same two answers in the same order as the worker gives — the match
 * first, the index behind it — because the interface cannot tell the two paths
 * apart and should not have to. The index is not awaited: a person is waiting
 * for the match, not for the greys.
 */
async function askHere(
  id: JobId,
  attempt: Attempt,
  document: ByteStorage,
  from: number,
  direction: "forward" | "backward"
): Promise<boolean> {
  const pattern = foldedPattern(attempt.pattern.bytes, attempt.folding);
  const folding = attempt.folding;
  const cancelled = () => currentJobId !== id;
  const pause = createTimeSlicer();

  try {
    const here = await findOne(pattern, document, {
      from,
      direction,
      folding,
      shouldCancel: cancelled,
      pause,
    });
    const match =
      here ??
      (await findOne(pattern, document, {
        from: direction === "forward" ? 0 : document.size,
        direction,
        folding,
        shouldCancel: cancelled,
        pause,
      }));
    if (cancelled()) return true;
    if (match === undefined) return false;

    updateResults(currentPane, foundPatch(match, here === undefined, attemptEncoding(attempt)));
    adopt(attemptEncoding(attempt));
    recordFoundSearch();
    if (here === undefined && currentGoal === "show") showWrapNotice(direction);

    void indexHere(id, attempt, document, currentPane);
    return true;
  } catch (error) {
    if (error instanceof SearchCancelled) return true;
    updateResults(currentPane, { status: "failed" });
    searchStore.update((state) => ({
      ...state,
      problem: error instanceof Error ? error.message : "The search failed.",
    }));
    return true;
  }
}

/**
 * The full index for a local attempt, published as it is built.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.beginIndexing
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.startIndexing
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.endIndexing
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.noteIndexFound
 */
async function indexHere(
  id: JobId,
  attempt: Attempt,
  document: ByteStorage,
  pane: PaneId
): Promise<void> {
  const builder = new MatchSetBuilder(attempt.pattern, attempt.folding, document.size);
  let lastPublished = 0;

  // The builder already hands back a `MatchSet`; nothing has to cross a worker
  // boundary here, so it is published as it is.
  const publish = (set: MatchSet) => {
    if (currentJobId !== id) return;
    updateResults(pane, { matches: set });
  };

  try {
    await scanAll(foldedPattern(attempt.pattern.bytes, attempt.folding), document, {
      folding: attempt.folding,
      shouldCancel: () => currentJobId !== id,
      pause: createTimeSlicer(),
      onMatches: (starts) => builder.add(starts),
      onWindow: (upTo) => {
        const now = Date.now();
        if (now - lastPublished < PUBLISH_EVERY_MS) return;
        lastPublished = now;
        publish(builder.snapshot(upTo));
      },
      onProgress: (fraction) => {
        if (currentJobId === id) reportSearchProgress(pane, fraction);
      },
    });
    publish(builder.finish());
  } catch (error) {
    if (!(error instanceof SearchCancelled)) throw error;
  }
}

/** How often a partial index is published while a local scan runs. */
const PUBLISH_EVERY_MS = 120;

/**
 * Drops a pane's matches when the bytes under them change: every offset in the
 * set is a guess now. The greys go rather than shift — a grey in the wrong
 * place is worse than none — and nothing is searched again, so the caret stays
 * where the typing is. The next Return or step scans afresh.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.invalidateMatches
 */
export function noteSearchEdit(pane: PaneId, _edit: DiffEdit): void {
  const results = resultsFor(searchStore.getSnapshot(), pane);
  if (results.status === "idle" && results.matches === undefined && results.current === undefined) {
    return;
  }
  // An index still being built is being built over bytes that just moved.
  if (pane === currentPane) {
    cancelRunning();
    finishSearchOperation();
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
 * Steps to the next or previous match.
 *
 * An index step, not a fresh scan — which is the point of having the set: once
 * the file has been scanned, moving through the matches costs a lookup.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.Request
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.stepMatch
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.land
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.scanForStep
 */
export function stepSearch(direction: "forward" | "backward"): void {
  const state = searchStore.getSnapshot();
  const pane = state.pane;
  const results = resultsFor(state, pane);
  const matches = results.matches;
  if (matches === undefined || !matches.isHighlightable) return;

  const caret =
    results.current?.start ?? workspaceStore.getSnapshot().panes[pane]?.document.caret ?? 0;
  const from = direction === "forward" ? caret + 1 : caret;
  const step = matches.step(direction, from);
  if (step === undefined) return;

  updateResults(pane, { status: "found", current: step.range, wrapped: step.wrapped });
  if (step.wrapped) showWrapNotice(direction);
}

/**
 * Takes the encoding a Smart Search settled on into the bar.
 *
 * What worked replaces what was asked for. Upstream is explicit about why:
 * leaving the asked-for one standing meant the next press started another pass
 * from it — trying UTF-16 BE and ASCII again before landing on the LE the
 * search had *already* settled on — instead of stepping the index it now has.
 *
 * Only Smart Search adopts. With it off the encoding is the user's instruction,
 * and an instruction is not something the application rewrites.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.adopt
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.adopt
 */
function adopt(encoding: SearchEncoding | undefined): void {
  const state = searchStore.getSnapshot();
  if (encoding === undefined || !state.smart) {
    searchStore.update((current) => ({ ...current, problem: undefined }));
    return;
  }
  // A pass that landed on hex found *bytes*, so the field says so the way a dump
  // does — and what is remembered says it too.
  const query = hexFieldText(state.query, encoding);
  if (searchToRecord !== undefined) searchToRecord = hexFieldText(searchToRecord, encoding);
  searchStore.update((current) => ({ ...current, encoding, query, problem: undefined }));
}

/**
 * The field's text after a search: a hex pattern written back in the form a
 * dump prints it — `deadbeef` becomes `DE AD BE EF` (§11).
 *
 * Only on a search, never while typing: it is the answer to "this is what I
 * looked for", and a field that regrouped bytes under the caret would be
 * unusable. The text is derived from the bytes, so it says exactly what was
 * searched for. Text encodings are left alone: there the field holds the string
 * itself, not a transcription of bytes.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.normalizeHexText
 */
export function hexFieldText(query: string, encoding: SearchEncoding): string {
  if (encoding !== "hex") return query;
  const parsed = parsePattern(query, encoding);
  return parsed.ok ? patternHexText(parsed.pattern) : query;
}

/** The query a search was started with, until that search finds something. */
let searchToRecord: string | undefined;

/**
 * The search that was started found something, so it is worth offering again.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.recordFoundSearch
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.searchToRecord
 */
function recordFoundSearch(): void {
  const query = searchToRecord;
  if (query === undefined) return;
  searchToRecord = undefined;
  // The encoding is the one the search settled on — adopt runs before this —
  // so picking it back later asks the question that was answered.
  const state = searchStore.getSnapshot();
  const history = recordFindHistory(state.history, {
    pattern: query,
    encoding: state.encoding,
    caseSensitive: state.caseSensitive,
  });
  if (history === state.history) return;
  storeHistory(history);
  searchStore.update((current) => ({ ...current, history }));
}

/**
 * Typing in the pattern field ends the search that was running — the count
 * clears and the matches go, so nothing on screen describes a pattern that is
 * no longer in the field. It starts nothing: a search starts on Return.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.controlTextDidChange
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onPatternEdited
 */
export function editQuery(query: string): void {
  dismissNotice();
  cancelRunning();
  finishSearchOperation();
  searchToRecord = undefined;
  const pane = searchStore.getSnapshot().pane;
  updateResults(pane, {
    status: "idle",
    matches: undefined,
    current: undefined,
    wrapped: false,
    resultsShown: false,
  });
  searchStore.update((state) => ({ ...state, query, problem: undefined }));
}

/**
 * Picks the encoding the next search is told to use. Nothing is searched until
 * Return; a complaint about the text no longer stands, since the same text
 * means something else now.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.encodingChanged
 */
export function setSearchEncoding(encoding: SearchEncoding): void {
  searchStore.update((state) => ({ ...state, encoding, problem: undefined }));
}

/** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.caseToggled */
export function setCaseSensitive(caseSensitive: boolean): void {
  searchStore.update((state) => ({ ...state, caseSensitive }));
  try {
    localStorage.setItem(CASE_STORAGE_KEY, caseSensitive ? "on" : "off");
  } catch {
    // Not storable here; the choice still holds for this tab.
  }
}

/**
 * Forgets the recent queries.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.clearRecents
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
 * Shows the find bar, and says whether it was already up.
 *
 * A bar that opens starts from the last search — its text and the encoding it
 * was found in — so repeating yesterday's search is ⌘F, Return. The field
 * arrives with that text selected, so typing replaces it.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.prepareForShow
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FindHistoryStore.mostRecent
 */
export function openSearch(): boolean {
  const wasOpen = searchStore.getSnapshot().open;
  if (!wasOpen) {
    searchStore.update((state) => {
      const last = state.history[0];
      return last === undefined
        ? { ...state, open: true }
        : { ...state, open: true, query: last.pattern, encoding: last.encoding };
    });
  }
  return wasOpen;
}

/**
 * Makes the match starting at `offset` the current one.
 *
 * What a click in the results list means. Without it the list moved the panes
 * but left the find bar and the grid still pointing at whichever match was
 * current — so the ordinal said "1 of 12" over the sixth one, and ▶ carried on
 * from somewhere the user had left.
 */
export function selectMatch(pane: PaneId, offset: number): void {
  const state = searchStore.getSnapshot();
  const matches = resultsFor(state, pane).matches;
  if (matches === undefined) return;
  const index = matches.indexStartingAt(offset);
  if (index === undefined) return;
  const range = matches.rangeAt(index);
  if (range === undefined) return;
  updateResults(pane, { status: "found", current: range, wrapped: false });
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onClose
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.cancelOperation
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.hideFindBar
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.cancelOperation
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.cancelFind
 */
export function closeSearch(): void {
  // The plate is about a search, and closing the bar means that search is over.
  dismissNotice();
  cancelRunning();
  finishSearchOperation();
  // What is remembered between visits outlives the bar: the history, and the
  // choices the user made about how to search.
  searchStore.update((state) => ({
    ...IDLE,
    history: state.history,
    encoding: state.encoding,
    smart: state.smart,
    caseSensitive: state.caseSensitive,
  }));
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext.count
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext.resultsShown
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.apply
 * @upstream-differs the bar reads the active pane's results from the store
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncFindBarToActivePane
 */
export function setSearchPane(pane: PaneId): void {
  searchStore.update((state) => (state.pane === pane ? state : { ...state, pane }));
}
