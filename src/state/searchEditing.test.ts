import { afterEach, describe, expect, it } from "vitest";
import type { SearchEncoding } from "@/core/search/searchPattern";
import {
  clearRecents,
  closeSearch,
  editQuery,
  FIND_HISTORY_LIMIT,
  type FindHistoryEntry,
  openSearch,
  parseFindHistory,
  recordFindHistory,
  searchStore,
  setCaseSensitive,
  setSearchEncoding,
  startSearch,
} from "@/state/searchStore";

/**
 * Typing a pattern and choosing how to read it start nothing — the search runs
 * on Return, and only a search that found something is remembered.
 */

afterEach(() => {
  closeSearch();
  clearRecents();
  setCaseSensitive(false);
});

const snapshot = () => searchStore.getSnapshot();

const entry = (
  pattern: string,
  encoding: SearchEncoding = "ascii",
  caseSensitive = false
): FindHistoryEntry => ({ pattern, encoding, caseSensitive });

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

  it("outlive the bar: closing it keeps the case rule", () => {
    setCaseSensitive(true);
    closeSearch();
    expect(snapshot().caseSensitive).toBe(true);
  });
});

describe("the recent queries", () => {
  it("are forgotten on Clear Recents", () => {
    searchStore.update((state) => ({ ...state, history: [entry("boot"), entry("DE AD", "hex")] }));

    clearRecents();

    expect(snapshot().history).toEqual([]);
  });

  it("keep the most recent first, and the same text in another encoding as another search", () => {
    let history: readonly FindHistoryEntry[] = [];
    history = recordFindHistory(history, entry("boot", "ascii"));
    history = recordFindHistory(history, entry("boot", "utf16LE"));
    history = recordFindHistory(history, entry("DE AD", "hex"));
    expect(history.map((kept) => `${kept.pattern} ${kept.encoding}`)).toEqual([
      "DE AD hex",
      "boot utf16LE",
      "boot ascii",
    ]);
  });

  it("move a repeated search to the front, its case rule with it", () => {
    let history = recordFindHistory([], entry("boot"));
    history = recordFindHistory(history, entry("DE AD", "hex"));
    history = recordFindHistory(history, entry("boot", "ascii", true));
    expect(history).toEqual([entry("boot", "ascii", true), entry("DE AD", "hex")]);
  });

  it("change nothing for the search already at the front", () => {
    const history = recordFindHistory([], entry("boot"));
    expect(recordFindHistory(history, entry("  boot "))).toBe(history);
  });

  it("are bounded", () => {
    let history: readonly FindHistoryEntry[] = [];
    for (let index = 0; index <= FIND_HISTORY_LIMIT; index++) {
      history = recordFindHistory(history, entry(`pattern ${index}`));
    }
    expect(history).toHaveLength(FIND_HISTORY_LIMIT);
    expect(history[0]?.pattern).toBe(`pattern ${FIND_HISTORY_LIMIT}`);
  });

  it("read back what was kept, leaving out the rows they cannot read", () => {
    const raw = JSON.stringify([
      entry("boot", "ascii", true),
      { pattern: "x", encoding: "klingon" },
      "nonsense",
      { pattern: "  ", encoding: "hex" },
      { pattern: "DE AD", encoding: "hex" },
    ]);
    expect(parseFindHistory(raw)).toEqual([entry("boot", "ascii", true), entry("DE AD", "hex")]);
    expect(parseFindHistory("not json")).toEqual([]);
    expect(parseFindHistory(null)).toEqual([]);
  });
});

describe("opening the find bar", () => {
  it("starts from the last search, in the encoding it was found in", () => {
    searchStore.update((state) => ({
      ...state,
      history: [entry("boot", "utf16LE"), entry("DE AD", "hex")],
    }));

    openSearch();

    expect(snapshot().query).toBe("boot");
    expect(snapshot().encoding).toBe("utf16LE");
  });

  it("starts empty when nothing is remembered", () => {
    openSearch();
    expect(snapshot().query).toBe("");
  });

  it("leaves a bar that is already up as it is", () => {
    openSearch();
    editQuery("typed");
    searchStore.update((state) => ({ ...state, history: [entry("boot")] }));

    openSearch();

    expect(snapshot().query).toBe("typed");
  });
});
