import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  isPanelVisible,
  menuState,
  paneChoices,
  paneClosed,
  paneDropTitle,
  panelTakesDrops,
  panesSwapped,
  selectorEnabled,
  selectPane,
  sessionOn,
  toolController,
} from "@/state/toolController";
import {
  closePane,
  closePart,
  foldParts,
  openEmptyInPane,
  openPart,
  PANE_IDS,
  partPane,
  raisePart,
  setActivePane,
  swapPanes,
  workspaceStore,
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

const state = () => sessionOn(toolController.getSnapshot(), "panes");

/** The header's selector, as the panel reads it. */
const choices = () => paneChoices(workspaceStore.getSnapshot().panes);
/** The names the entries carry, in pane order. */
const names = () => choices().map((choice) => choice.fileName);
/** The entry the selector draws while it is shut — nil when nothing is bound. */
const ticked = () => {
  const index = choices().findIndex((choice) => choice.isBound);
  return index === -1 ? undefined : index;
};

beforeEach(() => {
  activate(undefined);
  for (const pane of PANE_IDS) closePane(pane);
  for (const part of workspaceStore.getSnapshot().dock.panels) closePart(partPane(part));
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

describe("the header's selector", () => {
  /** Two files open with the session started on the first pane — where the user was. */
  function twoFilesAndATool(): void {
    openEmptyInPane("a", "works.bin");
    openEmptyInPane("b", "fails.bin");
    setActivePane("a");
    activate(STUB_A);
  }

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testTheSelectorOffersBothPanesAndTicksTheBoundOne
  it("offers both panes, in pane order, and ticks the bound one", () => {
    twoFilesAndATool();

    expect(names()).toEqual(["works.bin", "fails.bin"]);
    expect(ticked()).toBe(0);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testTheEntriesNameTheirOwnPanesAndTheHeaderNamesTheTickedOne
  it("names each pane's own file, and ticks the one the tool reads", () => {
    twoFilesAndATool();
    setActivePane("b");

    // The entry under the pointer is somewhere to send the tool, so it has to
    // say where that is — pane order, one name each.
    expect(names()).toEqual(["works.bin", "fails.bin"]);

    // And the ticked entry — the one the header draws while the menu is shut —
    // is the pane the tool is reading, not the pane the user is in.
    expect(ticked()).toBe(0);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testTheHeaderKeepsNamingTheBoundFileWhenTheOtherPaneIsActivated
  it("goes on naming the bound file when the other pane is activated", () => {
    twoFilesAndATool();

    setActivePane("b");

    expect(workspaceStore.getSnapshot().activePane).toBe("b");
    expect(state().boundPane).toBe("a");
    expect(names()[ticked() ?? 0]).toBe("works.bin");
    expect(names()).toEqual(["works.bin", "fails.bin"]);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testChoosingTheOtherPaneMovesTheSessionToIt
  it("moves the session to the pane chosen, and leaves the user where they were", () => {
    twoFilesAndATool();

    selectPane("b");

    expect(state().boundPane).toBe("b");
    expect(ticked()).toBe(1);
    expect(names()[1]).toBe("fails.bin");
    expect(workspaceStore.getSnapshot().activePane).toBe("a");
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testSwappingThePanesMovesTheTickWithTheSession
  it("moves the tick with the session when the panes swap", () => {
    twoFilesAndATool();

    panesSwapped();
    swapPanes();

    expect(state().boundPane).toBe("b");
    expect(ticked()).toBe(1);
    // The list is in pane order, so without the tick moving too it would sit on
    // the file the tool is *not* reading — the one thing the header exists to say.
    expect(names()[1]).toBe("works.bin");
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testTheSelectorIsDisabledWithOneFileOpen
  it("is disabled with one file open", () => {
    openEmptyInPane("a");
    activate(STUB_A);

    expect(selectorEnabled(choices())).toBe(false);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testTheSelectorIsEnabledWithTwoFilesOpen
  it("is enabled with two files open", () => {
    twoFilesAndATool();

    expect(selectorEnabled(choices())).toBe(true);
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testAClosedPaneKeepsADisabledEntry
  it("keeps a disabled entry for a closed pane", () => {
    twoFilesAndATool();

    closePane("b");

    expect(choices().length).toBe(2);
    expect(choices()[1]?.isEnabled).toBe(false);
    expect(choices()[1]?.fileName).toBe("No file");
  });

  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.rebind
  it("will not move the session to a closed pane", () => {
    twoFilesAndATool();
    closePane("b");

    selectPane("b");

    expect(state().boundPane).toBe("a");
  });

  // @upstream ByteRipperTests/ToolPanelTests.swift#ToolPanelTests.testNoneLeavesNoPaneTicked
  it("leaves no pane ticked with None", () => {
    twoFilesAndATool();

    activate(undefined);

    expect(ticked()).toBeUndefined();
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

/**
 * A part opened over the files is a surface of its own, and so is its tool
 * panel: the Tools menu means whatever is in front, and a panel folded away
 * keeps the tool it was reading with.
 *
 * @upstream ByteRipperTests/FragmentToolTests.swift#FragmentToolTests.testTheToolsMenuOpensTheToolOnThePanelInFront
 * @upstream ByteRipperTests/FragmentToolTests.swift#FragmentToolTests.testFoldingThePanelGivesTheCommandBackToTheTab
 */
describe("a panel's own session", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
  const on = (surface: string) => sessionOn(toolController.getSnapshot(), surface as never);

  it("is where the Tools menu opens a tool while the panel is up", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");

    activate(STUB_A);

    expect(on(part).activeIdentifier).toBe(STUB_A);
    // And it reads the part.
    expect(on(part).boundPane).toBe(part);
    expect(on("panes").activeIdentifier).toBeUndefined();
  });

  /** Folded again, the same command means the workspace's own panel. */
  it("gives the command back to the workspace when the panel folds", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");
    activate(STUB_A);

    foldParts();
    activate(STUB_B);

    expect(on("panes").activeIdentifier).toBe(STUB_B);
    // The panel kept its own.
    expect(on(part).activeIdentifier).toBe(STUB_A);
  });

  /** The choice comes back with the panel, which is the point of keeping it. */
  it("is still the panel's when it is raised again", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");
    activate(STUB_A);
    foldParts();
    activate(STUB_B);

    raisePart(part);

    expect(menuState(STUB_A, true).checked).toBe(true);
    expect(menuState(STUB_B, true).checked).toBe(false);
  });

  it("goes with the part, leaving nothing for the next one to inherit", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");
    activate(STUB_A);

    // The shell's own order: the session is told before the workspace forgets
    // which document this pane held, exactly as for a file slot.
    paneClosed(part);
    closePart(part);

    expect(on(part).activeIdentifier).toBeUndefined();
    expect(on(part).boundPane).toBeUndefined();
  });

  /** And the workspace's own panel is not disturbed by any of it. */
  it("leaves the workspace's session alone", () => {
    openEmptyInPane("a");
    activate(STUB_B);
    const part = openPart(bytes, "body.bin");

    activate(STUB_A);
    paneClosed(part);
    closePart(part);

    expect(on("panes").activeIdentifier).toBe(STUB_B);
    expect(on("panes").boundPane).toBe("a");
  });
});

/**
 * What the panel says a drop would do, which is the whole of what it decides:
 * the drop itself is the same door the header's selector and the pane's own
 * Replace Current File band use.
 *
 * @upstream ByteRipperTests/ToolPanelDropTests.swift#ToolPanelDropTests
 */
describe("a drop on the tool panel", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);

  function twoFilesAndATool(): void {
    openEmptyInPane("a", "works.bin");
    openEmptyInPane("b", "fails.bin");
    setActivePane("a");
    activate(STUB_A);
  }

  // @upstream ByteRipperTests/ToolPanelDropTests.swift#ToolPanelDropTests.testAPaneDroppedOnThePanelMovesTheToolToIt
  it("says which file the pane in flight would make it read", () => {
    twoFilesAndATool();

    expect(paneDropTitle("panes", "b")).toBe(`Show ${STUB_A} for fails.bin`);
  });

  // @upstream ByteRipperTests/ToolPanelDropTests.swift#ToolPanelDropTests.testThePanelRefusesTheParticularPaneItIsAlreadyReading
  it("refuses the particular pane it is already reading", () => {
    twoFilesAndATool();

    expect(paneDropTitle("panes", "a")).toBeUndefined();
    // And it follows the session rather than the file: moving the tool moves
    // which of the two is refused.
    selectPane("b");
    expect(paneDropTitle("panes", "b")).toBeUndefined();
    expect(paneDropTitle("panes", "a")).toBe(`Show ${STUB_A} for works.bin`);
  });

  it("refuses a pane that is not open, and one with no tool to show", () => {
    openEmptyInPane("a", "works.bin");
    activate(STUB_A);

    expect(paneDropTitle("panes", "b")).toBeUndefined();

    activate(undefined);
    expect(paneDropTitle("panes", "b")).toBeUndefined();
  });

  // A part has no file to replace, and the pane a drop would reach for is one
  // of the workspace's, under the panel and out of sight.
  // @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.pinnedPane
  it("is refused outright on a part's own panel", () => {
    openEmptyInPane("a", "works.bin");
    openEmptyInPane("b", "fails.bin");
    const part = openPart(bytes, "body.bin");
    raisePart(part);
    activate(STUB_A, part);

    expect(panelTakesDrops("panes")).toBe(true);
    expect(panelTakesDrops(part)).toBe(false);
    expect(paneDropTitle(part, "b")).toBeUndefined();
  });
});
