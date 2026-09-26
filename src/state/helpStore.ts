/**
 * The help book as the workspace holds it: which page is showing, how the
 * reader got there, and the panel it is all shown in.
 *
 * The book itself is loaded once per language and kept — a few dozen small
 * files, parsed well under the time the panel takes to open, so there is no
 * lazier arrangement worth its complexity. It is loaded on the first ask
 * rather than at startup, because a bench that never opens the help should
 * never download it.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/Help.swift#Help
 * @upstream ByteRipperApp/App/HelpPresenter.swift#HelpPresenter
 * @upstream-differs upstream's `Help.shared` loads the book synchronously on
 * first use and its window controller keeps the reader's place; a browser has
 * neither a synchronous read nor a second window, so the book arrives over a
 * promise into this store and the place is kept here beside it
 */

import { BUNDLED_HELP_LANGUAGES, bundledHelpContent } from "@/core/help/bundledHelp";
import type { HelpBook } from "@/core/help/helpBook";
import { helpDestinationExists } from "@/core/help/helpBook";
import { type HelpLink, sameLink, TOPIC, topicLink } from "@/core/help/helpIds";
import { HELP_FALLBACK_LANGUAGE, loadHelpBook } from "@/core/help/helpLoader";
import { currentLanguage } from "@/core/localization/localization";
import { createStore } from "@/state/store";
import { closeHelpPanel, openHelpPanel } from "@/state/workspaceStore";

export interface HelpState {
  /** The book, once it has arrived. */
  readonly book: HelpBook | undefined;
  /** The language the book that is here was loaded for. */
  readonly language: string;
  /** True while a load is in flight, so the panel can say it is coming. */
  readonly loading: boolean;
  /**
   * Where the reader has been, oldest first. Every link opened is pushed here,
   * and the two arrows walk it — a book whose pages link to one another is one
   * a reader arrives in the middle of.
   */
  readonly trail: readonly HelpLink[];
  /** Where in `trail` the reader is standing. -1 while the trail is empty. */
  readonly at: number;
  /** What is typed in the panel's search field. */
  readonly query: string;
  /** Whether the contents column is held open over a narrow panel. */
  readonly contentsOpen: boolean;
}

export const helpStore = createStore<HelpState>({
  book: undefined,
  language: HELP_FALLBACK_LANGUAGE,
  loading: false,
  trail: [],
  at: -1,
  query: "",
  contentsOpen: false,
});

/** Where the reader is, or nothing when the panel has just opened. */
export const helpHere = (state: HelpState): HelpLink | undefined => state.trail[state.at];

/** @upstream ByteRipperApp/App/HelpWindowController.swift#HelpWindowController.canGoBack */
export const helpCanGoBack = (state: HelpState): boolean => state.at > 0;
/** @upstream ByteRipperApp/App/HelpWindowController.swift#HelpWindowController.canGoForward */
export const helpCanGoForward = (state: HelpState): boolean => state.at < state.trail.length - 1;

/** The load in flight, so two asks in one gesture do not read the book twice. */
let loading: Promise<HelpBook> | undefined;

/**
 * The book for the language the app is speaking, loading it if this is the
 * first ask or if the language has changed under it.
 *
 * A language the book has nothing of falls back to English, file by file, in
 * the loader — so what is asked for here is simply what the app speaks.
 */
export async function ensureHelpBook(): Promise<HelpBook> {
  const wanted = currentLanguage();
  const held = helpStore.getSnapshot();
  if (held.book !== undefined && held.language === wanted) return held.book;
  if (loading !== undefined) return loading;

  helpStore.update((state) => ({ ...state, loading: true }));
  loading = (async () => {
    const language = BUNDLED_HELP_LANGUAGES.includes(wanted) ? wanted : HELP_FALLBACK_LANGUAGE;
    const book = await loadHelpBook(language, bundledHelpContent);
    helpStore.update((state) => ({ ...state, book, language: wanted, loading: false }));
    return book;
  })();
  try {
    return await loading;
  } finally {
    loading = undefined;
  }
}

/**
 * Drops the book, so the next reader gets one in the language now in force.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/Help.swift#Help.reload
 */
export function reloadHelpBook(): void {
  helpStore.update((state) => ({ ...state, book: undefined }));
  if (helpStore.getSnapshot().trail.length > 0) void ensureHelpBook();
}

/**
 * Opens the help at `link`, raising the pill there is or making one.
 *
 * Every `?` in the app comes through here. With no link it opens where the
 * reader left off, and on the first ask at the overview — which is the page
 * that answers "what is this for", the question somebody opening the help
 * cold is asking.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showHelpBook
 * @upstream ByteRipperApp/App/HelpPresenter.swift#HelpPresenter.show
 */
export function showHelp(link?: HelpLink): void {
  openHelpPanel();
  void ensureHelpBook();
  const state = helpStore.getSnapshot();
  const wanted = link ?? helpHere(state) ?? topicLink(TOPIC.overview);
  goToHelp(wanted);
}

/**
 * Shows `link`, pushing it onto the trail. Following a link from the middle of
 * the trail drops what was ahead, as every history does.
 *
 * **The search field empties.** A list of results is a way of getting to a
 * page, not a place to stand: leaving it up over the page the reader just
 * picked would answer their click with the same list again. Where they were is
 * still one ‹ away, and the field is free for the next question.
 */
export function goToHelp(link: HelpLink): void {
  helpStore.update((state) => {
    const here = helpHere(state);
    if (here !== undefined && sameLink(here, link)) {
      return state.query === "" ? state : { ...state, query: "" };
    }
    const kept = state.trail.slice(0, state.at + 1);
    return {
      ...state,
      trail: [...kept, link],
      at: kept.length,
      query: "",
      contentsOpen: false,
    };
  });
}

/** @upstream ByteRipperApp/App/HelpWindowController.swift#HelpWindowController.goBack */
export function helpBack(): void {
  helpStore.update((state) =>
    helpCanGoBack(state) ? { ...state, at: state.at - 1, contentsOpen: false } : state
  );
}

/** @upstream ByteRipperApp/App/HelpWindowController.swift#HelpWindowController.goForward */
export function helpForward(): void {
  helpStore.update((state) =>
    helpCanGoForward(state) ? { ...state, at: state.at + 1, contentsOpen: false } : state
  );
}

/** What the reader typed in the panel's search field. */
export function setHelpQuery(query: string): void {
  helpStore.update((state) => ({ ...state, query }));
}

/** The contents column, over a panel too narrow to hold it beside the page. */
export function toggleHelpContents(): void {
  helpStore.update((state) => ({ ...state, contentsOpen: !state.contentsOpen }));
}

/**
 * Closes the book: the pill goes, and the reader's place with it. Where they
 * were is worth keeping while the panel is folded, and not worth keeping after
 * they have put the book away.
 */
export function closeHelp(): void {
  closeHelpPanel();
  helpStore.update((state) => ({ ...state, trail: [], at: -1, query: "", contentsOpen: false }));
}

/**
 * Whether a `?` has anywhere to send the reader.
 *
 * A button that opens an empty page is worse than no button, so a panel asks
 * before it draws one — and the answer is only known once the book is here,
 * which is why a term the book has not got yet draws nothing and the button
 * appears when it arrives.
 *
 * @upstream Packages/HelpBook/Sources/HelpBook/HelpBook.swift#HelpBook.destinationExists
 */
export function helpHasPage(link: HelpLink): boolean {
  const book = helpStore.getSnapshot().book;
  return book !== undefined && helpDestinationExists(book, link);
}
