import {
  CPUID_SEARCH_HISTORY_LIMIT,
  cpuidLookupFor,
  rememberingCpuidSearch,
} from "@/firmware/intelCpuid/cpuidLookup";
import { desktopOwnWindows, ownWindowKind } from "@/platform/desktop/desktopWindows";
import { processorTablesStore, refreshProcessorTables } from "@/state/processorTablesStore";
import { createStore } from "@/state/store";
import { openCpuidLookupPanel } from "@/state/workspaceStore";

/**
 * Window ▸ Intel CPUID Lookup, as the page holds it: what is typed, how the table is sorted, the
 * last ten searches, and whether the tables are being asked for.
 *
 * The tables themselves are the one store every reader reads (`processorTablesStore`): the lookup
 * builds its search over what is installed (`cpuidLookupFor`) and never fetches a copy of its own.
 * The query is kept here rather than in the panel, so a panel folded into its pill and raised
 * again comes back to the search it showed, as upstream's window does when it is opened again.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController
 * @upstream-differs a store beside the component, which the panel and the shell's own window read
 */

/** A column of the lookup's table. */
export type CpuidLookupColumn = "cpuid" | "model" | "sSpec" | "stepping" | "codeName";

/** How the table is sorted: by one column, either way, or as the table lists it. */
export interface CpuidLookupSort {
  readonly column: CpuidLookupColumn;
  readonly ascending: boolean;
}

export interface CpuidLookupState {
  /**
   * What is in the search field.
   *
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.query
   */
  readonly query: string;
  /**
   * The last searches, newest first.
   *
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.history
   */
  readonly history: readonly string[];
  /** The column the table is sorted by, if any. */
  readonly sort: CpuidLookupSort | undefined;
  /**
   * Whether a refresh is under way: an empty table then reads "Loading…".
   *
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.refreshing
   */
  readonly refreshing: boolean;
  /** Counts the asks to put the keyboard in the search field; the panel answers each one. */
  readonly focusAsk: number;
}

/**
 * Where the last searches are kept between visits — beside the Find bar's, in the page's storage.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.historyKey
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.defaults
 * @upstream-differs `localStorage`, as the Find bar's recent searches are kept (`searchStore`)
 */
export const CPUID_HISTORY_STORAGE_KEY = "byteripper.cpuidLookup.recentSearches";

/**
 * How long a query stands untouched before it counts as a search.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.rememberDelay
 */
export const CPUID_REMEMBER_DELAY_MS = 2000;

/** The kept searches, with anything unreadable left out. */
export function parseCpuidHistory(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((one): one is string => typeof one === "string" && one.trim().length > 0)
    .slice(0, CPUID_SEARCH_HISTORY_LIMIT);
}

function storedHistory(): string[] {
  try {
    return parseCpuidHistory(localStorage.getItem(CPUID_HISTORY_STORAGE_KEY));
  } catch {
    // A private window may refuse to read it; the page starts with none.
    return [];
  }
}

