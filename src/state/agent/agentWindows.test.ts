import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { AgentToolError, jsonAnswer } from "@/core/agent/agentTool";
import { AgentDesk } from "@/state/agent/agentDesk";
import { documentsFrontToBack, type Runner, windowToRun } from "@/state/agent/agentWindows";
import { openEmptyInPane, workspaceStore } from "@/state/workspaceStore";

const windows: [string, Runner][] = [
  ["front", { ids: ["d1", "d3"], focusedAt: 20 }],
  ["behind", { ids: ["d2"], focusedAt: 10 }],
];

describe("the window a call is run in (D7d)", () => {
  it("is the one holding the document named", () => {
    expect(windowToRun(windows, new AgentArguments({ document: "d2" }))).toBe("behind");
    expect(windowToRun(windows, new AgentArguments({ document: "d3", against: "d1" }))).toBe(
      "front"
    );
  });

  it("is the one in front for a call naming no document, or one no window holds", () => {
    expect(windowToRun(windows, new AgentArguments({}))).toBe("front");
    expect(windowToRun(windows, new AgentArguments({ document: "d9" }))).toBe("front");
  });

  it("refuses two documents held by two windows", () => {
    expect(() =>
      windowToRun(windows, new AgentArguments({ document: "d1", against: "d2" }))
    ).toThrow(AgentToolError);
  });

  it("refuses when no window of the workspace is open", () => {
    expect(() => windowToRun([], new AgentArguments({}))).toThrow(AgentToolError);
  });
});

describe("every window's documents put together", () => {
  it("numbers the windows' tabs from the front, and keeps the front one's focus alone", () => {
    const listed = documentsFrontToBack([
      jsonAnswer({
        documents: [
          { id: "d1", tab: 1, focused: true },
          { id: "d4", slot: "background" },
        ],
      }),
      undefined,
      jsonAnswer({ documents: [{ id: "d2", tab: 1, focused: true }] }),
    ]);
    expect(listed).toEqual([
      { id: "d1", tab: 1, focused: true },
      { id: "d4", slot: "background" },
      { id: "d2", tab: 3 },
    ]);
  });
});

describe("documents of the same name in two windows (D7d)", () => {
  // @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.labelled
  it("are told apart by their window", () => {
    openEmptyInPane("a", "bios.bin");
    const desk = new AgentDesk();
    desk.others = {
      documents: () => [{ document: { id: "d9", name: "bios.bin", slot: "A" }, tab: 1 }],
      tab: () => 2,
      ask: async () => null,
    };
    expect(desk.placeOf("a")?.label).toBe("bios.bin, tab 2");
    desk.others = undefined;
    expect(desk.placeOf("a")?.label).toBe("bios.bin");
    workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  });
});
