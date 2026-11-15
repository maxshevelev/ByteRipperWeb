import type { FindContent, FindRange, MatchBatch, SearchDirection } from "@/core/find/findContent";
import type { FindIndexer } from "@/core/find/findIndexer";
import {
  MAX_INDEX_BYTES,
  MatchSet,
  MatchSetBuilder,
  type MatchStorage,
} from "@/core/find/matchSet";
import { findOne, foldedPattern, scanAll } from "@/core/search/searchEngine";
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
  return true;
}

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
 * A dump's bytes as something `FindIndexer` searches: positions are byte offsets, and the scans
 * are the search engine's, run on the thread that asks — with a turn for the event loop between
 * windows when it is given a pause, so a page that scans its own document keeps drawing.
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
    const pause = this.options.pause?.();
    return findOne(foldedPattern(query.pattern.bytes, query.folding), this.storage, {
      from: anchor,
      direction,
      folding: query.folding,
      shouldCancel,
      onProgress: progress,
      ...(this.options.chunkSize === undefined ? {} : { chunkSize: this.options.chunkSize }),
      ...(pause === undefined ? {} : { pause }),
    });
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
    const pause = this.options.pause?.();
    const scan = scanAll(foldedPattern(query.pattern.bytes, query.folding), this.storage, {
      folding: query.folding,
      shouldCancel,
      onProgress: progress,
      onMatches: (starts) => {
        for (const start of starts) pending.push(start);
      },
      onWindow: (upTo) => {
        queue.push({ starts: pending, scannedUpTo: upTo });
        pending = [];
        wake?.();
      },
      ...(this.options.chunkSize === undefined ? {} : { chunkSize: this.options.chunkSize }),
      ...(pause === undefined ? {} : { pause }),
    }).then(
      () => {
        done = true;
        wake?.();
      },
      (error: unknown) => {
        failure = error ?? new Error("The search failed.");
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
