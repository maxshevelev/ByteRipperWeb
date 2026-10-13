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
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.didChange
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.isOpenKey
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.typeKey
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.subtypeKey
 * @upstream-differs a store the panels subscribe to, where upstream posts a notification;
 * `localStorage` for the panel defaults
 */
/**
 * What the bar looks for: a node by what it is called, or a pattern in what the nodes hold.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.Mode
 */
export type UEFISearchMode = "names" | "contents";

/**
 * What the Contents search asks for: the text in its field, and whether in the whole tree or in
 * the node selected when it starts.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.Content
 */
export interface UEFIContentQuery {
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.Content.text */
  readonly text: string;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.Content.wholeTree */
  readonly wholeTree: boolean;
}

export interface UEFISearchState {
  readonly query: UEFITreeQuery;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.mode */
  readonly mode: UEFISearchMode;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.content */
  readonly content: UEFIContentQuery;
  /** Whether the bar is open: the reader opens it from the tree's header, and it stays so. */
  readonly isOpen: boolean;
  /** Moves on each time the field is asked to take the keyboard (Edit ▸ Find in the tree). */
  readonly focusToken: number;
}

const EMPTY_CONTENT: UEFIContentQuery = { text: "", wholeTree: true };

/**
 * One stored record for the whole bar, where upstream keeps a key apiece.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.textKey
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.modeKey
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.contentTextKey
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.contentFromSelectionKey
 */
export const SEARCH_KEY = "byteripper.uefiSearch";

/**
 * The state a stored string describes, or the empty one when it holds nothing of that
 * shape. A code is a number, and "none" is no number at all.
 */
export function parseSearchState(stored: string | null): UEFISearchState {
  const empty: UEFISearchState = {
    query: EMPTY_QUERY,
    mode: "names",
    content: EMPTY_CONTENT,
    isOpen: false,
    focusToken: 0,
  };
  if (stored === null) return empty;
  try {
    const value = JSON.parse(stored) as {
      text?: unknown;
      type?: unknown;
      subtype?: unknown;
      isOpen?: unknown;
      mode?: unknown;
      contentText?: unknown;
      contentFromSelection?: unknown;
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
      mode: value.mode === "contents" ? "contents" : "names",
      // Stored as "from the selection", so a bench that never touched the box searches the whole
      // tree.
      content: {
        text: typeof value.contentText === "string" ? value.contentText : "",
        wholeTree: value.contentFromSelection !== true,
      },
      isOpen: value.isOpen === true,
      focusToken: 0,
    };
  } catch {
    return empty;
  }
}

function stored(): UEFISearchState {
  try {
    return parseSearchState(localStorage.getItem(SEARCH_KEY));
  } catch {
    return parseSearchState(null);
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
        mode: state.mode,
        contentText: state.content.text,
        contentFromSelection: !state.content.wholeTree,
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

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.mode */
export function setSearchMode(mode: UEFISearchMode): void {
  uefiSearchStore.update((current) => {
    if (current.mode === mode) return current;
    const next = { ...current, mode };
    remember(next);
    return next;
  });
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.content */
export function setContentQuery(content: UEFIContentQuery): void {
  uefiSearchStore.update((current) => {
    if (current.content.text === content.text && current.content.wholeTree === content.wholeTree) {
      return current;
    }
    const next = { ...current, content };
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

/**
 * Edit ▸ Find with the keyboard in the tree or its details: the tree's search, not the
 * dump's. The bar opens and the cursor goes to the field.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.findPattern
 */
export function openTreeSearch(): void {
  uefiSearchStore.update((current) => {
    const next = { ...current, isOpen: true, focusToken: current.focusToken + 1 };
    remember(next);
    return next;
  });
}

/**
 * Whether the keyboard is in the tree's panel, where ⌘F is the tree's search.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.findPattern
 */
export const keyboardIsInTreePanel = (element: Element | null): boolean =>
  element?.closest("[data-uefi-search-scope]") != null;
