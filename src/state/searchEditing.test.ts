import { afterEach, describe, expect, it } from "vitest";
import {
  closeSearch,
  editQuery,
  searchStore,
  setCaseSensitive,
  setSearchEncoding,
  startSearch,
} from "@/state/searchStore";

/**
 * Typing a pattern and choosing how to read it start nothing — the search runs
 * on Return, and only a search that found something is remembered.
 */

afterEach(() => closeSearch());

const snapshot = () => searchStore.getSnapshot();

describe("editing the pattern", () => {
  // @upstream ByteRipperTests/FindFlowTests.swift#FindFlowTests.testEditingThePatternEndsTheSession
  it("ends the search that was running, and starts none", () => {
    searchStore.update((state) => ({
      ...state,
      problem: "That is not a hexadecimal byte sequence.",
      results: {
        ...state.results,
        a: { ...state.results.a, status: "notFound", current: { start: 0, end: 1 } },
      },
    }));

    editQuery("DE A");

    expect(snapshot().query).toBe("DE A");
    expect(snapshot().results.a.status).toBe("idle");
    expect(snapshot().results.a.current).toBeUndefined();
    expect(snapshot().problem).toBeUndefined();
  });

  it("puts nothing in the history, character by character", () => {
    for (const query of ["b", "bo", "boo", "boot"]) editQuery(query);
    expect(snapshot().history).toEqual([]);
  });

  it("puts nothing in the history for a search that ran nowhere", () => {
    // No pane is open, so this search cannot find anything.
    startSearch({ query: "boot" });
    expect(snapshot().history).toEqual([]);
  });
});

describe("the search's options", () => {
  it("change without searching", () => {
    setSearchEncoding("utf16LE");
    setCaseSensitive(true);

    expect(snapshot().encoding).toBe("utf16LE");
    expect(snapshot().caseSensitive).toBe(true);
    expect(snapshot().results.a.status).toBe("idle");
  });
});

describe("the recent queries", () => {
  it("are forgotten on Clear Recents", async () => {
    const { clearRecents } = await import("@/state/searchStore");
    searchStore.update((state) => ({ ...state, history: ["boot", "DE AD"] }));

    clearRecents();

    expect(snapshot().history).toEqual([]);
  });
});
