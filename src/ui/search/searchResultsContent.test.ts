import { describe, expect, it } from "vitest";
import { MatchSet } from "@/core/search/matchSet";
import { DEFAULT_MAX_RESULTS } from "@/core/search/searchEngine";
import { EXACT, type SearchPattern } from "@/core/search/searchPattern";
import {
  searchResultsContent,
  searchResultsMessage,
  searchResultsTitle,
} from "@/ui/search/searchResultsContent";

const twoBytes: SearchPattern = { bytes: new Uint8Array([0xde, 0xad]), encoding: "hex" };
const complete = (starts: number[], extent = 1_000_000) =>
  MatchSet.of(twoBytes, EXACT, extent, starts);
const partial = (starts: number[]) =>
  new MatchSet(
    twoBytes,
    EXACT,
    1600,
    starts.length,
    { kind: "sparse", starts: Float64Array.from(starts) },
    800
  );

describe("the results panel's content", () => {
  it("lists a complete search's matches under their count", () => {
    const set = complete([3, 31]);
    const content = searchResultsContent(set, "found");
    expect(content).toEqual({ kind: "matches", total: 2 });
    expect(searchResultsTitle(content, set)).toBe("Search results (2)");
    expect(searchResultsMessage(content)).toBeUndefined();
  });

  it("says a count that is still growing is one", () => {
    const set = partial([3, 31]);
    const content = searchResultsContent(set, "found");
    expect(searchResultsTitle(content, set)).toBe("Search results (2, searching…)");
  });

  it("is still searching, not empty, before the scan has found anything", () => {
    expect(searchResultsContent(undefined, "searching")).toEqual({ kind: "searching" });
    const content = searchResultsContent(partial([]), "searching");
    expect(content).toEqual({ kind: "searching" });
    expect(searchResultsTitle(content, undefined)).toBe("Search results (searching…)");
    expect(searchResultsMessage(content)).toBe("Searching…");
  });

  it("says there are no matches where the rows would have been", () => {
    const content = searchResultsContent(undefined, "notFound");
    expect(content).toEqual({ kind: "empty" });
    expect(searchResultsTitle(content, undefined)).toBe("Search results (0)");
    expect(searchResultsMessage(content)).toBe("No matches.");
  });

  it("states the count and refuses past the listing limit", () => {
    const starts = Array.from({ length: DEFAULT_MAX_RESULTS + 1 }, (_, i) => i * 4);
    const set = complete(starts);
    const content = searchResultsContent(set, "found");
    expect(content.kind).toBe("tooMany");
    expect(searchResultsMessage(content)).toBe(
      `${(DEFAULT_MAX_RESULTS + 1).toLocaleString()} matches — too many to list. Refine the pattern.`
    );
  });
});
