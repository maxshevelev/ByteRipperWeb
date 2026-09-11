import type { DiffEdit } from "@/core/diff/diffEngine";
import { MatchBitmap, MatchSet, MatchSetBuilder } from "@/core/search/matchSet";
import { findOne, foldedPattern, SearchCancelled, scanAll } from "@/core/search/searchEngine";
import {
  foldingFor,
  parsePattern,
  type SearchEncoding,
  type SearchFailure,
} from "@/core/search/searchPattern";
import { type Attempt, attemptEncoding, attemptsFor } from "@/core/search/smartSearch";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { createStore } from "@/state/store";
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
  readonly status: SearchStatus;
  readonly query: string;
  /** Empty means Smart Search: try the encodings in order and report which won. */
  readonly encoding: SearchEncoding | "smart";
  readonly caseSensitive: boolean;
  /** Which pane is being searched. */
  readonly pane: PaneId;
  /** The encoding that actually found it, which Smart Search discovers. */
  readonly foundEncoding: SearchEncoding | undefined;
  readonly current: { readonly start: number; readonly end: number } | undefined;
  /** True when the last step came round the end of the file. */
  readonly wrapped: boolean;
  readonly matches: MatchSet | undefined;
  /** In `[0, 1]` while the index is still being built. */
  readonly indexProgress: number;
  readonly problem: string | undefined;
  /** Most recent first, no duplicates. */
  readonly history: readonly string[];
}

const IDLE: SearchState = {
  open: false,
  status: "idle",
  query: "",
  encoding: "smart",
  caseSensitive: false,
  pane: "a",
  foundEncoding: undefined,
  current: undefined,
  wrapped: false,
  matches: undefined,
  indexProgress: 0,
  problem: undefined,
  history: [],
};

export const searchStore = createStore<SearchState>(IDLE);

let worker: Worker | undefined;
let nextJobId: JobId = 1;
let currentJobId: JobId | undefined;
/** The attempt the running job is for, so its reply can name the encoding. */
let currentAttempt: Attempt | undefined;

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
        searchStore.update((state) => ({
          ...state,
          status: "found",
          current: response.match,
          wrapped: response.wrapped,
          foundEncoding: currentAttempt === undefined ? undefined : attemptEncoding(currentAttempt),
          problem: undefined,
        }));
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

        searchStore.update((state) => ({
          ...state,
          matches: new MatchSet(
            attempt.pattern,
            attempt.folding,
            response.extent,
            response.total,
            storage,
            response.indexedUpTo
          ),
        }));
        break;
      }

      case "searchProgress":
        searchStore.update((state) => ({ ...state, indexProgress: response.fraction }));
        break;

      case "cancelled":
        currentJobId = undefined;
        break;

      case "error":
        searchStore.update((state) => ({
          ...state,
          status: "failed",
          problem: response.message,
        }));
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
 */
export function startSearch(options: {
  readonly query: string;
  readonly encoding?: SearchEncoding | "smart";
  readonly caseSensitive?: boolean;
  readonly pane?: PaneId;
  readonly direction?: "forward" | "backward";
  readonly from?: number;
}): void {
  const state = searchStore.getSnapshot();
  const query = options.query;
  const encoding = options.encoding ?? state.encoding;
  const caseSensitive = options.caseSensitive ?? state.caseSensitive;
  const pane = options.pane ?? state.pane;

  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined || query.length === 0) {
    cancelRunning();
    searchStore.update((current) => ({
      ...current,
      status: "idle",
      query,
      encoding,
      caseSensitive,
      matches: undefined,
      current: undefined,
      problem: undefined,
    }));
    return;
  }

  // Smart Search asks several questions in order; a chosen encoding asks one.
  const attempts =
    encoding === "smart"
      ? attemptsFor(query, caseSensitive)
      : resolveOne(query, encoding, caseSensitive);

  if (typeof attempts === "string") {
    searchStore.update((current) => ({
      ...current,
      status: "failed",
      query,
      encoding,
      caseSensitive,
      problem: FAILURE_MESSAGE[attempts],
      matches: undefined,
      current: undefined,
    }));
    return;
  }
  if (attempts.length === 0) {
    searchStore.update((current) => ({
      ...current,
      status: "failed",
      query,
      encoding,
      caseSensitive,
      problem: "There is no way to write that as bytes.",
    }));
    return;
  }

  cancelRunning();
  searchStore.update((current) => ({
    ...current,
    status: "searching",
    query,
    encoding,
    caseSensitive,
    pane,
    matches: undefined,
    indexProgress: 0,
    problem: undefined,
    history: rememberQuery(current.history, query),
  }));

  void runAttempts(
    attempts,
    pane,
    options.from ?? slot.document.caret,
    options.direction ?? "forward"
  );
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
 */
