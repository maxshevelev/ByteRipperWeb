import {
  type FindContent,
  type FindRange,
  findPassFirstMatch,
  type SearchDirection,
  sameRange,
} from "@/core/find/findContent";
import { type MatchSet, MatchSetBuilder, type MatchStep } from "@/core/find/matchSet";

/**
 * The work a search shows while it runs — the pane's operation strip, with its progress and its
 * (×). The indexer begins one per scan and finishes it; what draws it is the owner's.
 *
 * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindActivity
 */
export interface FindActivity {
  /**
   * How far the scan has got, as a fraction.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindActivity.report
   */
  report(fraction: number): void;
  /**
   * The scan is over, finished or stopped.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindActivity.finish
   */
  finish(): void;
}

/**
 * What a search found when it was started (`FindIndexer.find`).
 *
 * - `found`: a candidate found a match; the search is now that candidate's, and its index is
 *   being built.
 * - `nothing`: no candidate occurs anywhere. The search is a finished one with no matches.
 * - `cancelled`: the search was stopped, or replaced by another, before it answered.
 * - `alreadyRunning`: a search for exactly these candidates is already looking: this press is
 *   answered by that one.
 *
 * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindOutcome
 */
export type FindOutcome<Query> =
  | {
      readonly kind: "found";
      readonly index: number;
      readonly query: Query;
      readonly range: FindRange;
      readonly wrapped: boolean;
    }
  | { readonly kind: "nothing" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "alreadyRunning" };

/**
 * What a step through a search found (`FindIndexer.step`).
 *
 * - `indexed`: the index answered — the match at `step.index` of the set.
 * - `scanned`: the index could not answer — it is still filling, or it kept only a count — and a
 *   scan found this match.
 * - `nothing`: a finished search with nothing to step to, or no search at all.
 * - `notFound`: the scan found no match anywhere.
 * - `cancelled`: the step was stopped before it answered.
 *
 * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindStepOutcome
 */
export type FindStepOutcome =
  | { readonly kind: "indexed"; readonly step: MatchStep }
  | { readonly kind: "scanned"; readonly range: FindRange; readonly wrapped: boolean }
  | { readonly kind: "nothing" }
  | { readonly kind: "notFound" }
  | { readonly kind: "cancelled" };

/**
 * A flag a scan reads to learn it should stop.
 *
 * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindCancelFlag
 */
class FindCancelFlag {
  private cancelled = false;

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindCancelFlag.isCancelled */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindCancelFlag.cancel */
  cancel(): void {
    this.cancelled = true;
  }
}

/**
 * One search over one content, and the reader's place in it (§11).
 *
 * Each pane that searches holds one: the tab's panes, a fragment panel's part. What it holds is
 * that pane's search and nobody else's — a search in one panel neither stops nor touches the
 * search in another.
 *
 * It owns:
 * - **the pass** that answers a press before there is an index — the candidates in turn, each
 *   from the reader's place and then round the end;
 * - **the index** of every occurrence, built behind the answer and published as it fills;
 * - **the steps**, answered by the index wherever it can and by one scan where it cannot;
 * - **what is shown**: the set, the match the reader stands on, and whether the search is being
 *   shown at all.
 *
 * The owner gives it the content and the reader's place (`anchor`), shows what it says, and says
 * when the content changed (`invalidate`). A view draws what is here and keeps nothing of its own.
 *
 * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer
 * @upstream-differs the scans are promises on the page's one thread or a worker's, where
 * upstream detaches tasks; a flag is read where upstream's lock guards it
 */
export class FindIndexer<Query> {
  /**
   * What the search runs over. Set it when the pane shows other content; a change of what the
   * content holds is `invalidate()`.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.content
   */
  content: FindContent<Query> | undefined;

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.init */
  constructor(content?: FindContent<Query>) {
    this.content = content;
  }

  // MARK: - What is shown

  private set: MatchSet<Query> | undefined;
  private reader: FindRange | undefined;
  private highlighting = false;

  /**
   * Every occurrence of the search, as far as the index has got. Undefined until a search has
   * been run, and again once one is invalidated — but not when its showing merely ended.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.matches
   */
  get matches(): MatchSet<Query> | undefined {
    return this.set;
  }

  /**
   * The match the reader stands on. A range, not an ordinal: a scan finds the answer long before
   * the index can say which number it is.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.current
   */
  get current(): FindRange | undefined {
    return this.reader;
  }

  /**
   * Whether the search is being shown: highlights, marks, a count.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.isHighlighting
   */
  get isHighlighting(): boolean {
    return this.highlighting;
  }

  /**
   * The set as everything that draws it sees it: nothing once the showing ended.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.highlightedMatches
   */
  get highlightedMatches(): MatchSet<Query> | undefined {
    return this.highlighting ? this.set : undefined;
  }

