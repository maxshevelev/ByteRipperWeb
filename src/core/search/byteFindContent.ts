import type { FindContent, FindRange, MatchBatch, SearchDirection } from "@/core/find/findContent";
import type { FindIndexer } from "@/core/find/findIndexer";
import {
  MAX_INDEX_BYTES,
  MatchSet,
  MatchSetBuilder,
  type MatchStorage,
} from "@/core/find/matchSet";
import {
  type MaskedPattern,
  maskedLastMatch,
  maskedMatches,
  maskedPattern,
} from "@/core/search/maskedSearch";
import { type ByteRange, DEFAULT_BATCH_SIZE, SearchCancelled } from "@/core/search/searchEngine";
import type { CaseFolding, SearchPattern } from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * What a search of a dump looks for: the bytes, and how letters compare.
 *
 * The same bytes compared exactly and compared folded are two searches, so both are the query;
 * the encoding the bytes came from rides along in the pattern, for the field to show.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteQuery
 */
export interface ByteQuery {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteQuery.pattern */
  readonly pattern: SearchPattern;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteQuery.folding */
  readonly folding: CaseFolding;
}

/**
 * Whether two byte queries are the same search: the same bytes, from the same encoding, compared
 * the same way.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteQuery
 * @upstream-differs Swift synthesises `==`; here it is written out
 */
export function sameByteQuery(a: ByteQuery, b: ByteQuery): boolean {
  if (a === b) return true;
  if (a.pattern.encoding !== b.pattern.encoding) return false;
  if (JSON.stringify(a.folding) !== JSON.stringify(b.folding)) return false;
  const x = a.pattern.bytes;
  const y = b.pattern.bytes;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  const holes = a.pattern.isWild;
  const others = b.pattern.isWild;
  for (let i = 0; i < x.length; i++) if ((holes[i] === true) !== (others[i] === true)) return false;
  return true;
}

/** The pattern a query looks for: its bytes and its holes, its letters compared by its folding. */
const queryPattern = (query: ByteQuery): MaskedPattern =>
  maskedPattern(query.pattern.bytes, { isWild: query.pattern.isWild, folding: query.folding });

/** How long every match of a byte query is. */
const byteMatchLength = (query: ByteQuery): number => Math.max(query.pattern.bytes.length, 1);

/**
 * Where every occurrence of a dump's search is.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteMatchSet
 */
export type ByteMatchSet = MatchSet<ByteQuery>;

/**
 * A dump's search, held by a pane.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindIndexer
 */
export type ByteFindIndexer = FindIndexer<ByteQuery>;

/**
 * A byte set from its parts: the pattern and its case rule are the query.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#MatchSet.init
 */
export function byteMatchSet(
  pattern: SearchPattern,
  folding: CaseFolding,
  extent: number,
  total: number,
  storage: MatchStorage,
  indexedUpTo: number
): ByteMatchSet {
  return new MatchSet(
    { pattern, folding },
    pattern.bytes.length,
    extent,
    total,
    storage,
    indexedUpTo
  );
}

/**
 * A byte set from starts already in hand.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#MatchSet.init
 */
export function byteMatchSetOf(
  pattern: SearchPattern,
  folding: CaseFolding,
  extent: number,
  starts: ArrayLike<number>,
  indexedUpTo?: number
): ByteMatchSet {
  return MatchSet.of({ pattern, folding }, pattern.bytes.length, extent, starts, indexedUpTo);
}

/**
 * A builder for a byte set.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteMatchSetBuilder
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#MatchSetBuilder.init
 */
export function byteMatchSetBuilder(
  pattern: SearchPattern,
  folding: CaseFolding,
  extent: number,
  maxIndexBytes = MAX_INDEX_BYTES
): MatchSetBuilder<ByteQuery> {
  return new MatchSetBuilder({ pattern, folding }, pattern.bytes.length, extent, maxIndexBytes);
}

/** How a dump's bytes are scanned. */
export interface ByteFindContentOptions {
  readonly chunkSize?: number;
  /**
   * Makes the pause a scan calls between windows: a turn for the event loop, for a scan on the
   * page's own thread.
   */
  readonly pause?: () => () => Promise<void> | undefined;
}

