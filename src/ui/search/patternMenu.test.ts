import { describe, expect, it } from "vitest";
import {
  favoriteNameProblem,
  keepingDescription,
  type MenuSearch,
  patternMenuRows,
  searchFlags,
} from "@/ui/search/patternMenu";

const recent: MenuSearch = { pattern: "DE AD BE EF", encoding: "hex", caseSensitive: false };
const favorite: MenuSearch = {
  name: "ME FPT",
  pattern: "$FPT",
  encoding: "ascii",
  caseSensitive: true,
};

describe("a search in the menu", () => {
  it("states the case rule for text either way, and none for hex", () => {
    expect(searchFlags({ encoding: "hex", caseSensitive: true })).toBe("Hex bytes");
    expect(searchFlags({ encoding: "utf16LE", caseSensitive: false })).toBe(
      "UTF-16 LE, ignore case"
    );
    expect(searchFlags({ encoding: "ascii", caseSensitive: true })).toBe("ASCII, match case");
  });
});

describe("the search menu", () => {
  it("lists the recents, their commands, the favourites and Manage Favorites, in that order", () => {
    const rows = patternMenuRows({ recents: [recent], favorites: [favorite], fieldText: "x" });
    expect(rows.map((row) => row.key)).toEqual([
      "recents",
      "recent-0",
      "after-recents",
      "addToFavorites",
      "clearRecents",
      "before-favorites",
      "favorites",
      "favorite-0",
      "before-manage",
      "manageFavorites",
    ]);
  });

  it("offers Add to Favorites and Manage Favorites with both lists empty", () => {
    const rows = patternMenuRows({ recents: [], favorites: [], fieldText: "" });
    expect(rows.map((row) => row.key)).toEqual([
      "addToFavorites",
      "before-manage",
      "manageFavorites",
    ]);
  });

  it("dims Add to Favorites while the field is empty", () => {
    const [add] = patternMenuRows({ recents: [], favorites: [], fieldText: "   " });
    expect(add).toMatchObject({ key: "addToFavorites", disabled: true });
  });

  it("marks a favourite that no longer parses", () => {
    const rows = patternMenuRows({
      recents: [],
      favorites: [{ ...favorite, pattern: "DE A", encoding: "hex" }],
      fieldText: "",
    });
    expect(rows.find((row) => row.key === "favorite-0")).toMatchObject({
      name: "ME FPT",
      usable: false,
    });
  });
});

describe("keeping a pattern", () => {
  it("asks for a name", () => {
    expect(favoriteNameProblem("  ", favorite, undefined)).toBe(
      "Enter a name — it is what the menu shows."
    );
  });

  it("refuses a pattern that cannot be searched", () => {
    expect(
      favoriteNameProblem(
        "broken",
        { pattern: "DE A", encoding: "hex", caseSensitive: false },
        undefined
      )
    ).toBe("That pattern cannot be read as Hex bytes.");
  });

  it("says which name the same search is already kept under", () => {
    expect(favoriteNameProblem("FPT", favorite, { name: "ME FPT" })).toBe(
      'Already a favourite, as "ME FPT".'
    );
    expect(favoriteNameProblem("FPT", favorite, undefined)).toBeUndefined();
  });

  it("says what is being kept", () => {
    expect(keepingDescription(favorite)).toBe('Keeping "$FPT" — ASCII, match case.');
  });
});