async function runAttempts(
  attempts: readonly Attempt[],
  pane: PaneId,
  from: number,
  direction: "forward" | "backward"
): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;

  // The worker is handed the *file*. A document with unsaved edits is not its
  // file, so searching it there would answer about the bytes on disk while the
  // screen shows something else — the comparison learned this the hard way in
  // M4. An edited document is searched here instead, against the document, in
  // chunks with an await between them so the frame is never held.
  const file = slot.file.source;
  const inWorker = !slot.document.isDirty && file instanceof Blob;

  for (const attempt of attempts) {
    const id = nextJobId++;
    currentJobId = id;
    currentAttempt = attempt;

    const found = inWorker
      ? await askWorker(id, attempt, file as Blob, from, direction)
      : await askHere(id, attempt, slot.document, from, direction);
    // A newer search started while this one was in flight.
    if (currentJobId !== id) return;
    if (found) return;
  }

  searchStore.update((state) => ({
    ...state,
    status: "notFound",
    current: undefined,
    matches: undefined,
  }));
  currentJobId = undefined;
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

  try {
    const here = await findOne(pattern, document, {
      from,
      direction,
      folding,
      shouldCancel: cancelled,
    });
    const match =
      here ??
      (await findOne(pattern, document, {
        from: direction === "forward" ? 0 : document.size,
        direction,
        folding,
        shouldCancel: cancelled,
      }));
    if (cancelled()) return true;
    if (match === undefined) return false;

    searchStore.update((state) => ({
      ...state,
      status: "found",
      current: match,
      wrapped: here === undefined,
      foundEncoding: attemptEncoding(attempt),
      problem: undefined,
    }));

    void indexHere(id, attempt, document);
    return true;
  } catch (error) {
    if (error instanceof SearchCancelled) return true;
    searchStore.update((state) => ({
      ...state,
      status: "failed",
      problem: error instanceof Error ? error.message : "The search failed.",
    }));
    return true;
  }
}

/** The full index for a local attempt, published as it is built. */
async function indexHere(id: JobId, attempt: Attempt, document: ByteStorage): Promise<void> {
  const builder = new MatchSetBuilder(attempt.pattern, attempt.folding, document.size);
  let lastPublished = 0;

  // The builder already hands back a `MatchSet`; nothing has to cross a worker
  // boundary here, so it is published as it is.
  const publish = (set: MatchSet) => {
    if (currentJobId !== id) return;
    searchStore.update((state) => ({ ...state, matches: set }));
  };

  try {
    await scanAll(foldedPattern(attempt.pattern.bytes, attempt.folding), document, {
      folding: attempt.folding,
      shouldCancel: () => currentJobId !== id,
      onMatches: (starts) => builder.add(starts),
      onWindow: (upTo) => {
        const now = Date.now();
        if (now - lastPublished < PUBLISH_EVERY_MS) return;
        lastPublished = now;
        publish(builder.snapshot(upTo));
      },
      onProgress: (fraction) => {
        if (currentJobId === id) {
          searchStore.update((state) => ({ ...state, indexProgress: fraction }));
        }
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
 * Re-runs the search when the bytes under it change.
 *
 * A search result is a claim about the document, and an edit can make it false:
 * typed bytes can create a match or destroy one, and an insert moves every
 * offset after it. Rather than trying to patch the index — which for a search
 * is not the cheap operation it is for a comparison, since a pattern can match
 * across the edit's own boundary — the search is simply run again, coalesced so
 * a fast typist pays for one.
 *
 * The re-run starts from the current match, so the match a person is looking at
 * stays the match they are looking at.
 */
let editTimer: ReturnType<typeof setTimeout> | undefined;

export function noteSearchEdit(pane: PaneId, _edit: DiffEdit): void {
  const state = searchStore.getSnapshot();
  if (state.pane !== pane) return;
  if (state.status !== "found" && state.status !== "notFound") return;
  if (state.query.length === 0) return;

  if (editTimer !== undefined) clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    editTimer = undefined;
    const current = searchStore.getSnapshot();
    if (current.query.length === 0) return;
    startSearch({
      query: current.query,
      encoding: current.encoding,
      caseSensitive: current.caseSensitive,
      pane: current.pane,
      ...(current.current === undefined ? {} : { from: current.current.start }),
    });
  }, EDIT_COALESCE_MS);
}

/** A fast typist produces one re-search rather than one per keystroke. */
const EDIT_COALESCE_MS = 150;

/** Most recent first, no duplicates, and bounded. */
function rememberQuery(history: readonly string[], query: string): string[] {
  return [query, ...history.filter((entry) => entry !== query)].slice(0, 20);
}

/**
 * Steps to the next or previous match.
 *
 * An index step, not a fresh scan — which is the point of having the set: once
 * the file has been scanned, moving through the matches costs a lookup.
 */
export function stepSearch(direction: "forward" | "backward"): void {
  const state = searchStore.getSnapshot();
  const matches = state.matches;
  if (matches === undefined || !matches.isHighlightable) return;

  const caret =
    state.current?.start ?? workspaceStore.getSnapshot().panes[state.pane]?.document.caret ?? 0;
  const from = direction === "forward" ? caret + 1 : caret;
  const step = matches.step(direction, from);
  if (step === undefined) return;

  searchStore.update((current) => ({
    ...current,
    status: "found",
    current: step.range,
    wrapped: step.wrapped,
  }));
}

/** Shows the find bar, and says whether it was already up. */
export function openSearch(): boolean {
  const wasOpen = searchStore.getSnapshot().open;
  if (!wasOpen) searchStore.update((state) => ({ ...state, open: true }));
  return wasOpen;
}

export function closeSearch(): void {
  cancelRunning();
  if (editTimer !== undefined) clearTimeout(editTimer);
  editTimer = undefined;
  searchStore.update((state) => ({ ...IDLE, history: state.history, encoding: state.encoding }));
}

export function setSearchPane(pane: PaneId): void {
  searchStore.update((state) => (state.pane === pane ? state : { ...state, pane }));
}