  /**
   * Which match the reader stands on, counted from 0 — asked of a finished index only, since an
   * ordinal out of a half-built one would climb as the scan ran.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.currentIndex
   */
  get currentIndex(): number | undefined {
    const current = this.reader;
    const matches = this.set;
    if (current === undefined || matches === undefined || !matches.isComplete) return undefined;
    return matches.indexStartingAt(current.start);
  }

  /**
   * Whether the set is `query`'s: a press for the same search steps rather than starting again.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.hasMatches
   */
  hasMatches(query: Query): boolean {
    return this.set !== undefined && this.same(this.set.query, query);
  }

  /**
   * The shown matches overlapping `[start, end)`. Empty when nothing is shown, and when the set
   * kept only a count.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.matchRanges
   */
  matchRanges(start: number, end: number): FindRange[] {
    const set = this.highlightedMatches;
    if (set === undefined || !set.isHighlightable) return [];
    return set.matchesIntersecting(start, end);
  }

  // MARK: - Telling the owner

  /**
   * Anything about how the search looks changed — the set, the showing, the current match.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.onAppearanceChanged
   */
  onAppearanceChanged: (() => void) | undefined;
  /**
   * The set itself was replaced or dropped: what a results list lists.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.onSetChanged
   */
  onSetChanged: (() => void) | undefined;
  /**
   * The index grew over `range`, which it did not cover before.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.onFilled
   */
  onFilled: ((range: FindRange) => void) | undefined;
  /**
   * The index turned up its first match of `query`: the search found something, which a search
   * that started with an index and no pass has no other way to learn. Once per index.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.onFoundSomething
   */
  onFoundSomething: ((query: Query) => void) | undefined;
  /**
   * Begins the activity a scan shows; `cancel` is what its (×) does. Undefined shows nothing.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.beginActivity
   */
  beginActivity: ((cancel: () => void) => FindActivity | undefined) | undefined;

  /**
   * How often a half-built index is published, in milliseconds: often enough that the
   * highlights follow the scan visibly, rarely enough that the copy each publish costs stays a
   * rounding error next to the scan.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.publishInterval
   */
  publishInterval = 100;

  // MARK: - Starting a search

  private pass: readonly Query[] | undefined;

  /**
   * The candidates a pass is looking for, while it looks.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.passInFlight
   */
  get passInFlight(): readonly Query[] | undefined {
    return this.pass;
  }

  /**
   * Whether an index is being built.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.isIndexing
   */
  get isIndexing(): boolean {
    return this.indexFlag !== undefined;
  }

  /**
   * Starts a search: runs the pass from `anchor` in `direction` and, when a candidate finds
   * something, makes the search that candidate's and starts its index. With `landing`, the
   * reader is put on the match found (Return, ‹ ›); without, the search is only listed.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.find
   */
  find(
    candidates: readonly Query[],
    anchor: number,
    direction: SearchDirection,
    landing = true
  ): Promise<FindOutcome<Query>> {
    return this.start(candidates, anchor, direction, landing);
  }

  /**
   * `find`, with everything a press changes at once done before it returns: the search is the
   * first candidate's, covering nothing, and a second press already finds it under way. The
   * promise is the rest — the pass, then the index.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.start
   */
  start(
    candidates: readonly Query[],
    anchor: number,
    direction: SearchDirection,
    landing = true
  ): Promise<FindOutcome<Query>> {
    const content = this.content;
    const first = candidates[0];
    if (content === undefined || first === undefined) {
      return Promise.resolve({ kind: "nothing" });
    }
    if (this.pass !== undefined && this.sameCandidates(this.pass, candidates)) {
      return Promise.resolve({ kind: "alreadyRunning" });
    }
    this.cancelNavigation();
    this.stopIndexing();
    this.install(this.placeholder(first, content));
    const [flag, activity] = this.beginNavigation();
    this.pass = candidates;
    const scan = findPassFirstMatch(
      candidates,
      content,
      anchor,
      direction,
      () => flag.isCancelled,
      (fraction) => activity?.report(fraction)
    ).catch(() => undefined);
    return this.finishPass(candidates, scan, flag, activity, content, landing);
  }

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.finishPass */
  private async finishPass(
    candidates: readonly Query[],
    scan: Promise<
      | { readonly index: number; readonly query: Query; range: FindRange; wrapped: boolean }
      | undefined
    >,
    flag: FindCancelFlag,
    activity: FindActivity | undefined,
    content: FindContent<Query>,
    landing: boolean
  ): Promise<FindOutcome<Query>> {
    const result = await scan;
    activity?.finish();
    if (this.navigationFlag !== flag || flag.isCancelled) return { kind: "cancelled" };
    this.navigationFlag = undefined;
    this.pass = undefined;
    if (result === undefined) {
      const last = candidates[candidates.length - 1] as Query;
      this.install(
        new MatchSetBuilder(last, content.matchLength(last), content.extent).snapshot(
          content.extent
        )
      );
      return { kind: "nothing" };
    }
    this.install(this.placeholder(result.query, content));
    if (landing) this.highlightOnMatch(result.range);
    this.startIndexing(result.query);
    return {
      kind: "found",
      index: result.index,
      query: result.query,
      range: result.range,
      wrapped: result.wrapped,
    };
  }

