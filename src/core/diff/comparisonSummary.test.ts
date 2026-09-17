/**
 * The panes' status-bar reading of a comparison (§14.4): the share of it that
 * differs, out of the comparison's extent, one decimal place, rounded up — and
 * nothing at all when the two files do not differ.
 *
 * Ported from `ComparisonSummaryTests.swift`, which builds its value out of a
 * `DiffBlockIndex` the same way this does. The one case upstream asserts off a
 * laid-out window — that the string reaches the pane's line — is in
 * `src/core/text/statusLine.test.ts` with the rest of the line's spelling.
 */

import { expect, it } from "vitest";
import {
  type ComparisonSummary,
  comparisonInfo,
  comparisonSummary,
  summaryText,
} from "@/core/diff/comparisonSummary";
import { type DiffBlock, DiffBlockIndex } from "@/core/diff/diffBlock";

const same = (start: number, end: number): DiffBlock => ({ kind: "same", start, end });
const different = (start: number, end: number): DiffBlock => ({
  kind: "different",
  start,
  end,
});

/** @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.summary */
const summary = (left: number, right: number, blocks: readonly DiffBlock[]): ComparisonSummary =>
  comparisonSummary(DiffBlockIndex.of(left, right, blocks));

/**
 * The layout §10.3's navigation tests use: two 4800-byte files differing by one
 * byte at 1600 and one at 4000.
 *
 * @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.twoDifferencesIn4800
 */
const twoDifferencesIn4800 = (): ComparisonSummary =>
  summary(4800, 4800, [
    same(0, 1600),
    different(1600, 1601),
    same(1601, 4000),
    different(4000, 4001),
    same(4001, 4800),
  ]);

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testIdenticalFilesSayNothing
it("says nothing for identical files", () => {
  const identical = summary(4800, 4800, [same(0, 4800)]);
  expect(identical.differingBytes).toBe(0);
  // A comparison with no differences must leave the bar silent.
  expect(summaryText(identical)).toBe("");
  // And the pane's own read of a finished index says nothing with it — not the
  // toolbar badge's "Files are identical", which stays the toolbar's sentence.
  expect(comparisonInfo(DiffBlockIndex.of(4800, 4800, [same(0, 4800)]))).toBe("");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testAnEmptyComparisonSaysNothing
it("says nothing for an empty comparison", () => {
  // No bytes to compare at all: there is no extent to take a share of.
  expect(summaryText(summary(0, 0, []))).toBe("");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testASmallDifferenceRoundsUpRatherThanAway
it("rounds a small difference up rather than away", () => {
  // Two bytes out of 4800 is 0.0416…%, which reads 0.1%. Rounding to nearest
  // would print 0.0% over a real difference.
  expect(summaryText(twoDifferencesIn4800())).toBe("differing 0.1%");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testTheThirdOfAFileReadsAsTheTenthAboveIt
it("reads the third of a file as the tenth above it", () => {
  // It rounds *up*, not to nearest: 1 differing byte out of 3 is 33.333…%,
  // which nearest would call 33.3%.
  expect(summaryText(summary(3, 3, [different(0, 1), same(1, 3)]))).toBe("differing 33.4%");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testAnExactShareDoesNotCreepUp
it("does not creep up on an exact share", () => {
  // 1000 of 4000 is exactly 25%, and the readout must not creep to 25.1%.
  expect(summaryText(summary(4000, 4000, [different(0, 1000), same(1000, 4000)]))).toBe(
    "differing 25.0%"
  );
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testAWholeHundredKeepsItsDecimal
it("keeps the decimal place at a whole hundred", () => {
  // The decimal place is always shown, whole values included, so the readout
  // never changes width as edits land.
  expect(summaryText(summary(100, 100, [different(0, 100)]))).toBe("differing 100.0%");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testTheShareIsTakenOutOfTheLongerFile
it("takes the share out of the longer file", () => {
  // The extent is the longer file (§8.1), which is also what both panes scroll
  // over (§9) — an EOF-only tail is a difference, not extra extent.
  const tailOnly = summary(100, 200, [same(0, 100), different(100, 200)]);
  expect(tailOnly.extent).toBe(200);
  expect(tailOnly.differingBytes).toBe(100);
  expect(summaryText(tailOnly)).toBe("differing 50.0%");
});

// @upstream ByteRipperTests/ComparisonSummaryTests.swift#ComparisonSummaryTests.testOneKilobyteInSixteenMegabytesStillReads
it("still reads a kilobyte in sixteen megabytes", () => {
  // A share that could round away entirely is still reported: 1000 bytes of
  // 16 MB is 0.006%, and the readout says so instead of 0.0%.
  const size = 16 * 1024 * 1024;
  expect(summaryText(summary(size, size, [different(0, 1000), same(1000, size)]))).toBe(
    "differing 0.1%"
  );
});

// @upstream ByteRipperTests/DiffNavigationTests.swift#DiffNavigationTests.waitForIndex
it("says nothing while the index is being built", () => {
  // The progress is the operation strip's, not a sentence's (§14.4): a line
  // that said one mid-scan would be answering a question that has not been
  // asked yet. Upstream's own tests use exactly that emptiness — they wait for
  // the index on the words appearing, which works only because there are none
  // before it is ready.
  expect(comparisonInfo(undefined)).toBe("");
});
