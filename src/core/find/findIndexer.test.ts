import { describe, expect, it } from "vitest";
import type { FindContent, MatchBatch, SearchDirection } from "@/core/find/findContent";
import { type FindActivity, FindIndexer } from "@/core/find/findIndexer";

// The domain half compiles without the DOM; the test runner has timers all the same.
declare const setTimeout: (callback: (value?: unknown) => void, ms?: number) => unknown;

/**
 * Ported from `FindIndexerTests.swift`: one search over one content — the pass, the index as it
 * fills, the steps and the wrap, what is shown, and stopping — over a text searched by exact
 * substring, so nothing here is about bytes.
 */

/**
 * Holds the scans that wait on it until it is opened.
 *
 * @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#Gate
 */
class Gate {
  private open = false;
  waiters = 0;

  async wait(shouldCancel: () => boolean): Promise<void> {
    this.waiters += 1;
    while (!this.open) {
      if (shouldCancel()) throw new Error("cancelled");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  release(): void {
    this.open = true;
  }
}

/**
 * A text, searched by exact substring. `gate`, when set, holds every scan until it is opened, so
 * a test can look at a search while it is still running.
 *
 * @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#TextContent
 */
class TextContent implements FindContent<string> {
  /** How many units each index batch covers. */
  batch = 4;

  readonly text: string;
  readonly gate: Gate | undefined;

  constructor(text: string, gate?: Gate) {
    this.text = text;
    this.gate = gate;
  }

  get extent(): number {
    return this.text.length;
  }

  matchLength(query: string): number {
    return query.length;
  }

  sameQuery(a: string, b: string): boolean {
    return a === b;
  }

  private starts(query: string): number[] {
    const found: number[] = [];
    if (query.length === 0) return found;
    let i = 0;
    while (i + query.length <= this.text.length) {
      if (this.text.startsWith(query, i)) {
        found.push(i);
        i += query.length;
      } else {
        i += 1;
      }
    }
    return found;
  }

  async firstMatch(
    query: string,
    anchor: number,
    direction: SearchDirection,
    shouldCancel: () => boolean
  ) {
    await this.gate?.wait(shouldCancel);
    const all = this.starts(query);
    const at =
      direction === "forward"
        ? all.find((start) => start >= anchor)
        : all.findLast((start) => start + query.length <= anchor);
    return at === undefined ? undefined : { start: at, end: at + query.length };
  }

  async *matchStarts(query: string, shouldCancel: () => boolean): AsyncIterable<MatchBatch> {
    await this.gate?.wait(shouldCancel);
    const all = this.starts(query);
    for (let cursor = 0; cursor < this.text.length; cursor += this.batch) {
      if (shouldCancel()) throw new Error("cancelled");
      const end = Math.min(cursor + this.batch, this.text.length);
      yield { starts: all.filter((start) => start >= cursor && start < end), scannedUpTo: end };
      await Promise.resolve();
    }
  }
}

/** @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#Activity */
class Activity implements FindActivity {
  finished = false;
  report(): void {}
  finish(): void {
    this.finished = true;
  }
}

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

/** Waits until the index has stopped being built. */
const settle = async (indexer: FindIndexer<string>): Promise<void> => {
  await waitFor(() => !indexer.isIndexing);
  expect(indexer.isIndexing).toBe(false);
};

describe("FindIndexer", () => {
  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testThePassTakesTheFirstCandidateThatFindsAndIndexesIt
  it("takes the first candidate that finds, and indexes it", async () => {
    const indexer = new FindIndexer(new TextContent("one two three two"));
    const outcome = await indexer.find(["four", "two"], 0, "forward");
    expect(outcome).toEqual({
      kind: "found",
      index: 1,
      query: "two",
      range: { start: 4, end: 7 },
      wrapped: false,
    });
    expect(indexer.current).toEqual({ start: 4, end: 7 });
    expect(indexer.isHighlighting).toBe(true);
    await settle(indexer);
    expect(indexer.matches?.query).toBe("two");
    expect(indexer.matches?.total).toBe(2);
    expect(indexer.matches?.isComplete).toBe(true);
    expect(indexer.currentIndex).toBe(0);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testNothingFoundIsAFinishedEmptySearch
  it("finds nothing as a finished empty search, in the last candidate's name", async () => {
    const indexer = new FindIndexer(new TextContent("abc"));
    expect(await indexer.find(["x", "y"], 0, "forward")).toEqual({ kind: "nothing" });
    expect(indexer.matches?.query).toBe("y");
    expect(indexer.matches?.isComplete).toBe(true);
    expect(indexer.matches?.isEmpty).toBe(true);
    expect(indexer.isIndexing).toBe(false);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testThePassWrapsAndSaysSo
  it("comes round the end and says so", async () => {
    const indexer = new FindIndexer(new TextContent("ab ab"));
    expect(await indexer.find(["ab"], 4, "forward")).toEqual({
      kind: "found",
      index: 0,
      query: "ab",
      range: { start: 0, end: 2 },
      wrapped: true,
    });
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testAListedSearchPutsNobodyOnAMatch
  it("puts nobody on a match for a listed search", async () => {
    const indexer = new FindIndexer(new TextContent("ab ab"));
    await indexer.find(["ab"], 0, "forward", false);
    expect(indexer.current).toBeUndefined();
    await settle(indexer);
    expect(indexer.matches?.total).toBe(2);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testAFinishedIndexAnswersStepsAndWraps
  it("answers steps from a finished index, both ways, and wraps", async () => {
    const indexer = new FindIndexer(new TextContent("ab ab ab"));
    await indexer.find(["ab"], 0, "forward");
    await settle(indexer);

    expect(await indexer.step("forward", 2)).toEqual({
      kind: "indexed",
      step: { index: 1, range: { start: 3, end: 5 }, wrapped: false },
    });
    expect(indexer.current).toEqual({ start: 3, end: 5 });
    expect(await indexer.step("forward", 8)).toEqual({
      kind: "indexed",
      step: { index: 0, range: { start: 0, end: 2 }, wrapped: true },
    });
    expect(await indexer.step("backward", 0)).toEqual({
      kind: "indexed",
      step: { index: 2, range: { start: 6, end: 8 }, wrapped: true },
    });
    expect(indexer.currentIndex).toBe(2);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testAStepPastAHalfBuiltIndexScansAndLeavesTheIndexRunning
  it("scans for a step past a half-built index and leaves the index running", async () => {
    const indexer = new FindIndexer(new TextContent("ab ab ab"));
    await indexer.find(["ab"], 0, "forward");
    await settle(indexer);
    // Now an index that cannot finish: the gate holds it.
    const gate = new Gate();
    indexer.content = new TextContent("ab ab ab", gate);
    indexer.index("ab");
    expect(indexer.isIndexing).toBe(true);
    await waitFor(() => gate.waiters >= 1);

    // The step's own scan waits on the gate too; open it once the step is under way, and the
    // index finishes behind it.
    const stepped = indexer.step("forward", 7);
    await waitFor(() => gate.waiters >= 2);
    expect(indexer.isIndexing).toBe(true);
    gate.release();
    expect(await stepped).toEqual({ kind: "scanned", range: { start: 0, end: 2 }, wrapped: true });
    expect(indexer.current).toEqual({ start: 0, end: 2 });
    await settle(indexer);
    expect(indexer.matches?.total).toBe(3);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testASecondPressForTheSameSearchIsAlreadyRunning
  it("answers a second press for the same search with the one already running", async () => {
    const gate = new Gate();
    const indexer = new FindIndexer(new TextContent("ab", gate));
    const first = indexer.find(["ab"], 0, "forward");
    expect(indexer.passInFlight).toBeDefined();
    expect(await indexer.find(["ab"], 0, "forward")).toEqual({ kind: "alreadyRunning" });
    gate.release();
    expect(await first).toEqual({
      kind: "found",
      index: 0,
      query: "ab",
      range: { start: 0, end: 2 },
      wrapped: false,
    });
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testAStoppedPassIsCancelled
  it("answers cancelled for a pass stopped through its activity", async () => {
    const gate = new Gate();
    const indexer = new FindIndexer(new TextContent("ab", gate));
    const activities: Activity[] = [];
    const cancels: (() => void)[] = [];
    indexer.beginActivity = (cancel) => {
      const activity = new Activity();
      activities.push(activity);
      cancels.push(cancel);
      return activity;
    };
    const outcome = indexer.find(["ab"], 0, "forward");
    await waitFor(() => gate.waiters >= 1);
    cancels[0]?.();
    expect(await outcome).toEqual({ kind: "cancelled" });
    expect(indexer.passInFlight).toBeUndefined();
    expect(activities[0]?.finished).toBe(true);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testANewSearchIgnoresTheIndexBeforeIt
  it("drops the batches of the index before a new search", async () => {
    const gate = new Gate();
    const indexer = new FindIndexer(new TextContent("ab cd ab", gate));
    indexer.index("ab");
    await waitFor(() => gate.waiters >= 1);
    indexer.content = new TextContent("ab cd ab");
    expect(await indexer.find(["cd"], 0, "forward")).toEqual({
      kind: "found",
      index: 0,
      query: "cd",
      range: { start: 3, end: 5 },
      wrapped: false,
    });
    gate.release();
    await settle(indexer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(indexer.matches?.query).toBe("cd");
    expect(indexer.matches?.total).toBe(1);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testInvalidatingDropsTheSetAndStopsTheIndex
  it("drops the set and stops the index when invalidated, and says both", () => {
    const gate = new Gate();
    const indexer = new FindIndexer(new TextContent("ab ab", gate));
    let setChanges = 0;
    indexer.onSetChanged = () => {
      setChanges += 1;
    };
    indexer.index("ab");
    expect(setChanges).toBe(1);
    indexer.invalidate();
    expect(indexer.matches).toBeUndefined();
    expect(indexer.isIndexing).toBe(false);
    expect(setChanges).toBe(2);
    gate.release();
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testAnIndexSaysOnceThatItFoundSomething
  it("says once that an index found something", async () => {
    const content = new TextContent("ab ab ab ab");
    content.batch = 2;
    const indexer = new FindIndexer(content);
    indexer.publishInterval = 0;
    const found: string[] = [];
    indexer.onFoundSomething = (query) => found.push(query);
    indexer.index("ab");
    await settle(indexer);
    expect(found).toEqual(["ab"]);
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testTwoIndexersAreIndependent
  it("keeps two indexers apart: stopping one leaves the other alone", async () => {
    const gate = new Gate();
    const left = new FindIndexer(new TextContent("ab ab", gate));
    const right = new FindIndexer(new TextContent("ab ab", gate));
    left.index("ab");
    right.index("ab");
    left.invalidate();
    expect(right.isIndexing).toBe(true);
    gate.release();
    await settle(right);
    expect(right.matches?.total).toBe(2);
    expect(left.matches).toBeUndefined();
  });

  // @upstream Packages/Find/Tests/FindTests/FindIndexerTests.swift#FindIndexerTests.testEndingTheShowingKeepsTheSet
  it("keeps the set when the showing ends", async () => {
    const indexer = new FindIndexer(new TextContent("ab ab"));
    await indexer.find(["ab"], 0, "forward");
    await settle(indexer);
    indexer.endHighlighting();
    expect(indexer.highlightedMatches).toBeUndefined();
    expect(indexer.current).toBeUndefined();
    expect(indexer.matches?.total).toBe(2);
    expect(indexer.matchRanges(0, 5)).toEqual([]);
    indexer.highlight(1);
    expect(indexer.current).toEqual({ start: 3, end: 5 });
    expect(indexer.matchRanges(0, 5)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});
