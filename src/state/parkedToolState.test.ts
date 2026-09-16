import { beforeEach, describe, expect, it, vi } from "vitest";
import { noteFirmwareContentChange } from "@/state/firmwareStore";
import {
  noteSessionParkedState,
  parkedModuleIdentifiers,
  type ToolSessionState,
} from "@/state/parkedToolState";
import { activate, paneClosed, toolController } from "@/state/toolController";
import { closePane, openEmptyInPane, PANE_IDS, setActivePane } from "@/state/workspaceStore";

/**
 * What a tool-module leaves behind when it stops being the one on screen, and
 * gets handed back when the user returns to it
 * (`Design/TOOL_MODULES_PLAN.md`).
 *
 * The point of it is that the panel is switchable: one tool-module at a time is
 * the rule, and it only works if going to another one and back is going back
 * rather than starting over.
 *
 * Stand-in tool-modules take the registry's place, as upstream's
 * `installToolStubs` does, and a stub "session" is the answer a panel leaves in
 * the host's box: upstream's stub sets `stateToPark` on a session object, and a
 * React panel has no object to set it on, so the test says what the panel would
 * (`noteSessionParkedState`).
 */

vi.mock("@/tools/registry", () => ({
  toolById: (id: string) =>
    id === STUB_A || id === STUB_B ? { id, title: id, summary: "", View: () => null } : undefined,
}));

const STUB_A = "dev.maxik.tool.stubA";
const STUB_B = "dev.maxik.tool.stubB";

/** A stub's parked state: one note, so a test can tell whose it was. */
interface StubState {
  readonly note: string;
}

const state = () => toolController.getSnapshot();

/** Parks `note` on whatever session is running now. */
function park(pane: "a" | "b", note: string): void {
  noteSessionParkedState(pane, { note } satisfies StubState);
}

/**
 * The note of the state the session was handed, or nothing — what a stub's own
 * `restore` would have logged.
 *
 * The web test reads the one value the session holds rather than an accumulating
 * log: a session here is a mounted panel, and the value it was handed is what
 * the panel seeds its state with.
 */
function restoredNote(): string | undefined {
  return (state().restored as StubState | undefined)?.note;
}

beforeEach(() => {
  // The box is the module's own state, so the reset is the application's own:
  // end the session, announce each pane's close, and let the pane go — which is
  // the order `closeWithWarning` uses.
  activate(undefined);
  for (const pane of PANE_IDS) {
    paneClosed(pane);
    closePane(pane);
  }
});

describe("coming back", () => {
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testComingBackToAToolModuleHandsItsStateBack
  it("hands the state back to the tool that left it", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "rows");

    activate(undefined);
    expect(parkedModuleIdentifiers()).toEqual([STUB_A]);
    activate(STUB_A);

    expect(restoredNote()).toBe("rows");
  });

  // Two tool-modules, each keeping its own place. This is the whole reason the
  // box is keyed by tool-module rather than being one slot.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testEachToolModuleKeepsItsOwnPlace
  it("gives each tool-module its own place", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "a-rows");
    activate(STUB_B);
    park("a", "b-rows");

    activate(STUB_A);
    expect(restoredNote()).toBe("a-rows");
    activate(STUB_B);
    expect(restoredNote()).toBe("b-rows");
  });

  // The default is to keep nothing, which is right for a panel that is a
  // function of the file — and a tool-module gets that without writing a line.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testAToolModuleThatKeepsNothingIsHandedNothing
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/SeamTests.swift#SeamTests.testASessionKeepsNothingUnlessItSaysSo
  it("hands nothing to a tool-module that keeps nothing", () => {
    openEmptyInPane("a");
    activate(STUB_A);

    activate(undefined);
    expect(parkedModuleIdentifiers()).toEqual([]);
    activate(STUB_A);

    expect(restoredNote()).toBeUndefined();
  });

  // Handed over, not copied: the state belongs to the session that got it, and
  // what comes back next time is whatever *that* session leaves.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testTheStateIsHandedOverOnlyOnce
  it("hands the state over only once", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "rows");
    activate(undefined);
    activate(STUB_A);
    expect(restoredNote()).toBe("rows");

    // The second session parks nothing of its own.
    activate(undefined);
    activate(STUB_A);

    expect(restoredNote()).toBeUndefined();
  });
});

describe("when it is dropped", () => {
  // A parked selection in a file that has been closed is a selection in a file
  // nobody has any more.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testClosingTheFileForgetsWhatWasParked
  it("forgets a closed file's parked state", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "rows");

    // The shell's order: the close is announced, then the pane forgets its file.
    paneClosed("a");
    closePane("a");

    expect(parkedModuleIdentifiers()).toEqual([]);
  });

  // A revert, a change from outside, a join: the running tool-module is told and
  // re-reads, and the parked ones have no way to hear it.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testReplacingTheContentForgetsWhatWasParked
  it("forgets a file whose content was replaced", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "rows");
    activate(undefined);
    expect(parkedModuleIdentifiers()).not.toEqual([]);

    // A reload with no tree open at all: the state goes whether or not anyone
    // is reading, which is why the discard is before the store's own guard.
    noteFirmwareContentChange("a", { kind: "reloaded" });

    expect(parkedModuleIdentifiers()).toEqual([]);
  });

  // Ordinary editing does not: an edit is what a tool-module is for, and the
  // state is a hint the next session checks rather than a copy of the bytes.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testAnEditDoesNotForgetWhatWasParked
  it("keeps a parked state through an edit", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "rows");
    activate(undefined);

    noteFirmwareContentChange("a", { kind: "edited", start: 0, end: 1, sizeDelta: 0 });

    expect(parkedModuleIdentifiers()).toEqual([STUB_A]);
  });

  // The state describes one file. The other pane is another file, so the
  // tool-module opens there with nothing.
  // @upstream ByteRipperTests/ToolParkedStateTests.swift#ToolParkedStateTests.testStateParkedOnOnePaneIsNotHandedToTheOther
  it("does not hand one pane's state to the other", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("a");
    activate(STUB_A);
    expect(state().boundPane).toBe("a");
    park("a", "left");
    activate(undefined);

    setActivePane("b");
    activate(STUB_A);

    expect(state().boundPane).toBe("b");
    expect(restoredNote()).toBeUndefined();
    // "and it is not kept for later": the entry was taken and refused, not
    // left standing for the next session bound to the pane it came from.
    expect(parkedModuleIdentifiers()).toEqual([]);
  });

  // Upstream's `testAPaneLeavingForgetsWhatWasParked` has no case here: a pane
  // leaves for another window, and one workspace per browser tab (D11) has
  // nowhere to leave to. The close above is the whole of that rule on this side
  // — `paneClosed` is where upstream's `paneLeft` lands too.

  // What a tool hands back is a value the host never looks inside, so a state
  // of another shape is a session's to refuse — and it cannot even reach a
  // session: the box is keyed by the identifier the state was left under.
  it("keeps a tool-module's state out of another's hands", () => {
    openEmptyInPane("a");
    activate(STUB_A);
    park("a", "a-rows");
    activate(STUB_B);

    expect(restoredNote()).toBeUndefined();
  });
});

/** The tool seam's own default, which the box above is built on. */
describe("the box", () => {
  it("is empty when no session has left anything", () => {
    expect(parkedModuleIdentifiers()).toEqual([]);
    expect(state().restored as ToolSessionState | undefined).toBeUndefined();
  });
});
