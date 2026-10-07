import { helpHash, helpLinkOfHash } from "@/core/help/helpAddress";
import { appEdition } from "@/platform/edition";
import { helpHere, helpStore, showHelp } from "@/state/helpStore";
import { workspaceStore } from "@/state/workspaceStore";

/**
 * The page's address follows the help (G65): while a help page is up, the URL
 * names it — `#help/opening-files` — so the address bar is a link to it, and a
 * link like that opens the app on that page.
 *
 * The address is *replaced*, never pushed. A reader's Back button stays what it
 * was — it leaves the app — and the help's own ‹ and › stay the way through the
 * pages read. The hash goes when the help is folded or closed, and only a hash
 * of the help's own: anything else in the address is somebody else's.
 *
 * Only in a browser: the desktop shell has no address bar and no URL a
 * colleague could open.
 *
 * @web-only a Mac app has no address to give a page
 */

/** Whether this page has an address worth handing on: a browser, over http(s). */
export function canShareHelpLink(): boolean {
  return (
    appEdition() === "browser" &&
    typeof location !== "undefined" &&
    (location.protocol === "https:" || location.protocol === "http:")
  );
}

/** The address of the help page that is up, whole — what Copy Link puts on the clipboard. */
export function helpPageAddress(): string | undefined {
  const here = helpHere(helpStore.getSnapshot());
  if (here === undefined || typeof location === "undefined") return undefined;
  return `${location.origin}${location.pathname}${location.search}${helpHash(here)}`;
}

/** The hash the address should carry now: the page that is up, or none. */
function wantedHash(): string {
  const workspace = workspaceStore.getSnapshot();
  const helpUp =
    workspace.helpPanel !== undefined && workspace.dock.expanded === workspace.helpPanel;
  const here = helpHere(helpStore.getSnapshot());
  return helpUp && here !== undefined ? helpHash(here) : "";
}

/** Brings the address in line with the help, replacing rather than adding to the history. */
function follow(): void {
  const wanted = wantedHash();
  if (location.hash === wanted) return;
  if (wanted !== "") {
    history.replaceState(history.state, "", wanted);
  } else if (helpLinkOfHash(location.hash) !== undefined) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
}

/** Opens the help on the page a hash names, if it names one. */
function open(hash: string): void {
  const link = helpLinkOfHash(hash);
  if (link !== undefined) showHelp(link);
}

/**
 * Starts following: opens the page the address names, if it names one, and from
 * then on keeps the address and the help in step. Answers how to stop.
 */
export function startHelpAddress(): () => void {
  if (appEdition() !== "browser" || typeof window === "undefined") return () => undefined;
  open(location.hash);
  const onHashChange = () => open(location.hash);
  window.addEventListener("hashchange", onHashChange);
  const stopHelp = helpStore.subscribe(follow);
  const stopWorkspace = workspaceStore.subscribe(follow);
  follow();
  return () => {
    window.removeEventListener("hashchange", onHashChange);
    stopHelp();
    stopWorkspace();
  };
}