  /**
   * Starts `query`'s index without a pass and without going anywhere: what a results list asks
   * for when there is one thing to look for.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.index
   */
  index(query: Query): void {
    const content = this.content;
    if (content === undefined) return;
    this.cancelNavigation();
    this.install(this.placeholder(query, content));
    this.startIndexing(query);
  }

  // MARK: - Stepping

  /**
   * The step the index can answer by itself, at once, and shows it; nothing where it cannot —
   * no set, a set not shown, a match not covered yet, or a wrap while the index is still
   * filling. What a key press tries first, so a step through a built index lands before the
   * press returns.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.indexedStep
   */
  indexedStep(direction: SearchDirection, anchor: number): MatchStep | undefined {
    const set = this.set;
    if (set === undefined || !set.isHighlightable) return undefined;
    const step = set.step(direction, anchor);
    if (step === undefined || (step.wrapped && !set.isComplete)) return undefined;
    this.highlight(step.index);
    return step;
  }

  /**
   * The next (or previous) match from `anchor` (§11).
   *
   * Answered by the index wherever it can: a rank/select step, instant, that leaves the index
   * alone. A half-built index answers for what it covers — but a wrap is only true once it is
   * finished, since while it fills "nothing ahead" may mean "not found yet". Only a step it
   * cannot answer is scanned for: one scan for the search's own query, which does not stop the
   * index being built behind it.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.step
   */
  async step(direction: SearchDirection, anchor: number): Promise<FindStepOutcome> {
    const set = this.set;
    if (set === undefined) return { kind: "nothing" };
    const step = this.indexedStep(direction, anchor);
    if (step !== undefined) return { kind: "indexed", step };
    // A finished index with nothing in it has nothing to step to.
    const content = this.content;
    if ((set.isComplete && set.isHighlightable) || content === undefined) {
      return { kind: "nothing" };
    }
    this.cancelNavigation();
    const [flag, activity] = this.beginNavigation();
    const result = await findPassFirstMatch(
      [set.query],
      content,
      anchor,
      direction,
      () => flag.isCancelled,
      (fraction) => activity?.report(fraction)
    ).catch(() => undefined);
    activity?.finish();
    if (this.navigationFlag !== flag || flag.isCancelled) return { kind: "cancelled" };
    this.navigationFlag = undefined;
    if (result === undefined) return { kind: "notFound" };
    this.highlightOnMatch(result.range);
    return { kind: "scanned", range: result.range, wrapped: result.wrapped };
  }

  // MARK: - Showing

  /**
   * Puts `set` in place of the search, stopping whatever was running, and shows it — on the
   * match at `index` when one is named. For a set made elsewhere; a search is started with
   * `find` or `index`.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.replace
   */
  replace(set: MatchSet<Query> | undefined, index?: number): void {
    this.cancel();
    this.set = set;
    this.reader = index === undefined ? undefined : set?.rangeAt(index);
    this.highlighting = set !== undefined;
    this.onSetChanged?.();
    this.onAppearanceChanged?.();
  }

  /**
   * Shows the set again, on the match at `index` when one is named. Announced even when nothing
   * changed: the same match picked twice is the second pick turning the showing back on.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.highlight
   */
  highlight(index?: number): void {
    const matches = this.set;
    if (matches === undefined) return;
    this.highlighting = true;
    if (index !== undefined) this.reader = matches.rangeAt(index);
    this.onAppearanceChanged?.();
  }

  /**
   * Shows the set, on a match a scan found rather than one out of the index.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.highlight
   */
  highlightOnMatch(range: FindRange): void {
    if (this.set === undefined) return;
    this.highlighting = true;
    this.reader = range;
    this.onAppearanceChanged?.();
  }

  /**
   * Moves the reader to the match at `index`; out of range clears it.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.setCurrent
   */
  setCurrent(index: number | undefined): void {
    const range = index === undefined ? undefined : this.set?.rangeAt(index);
    if (sameRange(range, this.reader)) return;
    this.reader = range;
    this.onAppearanceChanged?.();
  }

  /**
   * Ends the showing and keeps the set: a results list goes on listing the search that was run.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.endHighlighting
   */
  endHighlighting(): void {
    if (!this.highlighting && this.reader === undefined) return;
    this.highlighting = false;
    this.reader = undefined;
    this.onAppearanceChanged?.();
  }

