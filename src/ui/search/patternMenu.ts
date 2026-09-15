import { encodingTitle, parsePattern, type SearchEncoding } from "@/core/search/searchPattern";

/**
 * The find bar's search menu, as rows: the two lists and the commands that
 * belong to each (§11). Kept apart from the component so what the menu says can
 * be tested without one.
 */

/** A search as the menu shows it: a favourite has a name, a recent does not. */
export interface MenuSearch {
  readonly name?: string;
  readonly pattern: string;
  readonly encoding: SearchEncoding;
  readonly caseSensitive: boolean;
}

export type PatternMenuCommand = "addToFavorites" | "clearRecents" | "manageFavorites";

export type PatternMenuRow =
  | {
      readonly kind: "heading";
      readonly key: string;
      readonly label: string;
      readonly icon: "recent" | "favorite";
    }
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly list: "recent" | "favorite";
      /** Its position in that list. */
      readonly index: number;
      readonly name: string;
      readonly pattern: string;
      readonly flags: string;
      /** False only for a pattern that no longer parses — a hand-edited store. */
      readonly usable: boolean;
    }
  | {
      readonly kind: "command";
      readonly key: PatternMenuCommand;
      readonly label: string;
      readonly disabled: boolean;
      /** What is wrong with the library, said on the row that leads to where it is settled. */
      readonly problem?: string | undefined;
    }
  | { readonly kind: "separator"; readonly key: string };

/**
 * How a search is searched, said after it: the encoding, and for text the case
 * rule either way — "ignore case" is a fact, not the absence of one. Hex has no
 * case, and says nothing about it.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.patternItem
 */
export function searchFlags(search: Pick<MenuSearch, "encoding" | "caseSensitive">): string {
  if (search.encoding === "hex") return encodingTitle(search.encoding);
  return `${encodingTitle(search.encoding)}, ${search.caseSensitive ? "match case" : "ignore case"}`;
}

/**
 * The rows, in upstream's order: Recent Queries, then Add to Favorites and Clear
 * Recents, then Favorites by name, then Manage Favorites….
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.rebuildPatternMenu
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.command
 */
export function patternMenuRows(options: {
  readonly recents: readonly MenuSearch[];
  readonly favorites: readonly MenuSearch[];
  /** What is in the field: with nothing there, there is nothing to keep. */
  readonly fieldText: string;
  /**
   * What is wrong with the library, if anything. A conflict only the Settings
   * dialog mentions is a silent state: the library has stopped syncing and
   * stopped being editable, and the bar is where the user actually is.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.manageItem
   */
  readonly problem?: string | undefined;
}): PatternMenuRow[] {
  const { recents, favorites, fieldText, problem } = options;
  const rows: PatternMenuRow[] = [];
  if (recents.length > 0) {
    rows.push({ kind: "heading", key: "recents", label: "Recent Queries", icon: "recent" });
    for (const [index, search] of recents.entries()) rows.push(entryRow(search, "recent", index));
    rows.push({ kind: "separator", key: "after-recents" });
  }
  // @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.validateMenuItem
  rows.push({
    kind: "command",
    key: "addToFavorites",
    label: "Add to Favorites",
    disabled: fieldText.trim().length === 0,
  });
  if (recents.length > 0) {
    rows.push({ kind: "command", key: "clearRecents", label: "Clear Recents", disabled: false });
  }
  if (favorites.length > 0) {
    rows.push({ kind: "separator", key: "before-favorites" });
    rows.push({ kind: "heading", key: "favorites", label: "Favorites", icon: "favorite" });
    for (const [index, search] of favorites.entries()) {
      rows.push(entryRow(search, "favorite", index));
    }
  }
  rows.push({ kind: "separator", key: "before-manage" });
  // @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.manageItem
  rows.push({
    kind: "command",
    key: "manageFavorites",
    label: "Manage Favorites…",
    disabled: false,
    problem,
  });
  return rows;
}

function entryRow(search: MenuSearch, list: "recent" | "favorite", index: number): PatternMenuRow {
  return {
    kind: "entry",
    key: `${list}-${index}`,
    list,
    index,
    name: search.name ?? "",
    pattern: search.pattern,
    flags: searchFlags(search),
    usable: parsePattern(search.pattern, search.encoding).ok,
  };
}

/**
 * Why a search cannot be kept under `name`, or `undefined` when it can.
 *
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.validate
 */
export function favoriteNameProblem(
  name: string,
  search: MenuSearch,
  alreadyKept: { readonly name: string } | undefined
): string | undefined {
  if (name.trim().length === 0) return "Enter a name — it is what the menu shows.";
  if (!parsePattern(search.pattern, search.encoding).ok) {
    return `That pattern cannot be read as ${encodingTitle(search.encoding)}.`;
  }
  if (alreadyKept !== undefined) return `Already a favourite, as "${alreadyKept.name}".`;
  return undefined;
}

/**
 * What is being kept, in the words the menu will use for it.
 *
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.describe
 */
export function keepingDescription(search: MenuSearch): string {
  return `Keeping "${search.pattern}" — ${searchFlags(search)}.`;
}
