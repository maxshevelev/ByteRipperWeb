/**
 * What a search is, apart from what it searches: the content says how to scan itself for a
 * query, and the pass over several candidates is the same for every content
 * (`Packages/Find` upstream).
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift
 */

/**
 * Which way a search goes from where the reader is.
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift#SearchDirection
 */
export type SearchDirection = "forward" | "backward";

/**
 * A stretch of content, half-open: `[start, end)`, in the content's own units.
 *
 * @web-only upstream's `Range<UInt64>`; the web's ranges are `{start, end}` records throughout
 */
export interface FindRange {
  readonly start: number;
  readonly end: number;
}

/** Whether two ranges are the same stretch; either may be missing. */
export const sameRange = (a: FindRange | undefined, b: FindRange | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.start === b.start && a.end === b.end);

/**
 * What one stretch of an index scan found: the starts of the matches in it, in order, and how
 * far the scan has now covered.
 *
 * A scan reports as it goes, so the matches it has covered can be shown while the rest of the
 * content is still being scanned, and only what needs the whole content — the total, the wrap,
 * an ordinal — waits for the end (§11).
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift#MatchBatch
 */
export interface MatchBatch {
  /** @upstream Packages/Find/Sources/Find/FindContent.swift#MatchBatch.starts */
  readonly starts: ArrayLike<number>;
  /**
   * Half-open: matches at or above this position are not known yet.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#MatchBatch.scannedUpTo
   */
  readonly scannedUpTo: number;
}

/**
 * Something a search can run over: the bytes of a dump, a text.
 *
 * The content knows how to scan itself for a query; everything a search does with the scans —
 * the pass over several candidates, the index as it fills, the steps and the wrap — is
 * `FindIndexer`'s, the same for every content.
 *
 * Positions are offsets in the content's own units: bytes for a dump. Every match of one query
 * is `matchLength(query)` long.
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift#FindContent
 * @upstream-differs the scans are promises and async iterables, since a page's reads are
 * asynchronous; and the content says when two queries are the same search, which Swift's
 * `Equatable` says for upstream's
 */
export interface FindContent<Query> {
  /**
   * How long the content is: the end of the last position a match can cover.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#FindContent.extent
   */
  readonly extent: number;

  /**
   * How long every match of `query` is.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#FindContent.matchLength
   */
  matchLength(query: Query): number;

  /**
   * Whether two queries are the same search.
   *
   * @web-only upstream's Query is `Equatable`; a JavaScript value compares by identity
   */
  sameQuery(a: Query, b: Query): boolean;

  /**
   * The first match of `query` from `anchor` in `direction`, not wrapping — forward, the first
   * starting at or after `anchor`; backward, the last starting before it. Both by start, as
   * `MatchSet` steps, so a step through a built index and a scan land on the same match. Nothing
   * when there is none that way.
   *
   * Rejects once `shouldCancel` says so, and may reject when the content cannot be read.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#FindContent.firstMatch
   */
  firstMatch(
    query: Query,
    anchor: number,
    direction: SearchDirection,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): Promise<FindRange | undefined>;

  /**
   * Every match of `query`, from the start of the content to its end, in batches as the scan
   * goes. The scan stops once `shouldCancel` says so, and reports how far it has got through
   * `progress`, as a fraction.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#FindContent.matchStarts
   */
  matchStarts(
    query: Query,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): AsyncIterable<MatchBatch>;
}

/**
 * The candidate that found something, where, and whether the scan had to come round the end to
 * find it.
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.Found
 */
export interface FindPassFound<Query> {
  /**
   * Its position among the candidates.
   *
   * @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.Found.index
   */
  readonly index: number;
  /** @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.Found.query */
  readonly query: Query;
  /** @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.Found.range */
  readonly range: FindRange;
  /** @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.Found.wrapped */
  readonly wrapped: boolean;
}

/**
 * The search a press of Return runs before there is an index: the candidates in order, until one
 * of them finds something (§11).
 *
 * Each candidate is two scans: one from the anchor in the direction asked, and — failing that —
 * one from the content's other end, which is the wrap. So "this candidate finds nothing" means
 * nothing anywhere, not merely nothing ahead of the reader, and the pass moves on to the next
 * candidate only when it is sure. A plain search is a pass of one; the dump's Smart Search is a
 * pass of one candidate per encoding.
 *
 * `progress` covers the whole pass: each candidate owns its share, and each of its two scans half
 * of that share. Cancelling through `shouldCancel` rejects from the scan in flight.
 *
 * @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass
 * @upstream Packages/Find/Sources/Find/FindContent.swift#FindPass.firstMatch
 */
export async function findPassFirstMatch<Query>(
  candidates: readonly Query[],
  content: FindContent<Query>,
  anchor: number,
  direction: SearchDirection,
  shouldCancel: () => boolean = () => false,
  progress: (fraction: number) => void = () => {}
): Promise<FindPassFound<Query> | undefined> {
  const total = candidates.length;
  for (let position = 0; position < total; position++) {
    const query = candidates[position] as Query;
    const scan = (from: number, half: number) =>
      content.firstMatch(query, from, direction, shouldCancel, (fraction) =>
        progress((position + half + fraction / 2) / total)
      );
    const here = await scan(anchor, 0);
    if (here !== undefined) return { index: position, query, range: here, wrapped: false };
    const edge = direction === "forward" ? 0 : content.extent;
    const round = await scan(edge, 0.5);
    if (round !== undefined) return { index: position, query, range: round, wrapped: true };
    progress((position + 1) / total);
  }
  return undefined;
}