function storeHistory(history: readonly string[]): void {
  try {
    if (history.length === 0) localStorage.removeItem(CPUID_HISTORY_STORAGE_KEY);
    else localStorage.setItem(CPUID_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Not storable here; the history still holds for this page.
  }
}

export const cpuidLookupStore = createStore<CpuidLookupState>({
  query: "",
  history: storedHistory(),
  sort: undefined,
  refreshing: false,
  focusAsk: 0,
});

let rememberTimer: ReturnType<typeof setTimeout> | undefined;

function cancelRemembering(): void {
  if (rememberTimer !== undefined) clearTimeout(rememberTimer);
  rememberTimer = undefined;
}

/**
 * What was typed: searched at once, and remembered once it has stood for two seconds.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.searchChanged
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.rememberSoon
 */
export function editCpuidQuery(query: string): void {
  cpuidLookupStore.update((state) => (state.query === query ? state : { ...state, query }));
  cancelRemembering();
  rememberTimer = setTimeout(rememberCpuidQuery, CPUID_REMEMBER_DELAY_MS);
}

/**
 * Puts `text` in the field and searches it, as a search of its own.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.setQuery
 */
export function setCpuidQuery(text: string): void {
  cpuidLookupStore.update((state) => (state.query === text ? state : { ...state, query: text }));
  rememberCpuidQuery();
}

/**
 * The query, as a search worth offering again — if it found anything.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.rememberQuery
 */
export function rememberCpuidQuery(): void {
  cancelRemembering();
  const { query, history } = cpuidLookupStore.getSnapshot();
  const lookup = cpuidLookupFor(processorTablesStore.getSnapshot());
  if (lookup.rowsMatching(query).length === 0 && lookup.headings(query).length === 0) return;
  const next = rememberingCpuidSearch(query, history);
  if (next.join("\n") === history.join("\n")) return;
  storeHistory(next);
  cpuidLookupStore.update((state) => ({ ...state, history: next }));
}

/**
 * Clear Recents: forgets the last searches.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.clearHistory
 */
export function clearCpuidHistory(): void {
  storeHistory([]);
  cpuidLookupStore.update((state) =>
    state.history.length === 0 ? state : { ...state, history: [] }
  );
}

/**
 * A column title clicked: sorted by it, ascending — or, when it already is, the other way.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.tableView
 */
export function sortCpuidLookup(column: CpuidLookupColumn): void {
  cpuidLookupStore.update((state) => ({
    ...state,
    sort: {
      column,
      ascending: state.sort?.column === column ? !state.sort.ascending : true,
    },
  }));
}

/**
 * Asks the repository to check for a newer table; what it installs reaches the lookup through the
 * one store.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.refreshTables
 */
export async function refreshCpuidLookupTables(): Promise<void> {
  cpuidLookupStore.update((state) => ({ ...state, refreshing: true }));
  try {
    await refreshProcessorTables();
  } finally {
    cpuidLookupStore.update((state) => ({ ...state, refreshing: false }));
  }
}

/** Puts the keyboard in the lookup's search field. */
export function focusCpuidSearch(): void {
  cpuidLookupStore.update((state) => ({ ...state, focusAsk: state.focusAsk + 1 }));
}

/**
 * Window ▸ Intel CPUID Lookup: the panel in the dock, raised when it is there — or, in the desktop
 * shell, the lookup's own window, one for the app (`Design/DESKTOP_WINDOWS.md`, D7). Either way
 * the search field is ready for typing and the repository is asked whether the table changed.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showCPUIDLookupWindow
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.cpuidLookupWindowController
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupWindowController.swift#CPUIDLookupWindowController.present
 * @upstream-differs a panel of the dock in a browser; the shell's window is made by its main
 * process, one per kind
 */
export function showCpuidLookup(): void {
  const own = desktopOwnWindows();
  if (own !== undefined && ownWindowKind() !== "cpuid") {
    own.open("cpuid", {});
    return;
  }
  if (ownWindowKind() !== "cpuid") openCpuidLookupPanel();
  focusCpuidSearch();
  void refreshCpuidLookupTables();
}

/**
 * The lookup's own window in the desktop shell: shows itself as its launch asked, and again
 * whenever another window asks for it.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupWindowController.swift#CPUIDLookupWindowController.present
 * @upstream-differs the ask arrives from another window's page through the shell
 */
export function startCpuidLookupWindow(): () => void {
  showCpuidLookup();
  return desktopOwnWindows()?.onShow(() => showCpuidLookup()) ?? (() => undefined);
}

/**
 * The lookup's searches as another window — or another tab — leaves them: the history is the
 * app's, as the Find bar's is.
 *
 * @web-only upstream's windows share one `UserDefaults`; here each window is a page, and the
 * browser's `storage` event says what another page wrote
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== CPUID_HISTORY_STORAGE_KEY && event.key !== null) return;
    const history = parseCpuidHistory(event.key === null ? null : event.newValue);
    cpuidLookupStore.update((state) =>
      state.history.join("\n") === history.join("\n") ? state : { ...state, history }
    );
  });
}
