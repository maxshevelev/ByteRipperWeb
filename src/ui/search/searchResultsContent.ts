import { L } from "@/core/localization/localization";
import type { MatchSet } from "@/core/search/matchSet";
import type { SearchStatus } from "@/state/searchStore";

/**
 * What the results panel is showing, derived from the pane's search on every
 * read — never a copy of it.
 *
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.Content
 */
export type SearchResultsContent =
  /** The pane's matches, as rows. */
  | { readonly kind: "matches"; readonly total: number }
  /**
   * Too many to list: the count and the reason instead of rows. A list of four
   * thousand rows looks exactly like a list of forty until you scroll to the
   * end, so it would impersonate a tool.
   */
  | { readonly kind: "tooMany"; readonly total: number }
  /**
   * The scan is still running and has found nothing so far. Distinct from
   * `empty`: "no matches" is a verdict, and a search that has read a tenth of
   * the file has not reached one.
   */
  | { readonly kind: "searching" }
  /** Nothing to list: the search being shown found nothing. */
  | { readonly kind: "empty" };

/**
 * What a set reads as: rows, a count and a refusal, or nothing at all.
 *
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.content
 * @upstream-differs a search that has found its first match but whose index has not arrived yet has no set here, and reads as still searching
 */
export function searchResultsContent(
  matches: MatchSet | undefined,
  status: SearchStatus
): SearchResultsContent {
  if (matches === undefined) {
    return status === "searching" || status === "found" ? { kind: "searching" } : { kind: "empty" };
  }
  if (matches.total === 0) return matches.isComplete ? { kind: "empty" } : { kind: "searching" };
  if (!matches.isListable || !matches.isHighlightable) {
    return { kind: "tooMany", total: matches.total };
  }
  return { kind: "matches", total: matches.total };
}

/**
 * A count in the reader's region format — the same shape the find bar's count
 * uses.
 *
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.grouped
 */
const grouped = (value: number) => value.toLocaleString();

/**
 * The panel's title. While the index is still filling the count is "so far",
 * and the title says so rather than presenting a number that will grow.
 *
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.updateHeader
 */
export function searchResultsTitle(
  content: SearchResultsContent,
  matches: MatchSet | undefined
): string {
  switch (content.kind) {
    case "matches":
    case "tooMany": {
      const searching = matches !== undefined && !matches.isComplete;
      return searching
        ? L("Search results (%1$@, searching…)", grouped(content.total))
        : L("Search results (%1$@)", grouped(content.total));
    }
    case "searching":
      return L("Search results (searching…)");
    case "empty":
      return L("Search results (0)");
  }
}

/**
 * What stands where the rows would be, when there are none to show.
 *
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.applyContent
 */
export function searchResultsMessage(content: SearchResultsContent): string | undefined {
  switch (content.kind) {
    case "matches":
      return undefined;
    case "tooMany":
      return L("%1$@ matches — too many to list. Refine the pattern.", grouped(content.total));
    case "searching":
      return L("Searching…");
    case "empty":
      // A search that replaced the rows with nothing says so where the rows
      // were. An empty table would read as a panel that failed to load rather
      // than as a pattern that occurs nowhere.
      return L("No matches.");
  }
}
