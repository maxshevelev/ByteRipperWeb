import { FindLimits } from "@/core/find/matchSet";

/**
 * Finding a byte sequence in a storage: the scan's shared terms.
 *
 * Ported from `SearchEngine.swift`. Search reads the *current* storage — unsaved edits included —
 * so a result is always about what is on screen. The scan itself is `PatternScan`'s
 * (`maskedSearch.ts`), reached through `maskedMatches` and `maskedLastMatch`; the dump's find bar
 * runs it through `ByteFindContent`, where matches always overlap. It is the one scan the agent's
 * `find_bytes` and the UEFI Structure's search run as well, so the three cannot disagree about
 * what a match is (#33).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine
 */

/**
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine.defaultChunkSize
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.defaultChunkSize
 */
export const DEFAULT_SEARCH_CHUNK_SIZE = 1024 * 1024;
/**
 * The most matches a results list shows. It limits *listing*, not counting — the scan that counts
 * is uncapped, so a pattern found a thousand and one times and one found three million times do
 * not look alike.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine.defaultMaxResults
 */
export const DEFAULT_MAX_RESULTS = FindLimits.listedMatches;

/**
 * How many matches the highlighting scan (`ByteFindContent.matchStarts`) delivers at a time. A
 * batch is a delivery cost, not a limit: one match per hop onto the consumer is wrong for the
 * million matches a single-byte pattern has.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine.defaultBatchSize
 */
export const DEFAULT_BATCH_SIZE = 4096;

/**
 * A search asked for no bytes at all: nothing to look for is a mistake in the
 * caller, not an answer of "nowhere".
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError.emptyPattern
 */
export class SearchPatternEmpty extends Error {
  constructor() {
    super("The pattern is empty.");
    this.name = "SearchPatternEmpty";
  }
}

export class SearchCancelled extends Error {
  constructor() {
    super("The search was cancelled.");
    this.name = "SearchCancelled";
  }
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ScanOptions {
  readonly chunkSize?: number;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (fraction: number) => void;
  /**
   * Called between windows; a promise it returns is awaited before the next.
   *
   * A scan on the main thread passes one that hands the event loop a turn once
   * a slice is spent — reads the cache answers resolve as microtasks, and a loop
   * of those otherwise holds the interface until the file is done.
   *
   * @web-only upstream scans on a background queue and never shares its thread with the interface
   */
  readonly pause?: () => Promise<void> | undefined;
}
