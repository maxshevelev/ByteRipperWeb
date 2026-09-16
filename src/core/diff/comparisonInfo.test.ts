/**
 * The comparison's part of a pane's status line.
 *
 * Upstream asserts it off a laid-out window — `refreshComparisonInfo` writes
 * onto both pane views and the test reads the label back. Here it is a function
 * of the counts, so the same strings are asserted without a view.
 */

import { describe, expect, it } from "vitest";
import { comparisonInfo } from "@/core/diff/comparisonInfo";

describe("what a pane says about the comparison", () => {
  // @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo
  it("counts the differing and the same bytes", () => {
    expect(comparisonInfo({ ready: true, differingBytes: 12, sameBytes: 2048 })).toBe(
      "12 differing · 2048 same"
    );
  });

  // @upstream ByteRipperTests/DiffNavigationTests.swift#DiffNavigationTests.waitForIndex
  it("says nothing while the index is being built", () => {
    // The progress is the operation strip's, not a sentence's (§14.4): a line
    // that said "0 differing" mid-scan would be answering a question that has
    // not been asked yet. Upstream's own tests use exactly that emptiness —
    // they wait for the index on the words appearing, which works only because
    // there are none before it is ready.
    expect(comparisonInfo({ ready: false, differingBytes: 0, sameBytes: 0 })).toBe("");
  });

  // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.filesIdenticalItem
  it("writes an identical pair as counts, not as a verdict", () => {
    // "Files are identical" is the toolbar badge's sentence — the only place
    // upstream spells that verdict — and the pane's part is the numbers behind
    // it, spelled the one way upstream spells them.
    expect(comparisonInfo({ ready: true, differingBytes: 0, sameBytes: 4096 })).toBe(
      "0 differing · 4096 same"
    );
  });

  // @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.refreshComparisonInfo
  it("leaves the counts ungrouped", () => {
    // Upstream writes the raw figures beside a size that is already an
    // abbreviation, so a grouped count would be a second house style in one line.
    expect(comparisonInfo({ ready: true, differingBytes: 123456, sameBytes: 6543210 })).toBe(
      "123456 differing · 6543210 same"
    );
  });
});
