import { createStore } from "@/state/store";
import {
  EMPTY_QUERY,
  hasSubtypes,
  sameQuery,
  type UEFITreeQuery,
} from "@/tools/uefi/uefiTreeSearch";

/**
 * What the tree's search asks for, kept for the app rather than for a panel: the same
 * query in both panes, through a reparse and through a change of file, and through a
 * restart. A panel on screen reads the store and shows the new one when it moves.
 *
 * Stored as codes and text — no word of the interface, so a change of language leaves
 * the query as it was.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings
 * @upstream-differs a store the panels subscribe to, where upstream posts a notification;
 * `localStorage` for the panel defaults
 */
export interface UEFISearchState {
  readonly query: UEFITreeQuery;
  /** Whether the bar is open: the reader opens it from the tree's header, and it stays so. */
  readonly isOpen: boolean;
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.textKey */
export const SEARCH_KEY = "byteripper.uefiSearch";

/**
 * The state a stored string describes, or the empty one when it holds nothing of that
 * shape. A code is a number, and "none" is no number at all.
 */
export function parseSearchState(stored: string | null): UEFISearchState {
  const empty: UEFISearchState = { query: EMPTY_QUERY, isOpen: false };
  if (stored === null) return empty;
  try {
    const value = JSON.parse(stored) as {
      text?: unknown;
      type?: unknown;
      subtype?: unknown;
      isOpen?: unknown;
    };
    const code = (one: unknown): number | undefined =>
      typeof one === "number" && Number.isInteger(one) && one >= 0 && one <= 0xff ? one : undefined;
    const type = code(value.type);
    return {
      query: {
        text: typeof value.text === "string" ? value.text : "",
        type,
        subtype: hasSubtypes(type) ? code(value.subtype) : undefined,
      },
      isOpen: value.isOpen === true,
    };
  } catch {
    return empty;
  }
}

function stored(): UEFISearchState {
  try {
    return parseSearchState(localStorage.getItem(SEARCH_KEY));
  } catch {
    return { query: EMPTY_QUERY, isOpen: false };
  }
}

export const uefiSearchStore = createStore<UEFISearchState>(stored());

function remember(state: UEFISearchState): void {
  try {
    localStorage.setItem(
      SEARCH_KEY,
      JSON.stringify({
        text: state.query.text,
        type: state.query.type,
        subtype: state.query.subtype,
        isOpen: state.isOpen,
      })
    );
  } catch {
    // A private window keeps the query for the tab alone.
  }
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.query */
export function setSearchQuery(query: UEFITreeQuery): void {
  uefiSearchStore.update((current) => {
    if (sameQuery(current.query, query)) return current;
    const next = { ...current, query };
    remember(next);
    return next;
  });
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.isOpen */
export function setSearchOpen(isOpen: boolean): void {
  uefiSearchStore.update((current) => {
    if (current.isOpen === isOpen) return current;
    const next = { ...current, isOpen };
    remember(next);
    return next;
  });
}
