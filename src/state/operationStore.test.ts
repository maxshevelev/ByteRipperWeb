import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundOperation,
  beginOperation,
  DEFAULT_OPERATION_DEBOUNCE_MS,
  endOperation,
  operationStore,
  presentOnActivePane,
} from "@/state/operationStore";
import { setActivePane } from "@/state/workspaceStore";

/**
 * Long operations and the strip that shows them — upstream's
 * `BackgroundOperationTests`, and the debounce `FilePaneView` owns.
 */

describe("an operation", () => {
  // Moves of less than a percent are not passed on.
  // @upstream ByteRipperTests/BackgroundOperationTests.swift#BackgroundOperationTests.testReportThrottlesToOnePercentSteps
  it("passes progress on in steps of a percent", () => {
    const operation = new BackgroundOperation("Test", () => {});
    const reported: number[] = [];
    operation.onProgress = (fraction) => reported.push(fraction);

    for (const fraction of [0.001, 0.002, 0.005, 0.01, 0.02, 0.5]) operation.report(fraction);

    expect(reported).toHaveLength(3);
    expect(reported[0]).toBeCloseTo(0.01);
    expect(reported[1]).toBeCloseTo(0.02);
    expect(reported[2]).toBeCloseTo(0.5);
  });

  // The bar reaches the end before it goes.
  // @upstream ByteRipperTests/BackgroundOperationTests.swift#BackgroundOperationTests.testFinalProgressAlwaysDispatches
  it("always passes the final step on", () => {
    const operation = new BackgroundOperation("Test", () => {});
    const reported: number[] = [];
    operation.onProgress = (fraction) => reported.push(fraction);

    operation.report(0.995);
    operation.report(1);

    expect(reported.at(-1)).toBe(1);
  });

  // @upstream ByteRipperTests/BackgroundOperationTests.swift#BackgroundOperationTests.testReportClampsAboveUnit
  it("never lets the bar overshoot", () => {
    const operation = new BackgroundOperation("Test", () => {});
    const reported: number[] = [];
    operation.onProgress = (fraction) => reported.push(fraction);

    operation.report(0.5);
    operation.report(1.5);

    expect(reported).toEqual([0.5, 1]);
  });

  // @upstream ByteRipperTests/BackgroundOperationTests.swift#BackgroundOperationTests.testFinishIsIdempotentAndSwallowsLateReports
  it("finishes once, and ignores a report that comes after", () => {
    const operation = new BackgroundOperation("Test", () => {});
    let finished = 0;
    operation.onFinish = () => finished++;

    operation.finish();
    operation.finish();
    expect(finished).toBe(1);

    const reported: number[] = [];
    operation.onProgress = (fraction) => reported.push(fraction);
    operation.report(0.5);
    expect(reported).toEqual([]);
  });

  // @upstream ByteRipperTests/BackgroundOperationTests.swift#BackgroundOperationTests.testCancelCallsCancelAction
  it("asks its owner to stop when cancelled", () => {
    let cancelled = false;
    new BackgroundOperation("Test", () => {
      cancelled = true;
    }).cancel();
    expect(cancelled).toBe(true);
  });

  it("says a new name once, and nothing after it has finished", () => {
    const operation = new BackgroundOperation("Getting ready", () => {});
    const names: string[] = [];
    operation.onRename = (name) => names.push(name);

    operation.rename("Reading");
    operation.rename("Reading");
    operation.finish();
    operation.rename("Writing");

    expect(names).toEqual(["Reading"]);
    expect(operation.name).toBe("Reading");
  });
});

describe("the strip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    endOperation("a");
    endOperation("b");
  });

  afterEach(() => {
    endOperation("a");
    endOperation("b");
    setActivePane("a");
    vi.useRealTimers();
  });

  const shown = (pane: "a" | "b") => operationStore.getSnapshot()[pane];

  it("waits out the debounce before it appears, and follows the progress", () => {
    const operation = new BackgroundOperation("Searching…", () => {});
    beginOperation("a", operation);
    expect(shown("a")?.revealed).toBe(false);

    vi.advanceTimersByTime(DEFAULT_OPERATION_DEBOUNCE_MS);
    expect(shown("a")?.revealed).toBe(true);

    operation.report(0.4);
    expect(shown("a")?.progress).toBe(0.4);
  });

  it("never appears for an operation that finished inside the debounce", () => {
    const operation = new BackgroundOperation("Searching…", () => {});
    beginOperation("a", operation);

    operation.finish();
    vi.advanceTimersByTime(DEFAULT_OPERATION_DEBOUNCE_MS);

    expect(shown("a")).toBeUndefined();
  });

  it("follows the active pane, already shown", () => {
    const operation = new BackgroundOperation("Indexing…", () => {});
    presentOnActivePane(operation);
    expect(shown("a")?.operation).toBe(operation);

    setActivePane("b");

    expect(shown("a")).toBeUndefined();
    expect(shown("b")).toMatchObject({ operation, revealed: true });
  });
});
