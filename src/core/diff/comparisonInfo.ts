/**
 * The comparison's answer as one part of a pane's status line (§14.4).
 *
 * It sits *in* the line rather than in a band of its own, which is where
 * upstream keeps it: `ComparisonView.refreshComparisonInfo` writes one string
 * onto both panes and the panes append it to everything else they say about
 * themselves. Two panes, two lines, the same sentence in both — the window does
 * not have a summary of its own.
 *
 * The counts are plain digits, not grouped: upstream writes `"\(diffBytes)
 * differing · \(sameBytes) same"` and the number of bytes that differ is read
 * beside the file's own abbreviated size, not instead of it.
 *
 * Three states are worth telling apart, and only the ready one has anything to
 * say:
 *
 * - **Not ready.** While the index is being built the progress is shown by the
 *   operation strip on the pane, not by text (§14.4), so this part is empty.
 *   Nothing is claimed about a comparison that has not finished.
 * - **Ready.** The counts. Zero differing is written as `0 differing` rather
 *   than as a word of its own — *Files are identical* is the toolbar badge's
 *   sentence (upstream's `filesIdenticalItem`), and saying it twice in two
 *   vocabularies is how the two drift.
 * - **Failed.** Also empty: a comparison that could not run is a problem, and
 *   problems are reported as alerts rather than as a line beside the bytes.
 *
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo
 */
export interface ComparisonCounts {
  /**
   * The index is built, so the counts below mean something.
   *
   * @upstream ByteRipperApp/Window/ComparisonCoordinator.swift#ComparisonCoordinator.index
   */
  readonly ready: boolean;
  /** @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo */
  readonly differingBytes: number;
  /** @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo */
  readonly sameBytes: number;
}

/** The app's separator, inside this part rather than around it. */
const SEPARATOR = " · ";

/**
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo
 * @upstream-differs the counts are passed in rather than read off a coordinator, so
 * the line stays a pure function of what it reads
 */
export function comparisonInfo(counts: ComparisonCounts): string {
  if (!counts.ready) return "";
  return `${counts.differingBytes} differing${SEPARATOR}${counts.sameBytes} same`;
}
