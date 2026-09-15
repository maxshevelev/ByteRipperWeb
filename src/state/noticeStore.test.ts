import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptsFor } from "@/core/search/smartSearch";
import {
  dismissNotice,
  FADE_OUT_MS,
  GLYPH_HOLD_DURATION_MS,
  HOLD_DURATION_MS,
  noticeStore,
  showNotice,
  showWrapNotice,
} from "@/state/noticeStore";
import { closeSearch, nothingFoundLines, startSearch } from "@/state/searchStore";

/**
 * The window's transient notices — upstream's `SmartSearchFlowTests` where they
 * are about the plate rather than about where AppKit draws it.
 */

const notice = () => noticeStore.getSnapshot();

beforeEach(() => {
  vi.useFakeTimers();
  dismissNotice(false);
});

afterEach(() => {
  dismissNotice(false);
  vi.useRealTimers();
});

describe("a plate", () => {
  // It goes on its own, and takes nothing with it: a report, not a dialog.
  // @upstream ByteRipperTests/SmartSearchFlowTests.swift#SmartSearchFlowTests.testTheNoticeLeavesOnItsOwn
  it("holds, fades and leaves on its own", () => {
    showNotice("smartSearch", ["Smart search.", "ASCII — no results."]);
    expect(notice().current?.lines).toEqual(["Smart search.", "ASCII — no results."]);

    vi.advanceTimersByTime(HOLD_DURATION_MS);
    expect(notice().current).toBeUndefined();
    expect(notice().leaving).toBeDefined();

    vi.advanceTimersByTime(FADE_OUT_MS);
    expect(notice().leaving).toBeUndefined();
  });

  it("holds only a moment when it is nothing but a glyph", () => {
    showWrapNotice("forward");
    expect(notice().current).toMatchObject({ glyph: "wrapForward", lines: [] });

    vi.advanceTimersByTime(GLYPH_HOLD_DURATION_MS);
    expect(notice().current).toBeUndefined();
  });

  it("turns the way the search was going", () => {
    showWrapNotice("backward");
    expect(notice().current?.glyph).toBe("wrapBackward");
  });

  // A cross-fade between two answers reads as a glitch.
  it("replaces the last one at once, with no fade between them", () => {
    showNotice("smartSearch", ["Smart search."]);
    const first = notice().current;

    showWrapNotice("forward");

    expect(notice().current?.id).not.toBe(first?.id);
    expect(notice().leaving).toBeUndefined();
  });
});

describe("a plate about a search", () => {
  // It goes the moment its search stops being the current one, rather than
  // sitting out its four seconds over a search that has already answered.
  // @upstream ByteRipperTests/SmartSearchFlowTests.swift#SmartSearchFlowTests.testANewSearchTakesTheStalePlateAway
  it("is taken away by the next search", () => {
    showNotice("smartSearch", ["Smart search."]);

    startSearch({ query: "" });

    expect(notice().current).toBeUndefined();
  });

  // Closing the bar means that search is over.
  // @upstream ByteRipperTests/SmartSearchFlowTests.swift#SmartSearchFlowTests.testClosingTheBarTakesThePlateAway
  it("is taken away with the bar", () => {
    showNotice("smartSearch", ["Smart search."]);

    closeSearch();

    expect(notice().current).toBeUndefined();
  });

  // One line per question asked, naming every encoding it stood for.
  // @upstream ByteRipperTests/SmartSearchFlowTests.swift#SmartSearchFlowTests.testAPassThatFindsNothingNamesWhatItTried
  it("names every encoding a pass that found nothing tried", () => {
    expect(nothingFoundLines(attemptsFor("boot", false))).toEqual([
      "Smart search.",
      "ASCII, UTF-8 — no results.",
      "UTF-16 LE — no results.",
      "UTF-16 BE — no results.",
    ]);
  });

  // A hex-looking pattern tries hex first, and the text encodings after it.
  // @upstream ByteRipperTests/SmartSearchFlowTests.swift#SmartSearchFlowTests.testAHexLikePatternThatIsNowhereListsHexFirst
  it("lists hex first for a pattern that looks like bytes", () => {
    const lines = nothingFoundLines(attemptsFor("DE AD", false));
    expect(lines[1]).toBe("Hex bytes — no results.");
    expect(lines).toHaveLength(5);
  });
});
