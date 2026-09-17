/**
 * What the panes' status bar says about an open comparison (§14.4): how much of
 * it differs, as a share of the comparison's extent.
 *
 * A value, not a view: the interesting parts — the extent the share is taken
 * out of, and the rounding — are then assertable without a window. The pane
 * asks for the text as it draws its line, which is upstream's arrangement read
 * from the other end: there, `ComparisonView.refreshComparisonInfo` writes the
 * string onto both panes' labels; here the two panes each ask for it.
 *
 * The share is rounded UP to one decimal place, which is what keeps the readout
 * honest at both ends. A comparison that differs by a single byte in 16 MB says
 * so (0.1%) instead of rounding away to nothing, and one that does not differ
 * at all says nothing at all rather than 0.0%, which is what the bar would read
 * as "no comparison is running".
 *
 * The value sits in the same file as the line it goes into, unlike upstream's
 * two: `ComparisonSummary` is a struct beside an NSTextField there, and the
 * web's readout is text a component asks a function for.
 */

import type { DiffBlockIndex } from "@/core/diff/diffBlock";

/**
 * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary
 */
export interface ComparisonSummary {
  /**
   * The extent the share is taken out of: the longer file's length, which is
   * what the block index covers (§8.1) and what both panes scroll over (§9) —
   * so "differing 25.0%" is a quarter of what the user can scroll, not a
   * quarter of whichever pane they happen to be reading.
   *
   * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary.extent
   */
  readonly extent: number;
  /**
   * The offsets whose bytes differ between the two files, an EOF-only tail
   * included (§8.1).
   *
   * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary.differingBytes
   */
  readonly differingBytes: number;
}

/**
 * Reads an index. One pass over its blocks, which are byte-exact even where a
 * hunk would merge them (§10.3) — the share is per byte, like the
 * highlighting, so the grouping distance never moves it.
 *
 * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary.init
 * @upstream-differs the sum is the index's own `differingBytes`, which walks the columns it
 * holds flat; upstream reduces over `blocks`, which materialises one object per block
 */
export function comparisonSummary(index: DiffBlockIndex): ComparisonSummary {
  return { extent: index.maxSize, differingBytes: index.differingBytes };
}

/**
 * The status bar's part. Empty when there is nothing to report — the two files
 * do not differ (or there are no bytes to compare at all), and the bar says
 * nothing rather than "differing 0.0%".
 *
 * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary.text
 */
export function summaryText(summary: ComparisonSummary): string {
  const tenths = tenthsOfPercent(summary.differingBytes, summary.extent);
  if (tenths <= 0) return "";
  // The decimal is always there, even at a whole value: the readout is a number
  // the user reads while editing, and "differing 25%" growing a decimal place on
  // the next keystroke would make it jump.
  return `differing ${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/**
 * The share in tenths of a percent, rounded up — the smallest number of tenths
 * that covers `differing` out of `of`.
 *
 * Ceiling division of two exact integers, not `ceil` over a percentage: a share
 * that lands exactly on a tenth has to come out on that tenth, and a figure
 * that arrives a hair above it (or a hair below a tie) would move it a tenth
 * the wrong way.
 *
 * @upstream ByteRipperApp/Window/ComparisonSummary.swift#ComparisonSummary.tenthsOfPercent
 * @upstream-differs the product is a double, where upstream multiplies in full width so a
 * difference in the petabytes cannot overflow a word: a count here is a JS number, exact
 * below 2^53 bytes, and `Math.ceil` of a correctly-rounded quotient lands on the same tenth
 */
function tenthsOfPercent(differing: number, of: number): number {
  if (differing <= 0 || of <= 0) return 0;
  if (differing >= of) return 1000; // every byte, and the EOF tail
  // `differing < of` bounds the quotient below 1000, so the result is always
  // three digits or fewer.
  return Math.ceil((differing * 1000) / of);
}

/**
 * The line's comparison part as the pane asks for it: the share of a finished
 * index, and nothing at all when there is no index to read.
 *
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo
 * @upstream-differs the caller answers whether there is an index rather than this
 * read reaching for a coordinator — and the question it answers is "is the index ready",
 * not "is there one": the web's store keeps the previous index up while a rescan runs
 * (see `src/state/diffStore.ts`), where upstream's coordinator sets its index nil at
 * `start()`, so an index that exists here may be one that is being rebuilt.
 */
export function comparisonInfo(index: DiffBlockIndex | undefined): string {
  return index === undefined ? "" : summaryText(comparisonSummary(index));
}
