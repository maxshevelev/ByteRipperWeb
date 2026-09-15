import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  isPanelVisible,
  menuState,
  paneClosed,
  panesSwapped,
  toolController,
} from "@/state/toolController";
import {
  closePane,
  openEmptyInPane,
  PANE_IDS,
  setActivePane,
  swapPanes,
} from "@/state/workspaceStore";

/**
 * The tool controller's session binding and its menu, ported from upstream's
 * `ToolSessionTests`, `ToolsMenuTests` and `ToolPanelTests`.
 *
 * Stand-in tool-modules take the registry's place, as upstream's
 * `installToolStubs` does, so no real tool is loaded.
 */

vi.mock("@/tools/registry", () => ({
  toolById: (id: string) =>
    id === STUB_A || id === STUB_B ? { id, title: id, summary: "", View: () => null } : undefined,
}));

const STUB_A = "dev.maxik.tool.stubA";
const STUB_B = "dev.maxik.tool.stubB";

const state = () => toolController.getSnapshot();

beforeEach(() => {
  activate(undefined);
  for (const pane of PANE_IDS) closePane(pane);
});

describe("the session", () => {
  // @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testActivatingStartsASessionOnTheActivePane
  it("starts on the active pane", () => {
    openEmptyInPane("a");

    activate(STUB_A);

    expect(state().activeIdentifier).toBe(STUB_A);
    expect(state().boundPane).toBe("a");
  });

  // @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testPickingAnotherModuleEndsTheFirst
  it("is replaced by picking another module", () => {
    openEmptyInPane("a");
    activate(STUB_A);

    activate(STUB_B);

    expect(state().activeIdentifier).toBe(STUB_B);
    expect(state().boundPane).toBe("a");
  });

  // @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testNoneEndsTheSession
  it("ends with None", () => {
    openEmptyInPane("a");
    activate(STUB_A);

    activate(undefined);

    expect(state().activeIdentifier).toBeUndefined();
    expect(state().boundPane).toBeUndefined();
  });

  // @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testClosingTheBoundFileEndsTheSession
  it("ends when the bound file closes, and the panel closes with it", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    activate(STUB_A);
    expect(state().boundPane).toBe("b");

    paneClosed("b");
    closePane("b");

    expect(state().activeIdentifier).toBeUndefined();
    expect(state().boundPane).toBeUndefined();
    expect(isPanelVisible(state())).toBe(false);
  });

  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneClosed
  it("survives the other file closing", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("a");
    activate(STUB_A);

    paneClosed("b");
    closePane("b");

    expect(state().activeIdentifier).toBe(STUB_A);
    expect(state().boundPane).toBe("a");
  });

  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.boundPane
  it("is not re-pointed by clicking the other pane", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("a");
    activate(STUB_A);

    setActivePane("b");
    activate(STUB_A);

    expect(state().boundPane).toBe("a");
  });

  it("follows its file when the panes swap", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("a");
    activate(STUB_A);

    panesSwapped();
    swapPanes();

    expect(state().boundPane).toBe("b");
  });
});

describe("the panel", () => {
  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testThePanelIsClosedUntilAModuleIsPicked
  it("is closed until a module is picked", () => {
    openEmptyInPane("a");

    expect(isPanelVisible(state())).toBe(false);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testNoneClosesThePanel
  it("closes with None", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    expect(isPanelVisible(state())).toBe(true);

    activate(undefined);

    expect(isPanelVisible(state())).toBe(false);
  });
});

describe("the Tools menu", () => {
  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testNoneIsCheckedUntilAModuleIsPicked
  it("checks None until a module is picked", () => {
    openEmptyInPane("a");

    expect(menuState(undefined, true).checked).toBe(true);
    expect(menuState(STUB_A, true).checked).toBe(false);
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testPickingAModuleChecksItAndUnchecksNone
  it("checks the module picked and unchecks None", () => {
    openEmptyInPane("a");

    activate(STUB_A);

    expect(state().activeIdentifier).toBe(STUB_A);
    expect(menuState(STUB_A, true).checked).toBe(true);
    expect(menuState(undefined, true).checked).toBe(false);
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testNonePutsTheChoiceBack
  it("puts the choice back with None", () => {
    openEmptyInPane("a");
    activate(STUB_A);

    activate(undefined);

    expect(state().activeIdentifier).toBeUndefined();
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testAModuleNeedsAFileOpen
  it("offers a module only with a file open", () => {
    expect(menuState(STUB_A, false).enabled).toBe(false);

    activate(STUB_A);

    expect(state().activeIdentifier).toBeUndefined();
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testNoneStaysAvailableWithNoFileOpen
  it("keeps None available with no file open", () => {
    expect(menuState(undefined, false).enabled).toBe(true);
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testAnIdentifierNothingAnswersToReadsAsNone
  it("reads an identifier nothing answers to as None", () => {
    openEmptyInPane("a");

    activate("dev.maxik.tool.removed");

    expect(state().activeIdentifier).toBeUndefined();
  });
});
