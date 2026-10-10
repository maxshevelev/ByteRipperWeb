import { afterEach, describe, expect, it } from "vitest";
import {
  closeLargeDetail,
  largeDetailStore,
  ownsLargeDetail,
  showLargeDetail,
  toggleLargeDetail,
} from "@/state/largeDetailStore";

/**
 * Ported from `ToolDetailPaneTests`: the large view a row's detail opens into — the
 * state of it, which Space, the corner button, Esc and a click outside move. The
 * card and the pane it folds are components, which the web has no level for here.
 */

const isOpen = () => largeDetailStore.getSnapshot().open;

describe("the large view of a panel's details", () => {
  afterEach(closeLargeDetail);

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testNothingToShowIsNotTaken
  it("is not opened with nothing to show, and the key is not taken", () => {
    expect(toggleLargeDetail(false)).toBe(false);
    expect(showLargeDetail(false)).toBe(false);
    expect(isOpen()).toBe(false);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testTheCornerButtonOpensAndCloses
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testSpaceOnTheTableOpens
  it("is opened and closed by the same key", () => {
    expect(toggleLargeDetail(true)).toBe(true);
    expect(isOpen()).toBe(true);
    // Shut again, whether or not there is anything left to show.
    expect(toggleLargeDetail(false)).toBe(true);
    expect(isOpen()).toBe(false);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testSpaceAndEscClose
  it("is closed by closing, and closing a shut one does nothing", () => {
    showLargeDetail(true);
    closeLargeDetail();
    expect(isOpen()).toBe(false);
    const before = largeDetailStore.getSnapshot();
    closeLargeDetail();
    expect(largeDetailStore.getSnapshot()).toBe(before);
  });

  // @web-only every details pane on the page reads the one store: the card is the panel's whose
  // table opened it, and a pane beside it — the Agent window's Log kept hidden under its Tools
  // page, the other file's tool panel — neither draws a card nor folds for it
  it("is the panel's whose table opened it, and no other's", () => {
    const window_ = element();
    const tools = element(window_);
    const toolsTable = element(tools, true);
    const toolsDetails = element(tools);
    const log = element(window_);
    element(log, true);
    const logDetails = element(log);

    showLargeDetail(true, dom(toolsTable));
    expect(ownsLargeDetail(dom(toolsDetails))).toBe(true);
    expect(ownsLargeDetail(dom(logDetails))).toBe(false);
    // Still the Tools page's while it folds away.
    closeLargeDetail();
    expect(ownsLargeDetail(dom(toolsDetails))).toBe(true);
    expect(ownsLargeDetail(dom(logDetails))).toBe(false);
  });

  it("is every panel's when opened without a table", () => {
    showLargeDetail(true);
    expect(ownsLargeDetail(dom(element()))).toBe(true);
  });
});

/**
 * Just enough of an element for `keyTableNear`: a parent, children, `querySelector` for the key
 * table, and `contains`. The suite runs without a DOM.
 */
interface FakeElement {
  readonly parentElement: FakeElement | null;
  readonly children: FakeElement[];
  readonly isKeyTable: boolean;
  querySelector(selector: string): FakeElement | null;
  contains(other: FakeElement): boolean;
}

function element(parent: FakeElement | null = null, isKeyTable = false): FakeElement {
  const descendants = (one: FakeElement): FakeElement[] =>
    one.children.flatMap((child) => [child, ...descendants(child)]);
  const made: FakeElement = {
    parentElement: parent,
    children: [],
    isKeyTable,
    querySelector: (selector) =>
      selector === "[data-key-table]"
        ? (descendants(made).find((one) => one.isKeyTable) ?? null)
        : null,
    contains: (other) => other === made || descendants(made).includes(other),
  };
  parent?.children.push(made);
  return made;
}

const dom = (one: FakeElement): HTMLElement => one as unknown as HTMLElement;
