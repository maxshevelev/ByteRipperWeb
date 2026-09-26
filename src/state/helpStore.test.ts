/**
 * The help as the workspace holds it: the pill it lives in, the trail the two
 * arrows walk, and what a search leaves behind when the reader picks a result.
 *
 * The book itself is the content tests' business (`helpContent.test.ts`); what
 * is here is the state around it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TOPIC, termId, termLink, topicLink } from "@/core/help/helpIds";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  closeHelp,
  ensureHelpBook,
  goToHelp,
  helpBack,
  helpCanGoBack,
  helpCanGoForward,
  helpForward,
  helpHasPage,
  helpHere,
  helpStore,
  reloadHelpBook,
  setHelpQuery,
  showHelp,
} from "@/state/helpStore";
import { foldParts, toggleHelpPanel, workspaceStore } from "@/state/workspaceStore";

afterEach(() => {
  closeHelp();
  workspaceStore.update((state) => ({
    ...state,
    dock: EMPTY_DOCK,
    helpPanel: undefined,
  }));
});

const dock = () => workspaceStore.getSnapshot().dock;
const helpPanel = () => workspaceStore.getSnapshot().helpPanel;

describe("the pill the book lives in", () => {
  it("opens one panel, and raises that one when asked again", () => {
    showHelp();
    const first = helpPanel();
    expect(first).toBeDefined();
    expect(dock().panels).toHaveLength(1);
    expect(dock().expanded).toBe(first);

    // Folded, and asked for again: the pill there is rises rather than a
    // second book landing in the dock.
    foldParts();
    expect(dock().expanded).toBeUndefined();
    showHelp(topicLink(TOPIC.saving));
    expect(helpPanel()).toBe(first);
    expect(dock().panels).toHaveLength(1);
    expect(dock().expanded).toBe(first);
  });

  it("folds and rises on the pill's own click", () => {
    showHelp();
    toggleHelpPanel();
    expect(dock().expanded).toBeUndefined();
    toggleHelpPanel();
    expect(dock().expanded).toBe(helpPanel());
  });

  /** Closing puts the book away: the pill goes, and the reader's place with it. */
  it("forgets where the reader was when the book is closed", () => {
    showHelp(topicLink(TOPIC.benchSafety));
    setHelpQuery("checksum");
    closeHelp();
    expect(helpPanel()).toBeUndefined();
    expect(dock().panels).toHaveLength(0);
    const state = helpStore.getSnapshot();
    expect(helpHere(state)).toBeUndefined();
    expect(state.query).toBe("");
  });

  /**
   * The workspace's own panes are what a command means while the book is up:
   * it holds no document, so it cannot be what ⌘D or a save is addressed to.
   */
  it("leaves the commands with the workspace's own pane", () => {
    showHelp();
    expect(workspaceStore.getSnapshot().activePane).toBe("a");
  });
});

describe("where the reader is", () => {
  it("opens at the overview when nothing has been asked for", () => {
    showHelp();
    expect(helpHere(helpStore.getSnapshot())).toEqual(topicLink(TOPIC.overview));
  });

  it("opens where the reader left off when it is asked for again", () => {
    showHelp(topicLink(TOPIC.saving));
    foldParts();
    showHelp();
    expect(helpHere(helpStore.getSnapshot())).toEqual(topicLink(TOPIC.saving));
  });

  it("walks the trail with the two arrows", () => {
    showHelp(topicLink(TOPIC.overview));
    goToHelp(topicLink(TOPIC.saving));
    goToHelp(termLink(termId("fpt")));

    let state = helpStore.getSnapshot();
    expect(helpCanGoBack(state)).toBe(true);
    expect(helpCanGoForward(state)).toBe(false);

    helpBack();
    expect(helpHere(helpStore.getSnapshot())).toEqual(topicLink(TOPIC.saving));
    helpBack();
    state = helpStore.getSnapshot();
    expect(helpHere(state)).toEqual(topicLink(TOPIC.overview));
    expect(helpCanGoBack(state)).toBe(false);
    expect(helpCanGoForward(state)).toBe(true);

    helpForward();
    expect(helpHere(helpStore.getSnapshot())).toEqual(topicLink(TOPIC.saving));
  });

  /** Following a link from the middle of the trail drops what was ahead. */
  it("drops the way forward when the reader takes another turning", () => {
    showHelp(topicLink(TOPIC.overview));
    goToHelp(topicLink(TOPIC.saving));
    helpBack();
    goToHelp(topicLink(TOPIC.editing));
    const state = helpStore.getSnapshot();
    expect(helpCanGoForward(state)).toBe(false);
    expect(state.trail).toEqual([topicLink(TOPIC.overview), topicLink(TOPIC.editing)]);
  });

  it("does not stack the page the reader is already on", () => {
    showHelp(topicLink(TOPIC.saving));
    goToHelp(topicLink(TOPIC.saving));
    expect(helpStore.getSnapshot().trail).toHaveLength(1);
  });

  /**
   * A list of results is a way of getting to a page, not a place to stand.
   */
  it("empties the search field when a result is picked", () => {
    showHelp();
    setHelpQuery("checksum");
    goToHelp(topicLink(TOPIC.recipeChecksums));
    expect(helpStore.getSnapshot().query).toBe("");
  });
});

describe("the book itself", () => {
  it("arrives once and is kept", async () => {
    const first = await ensureHelpBook();
    const again = await ensureHelpBook();
    expect(again).toBe(first);
    expect(helpStore.getSnapshot().loading).toBe(false);
  });

  it("is read once for two asks in the same gesture", async () => {
    reloadHelpBook();
    const [one, two] = await Promise.all([ensureHelpBook(), ensureHelpBook()]);
    expect(one).toBe(two);
  });

  /**
   * A `?` that opens an empty page is worse than no `?`, so a panel asks before
   * it draws one.
   */
  it("says whether a link has anywhere to go", async () => {
    await ensureHelpBook();
    expect(helpHasPage(topicLink(TOPIC.toolME))).toBe(true);
    expect(helpHasPage(termLink(termId("fpt")))).toBe(true);
    expect(helpHasPage(termLink(termId("no-such-word")))).toBe(false);
  });
});