  // MARK: - Stopping

  /**
   * Stops a pass or a step's scan in flight, and leaves the index alone.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.cancelNavigation
   */
  cancelNavigation(): void {
    this.navigationFlag?.cancel();
    this.navigationFlag = undefined;
    this.pass = undefined;
  }

  /**
   * Stops the index in flight. What it has covered stays, and is true.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.stopIndexing
   */
  stopIndexing(): void {
    this.indexFlag?.cancel();
    this.indexFlag = undefined;
    this.indexActivity?.finish();
    this.indexActivity = undefined;
  }

  /**
   * Stops everything in flight.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.cancel
   */
  cancel(): void {
    this.cancelNavigation();
    this.stopIndexing();
  }

  /**
   * The content changed under the search: every position in the set is a guess now, so the set
   * goes rather than shifts, and the next press scans afresh.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.invalidate
   */
  invalidate(): void {
    this.cancel();
    if (this.set === undefined && this.reader === undefined && !this.highlighting) return;
    this.set = undefined;
    this.reader = undefined;
    this.highlighting = false;
    this.onSetChanged?.();
    this.onAppearanceChanged?.();
  }

  // MARK: - Inside

  private navigationFlag: FindCancelFlag | undefined;
  private indexFlag: FindCancelFlag | undefined;
  private indexActivity: FindActivity | undefined;

  private same(a: Query, b: Query): boolean {
    return this.content?.sameQuery(a, b) ?? Object.is(a, b);
  }

  private sameCandidates(a: readonly Query[], b: readonly Query[]): boolean {
    return a.length === b.length && a.every((query, i) => this.same(query, b[i] as Query));
  }

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.placeholder */
  private placeholder(query: Query, content: FindContent<Query>): MatchSet<Query> {
    return new MatchSetBuilder(query, content.matchLength(query), content.extent).snapshot(0);
  }

  /**
   * Installs a new set, and shows it: a search was just started.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.install
   */
  private install(set: MatchSet<Query>): void {
    this.set = set;
    this.reader = undefined;
    this.highlighting = true;
    this.onSetChanged?.();
    this.onAppearanceChanged?.();
  }

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.beginNavigation */
  private beginNavigation(): [FindCancelFlag, FindActivity | undefined] {
    const flag = new FindCancelFlag();
    this.navigationFlag = flag;
    const activity = this.beginActivity?.(() => this.cancelNavigation());
    return [flag, activity];
  }

  /** @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.startIndexing */
  private startIndexing(query: Query): void {
    this.stopIndexing();
    const content = this.content;
    if (content === undefined) return;
    const flag = new FindCancelFlag();
    this.indexFlag = flag;
    const activity = this.beginActivity?.(() => this.cancel());
    this.indexActivity = activity;
    const extent = content.extent;
    const interval = this.publishInterval;
    const builder = new MatchSetBuilder(query, content.matchLength(query), extent);
    void (async () => {
      let publishedUpTo = 0;
      let lastPublish = Number.NEGATIVE_INFINITY;
      try {
        const stream = content.matchStarts(
          query,
          () => flag.isCancelled,
          (fraction) => activity?.report(fraction)
        );
        for await (const batch of stream) {
          builder.add(batch.starts);
          // On a cadence, not per batch: a common byte yields thousands of them, and each
          // publish seals the index again.
          const now = Date.now();
          if (now - lastPublish < interval || batch.scannedUpTo <= publishedUpTo) continue;
          const filled = { start: publishedUpTo, end: batch.scannedUpTo };
          publishedUpTo = batch.scannedUpTo;
          lastPublish = now;
          this.fill(builder.snapshot(batch.scannedUpTo), filled, flag);
        }
      } catch {
        // A failed read leaves the index where it got to: what landed is true.
      }
      activity?.finish();
      if (this.indexFlag !== flag || flag.isCancelled) return;
      this.indexFlag = undefined;
      this.indexActivity = undefined;
      this.fill(
        builder.finish(),
        { start: publishedUpTo, end: Math.max(publishedUpTo, extent) },
        flag
      );
    })();
  }

  /**
   * The index reached further. Dropped when it is a superseded index's.
   *
   * @upstream Packages/Find/Sources/Find/FindIndexer.swift#FindIndexer.fill
   */
  private fill(set: MatchSet<Query>, range: FindRange, flag: FindCancelFlag): void {
    const existing = this.set;
    if (flag.isCancelled || existing === undefined || !this.same(existing.query, set.query)) {
      return;
    }
    const hadMatches = !existing.isEmpty;
    this.set = set;
    this.onFilled?.(range);
    if (!hadMatches && !set.isEmpty) this.onFoundSomething?.(set.query);
  }
}