/**
 * A dump's bytes as something `FindIndexer` searches: positions are byte offsets, and the scan is
 * `PatternScan`'s (`maskedMatches`, `maskedLastMatch`) — the one the agent's `find_bytes` and the
 * UEFI Structure's search run, so all three find the same. It runs on the thread that asks, with
 * a turn for the event loop between windows when it is given a pause, so a page that scans its
 * own document keeps drawing.
 *
 * **Matches overlap, always.** After a match the scan looks again one byte after its start, not
 * after its end, so `FF FF` over a run of five 0xFF is four matches. A non-overlapping set depends
 * on where the scan started — `FF FF` in `FF FF FF` is a match at 0 from offset 0 and at 1 from
 * offset 1 — so Find Next from the caret could land on a match Find All's set does not hold; an
 * overlapping set is the file's alone. The two differ only for a pattern that overlaps itself: a
 * run, or a mask such as `24 ?? 24` (#33).
 *
 * So the steps are by start: Find Next is the first match starting at or after the anchor, Find
 * Previous the last starting before it — a match the reader stands on is passed by one byte, not
 * by its length, and a run is walked a byte at a time either way.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent
 */
export class ByteFindContent implements FindContent<ByteQuery> {
  /**
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.storage
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.chunkSize
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.init
   */
  readonly storage: ByteStorage;
  private readonly options: ByteFindContentOptions;

  constructor(storage: ByteStorage, options: ByteFindContentOptions = {}) {
    this.storage = storage;
    this.options = options;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.extent */
  get extent(): number {
    return this.storage.size;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.matchLength */
  matchLength(query: ByteQuery): number {
    return byteMatchLength(query);
  }

  sameQuery(a: ByteQuery, b: ByteQuery): boolean {
    return sameByteQuery(a, b);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.firstMatch */
  firstMatch(
    query: ByteQuery,
    anchor: number,
    direction: SearchDirection,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): Promise<FindRange | undefined> {
    const pattern = queryPattern(query);
    const options = this.scanOptions(shouldCancel, progress);
    if (direction === "backward") {
      return maskedLastMatch(pattern, this.storage, anchor, options);
    }
    return (async () => {
      if (anchor >= this.storage.size) {
        progress(1);
        return undefined;
      }
      let found: ByteRange | undefined;
      await maskedMatches(
        [pattern],
        this.storage,
        (match) => {
          found = match;
          return false;
        },
        { ...options, range: { start: anchor, end: this.storage.size }, overlapping: true }
      );
      return found;
    })();
  }

  /** The chunk size, the cancel check, the progress and the pause every scan here is given. */
  private scanOptions(shouldCancel: () => boolean, progress: (fraction: number) => void) {
    const pause = this.options.pause?.();
    return {
      shouldCancel,
      onProgress: progress,
      ...(this.options.chunkSize === undefined ? {} : { chunkSize: this.options.chunkSize }),
      ...(pause === undefined ? {} : { pause }),
    };
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent.matchStarts */
  async *matchStarts(
    query: ByteQuery,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): AsyncIterable<MatchBatch> {
    // The scan hands over each window's starts by callback; they are queued here and yielded in
    // order, the scan running ahead no further than the pause lets it.
    const queue: MatchBatch[] = [];
    let pending: number[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    let failure: unknown;
    const deliver = (scannedUpTo: number) => {
      queue.push({ starts: pending, scannedUpTo });
      pending = [];
      wake?.();
    };
    const scan = maskedMatches(
      [queryPattern(query)],
      this.storage,
      (match) => {
        pending.push(match.start);
        if (pending.length >= DEFAULT_BATCH_SIZE) {
          // Matches are visited in order of start, and they overlap: what is known complete
          // mid-window is every start up to this one, not up to its end.
          deliver(match.start + 1);
        }
        return true;
      },
      {
        ...this.scanOptions(shouldCancel, progress),
        overlapping: true,
        // Every window is an instalment, even an empty one: a stretch with no match in it is
        // still a stretch the index now knows about.
        windowFinished: deliver,
      }
    ).then(
      () => {
        done = true;
        wake?.();
      },
      (error: unknown) => {
        // A cancelled scan ends the stream normally, with whatever it had: a superseded search
        // must not throw at the app.
        if (!(error instanceof SearchCancelled)) failure = error ?? new Error("The search failed.");
        done = true;
        wake?.();
      }
    );
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    await scan;
    if (failure !== undefined) throw failure;
    if (pending.length > 0) yield { starts: pending, scannedUpTo: this.storage.size };
  }
}
