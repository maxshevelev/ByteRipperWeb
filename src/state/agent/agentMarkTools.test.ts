import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentMarkTooltip } from "@/core/agent/agentMark";
import { type AGENT_MARK_COLUMNS, markText } from "@/core/agent/agentMarkText";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import { agentMarkStore, agentMarksFor } from "@/state/agent/agentMarkStore";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { canNavigateBack, forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { openInPane, paneState, setActivePane, workspaceStore } from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * An agent's marks: made, listed, related and removed through the service; explained under the
 * pointer; listed in the Agent window; gone with their document.
 *
 * @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests
 */

const leave: (() => void)[] = [];

function open(bytes: Uint8Array<ArrayBuffer>, pane: "a" | "b" = "a", name = "dump.bin") {
  openInPane(pane, { name, size: bytes.length, lastModified: 0, source: new Blob([bytes]) });
  const view: LinkedScroller = {
    rowHeight: () => 16,
    position: () => ({ top: 0, left: 0 }),
    extent: () => ({ maxTop: 1000, maxLeft: 0, viewportHeight: 64 }),
    moveTo: () => undefined,
  };
  leave.push(scrollLink.register(pane, view));
}

async function call(service: AgentService, name: string, args: { [key: string]: Json } = {}) {
  const written: Json[] = [];
  const connection = service.connect((line) => written.push(parseJson(decodeUtf8(line))));
  connection.receive(
    encodeUtf8(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`
    )
  );
  await connection.waitUntilIdle();
  const result = member(written[0], "result");
  const text = member((member(result, "content") as Json[])[0], "text") as string;
  const isError = member(result, "isError") === true;
  return { isError, text, json: isError ? undefined : (parseJson(text) as Json) };
}

const ramp = (size: number) => Uint8Array.from({ length: size }, (_, index) => index & 0xff);

beforeEach(() => navigationHistory.removeAll());

afterEach(() => {
  while (leave.length > 0) leave.pop()?.();
  agentMarkStore.update(() => ({ panes: {} }));
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
  scrollLink.forget("a");
  scrollLink.forget("b");
  forgetCaretOnScreen("a");
  forgetCaretOnScreen("b");
  agentShell.reveal = undefined;
  agentShell.bringForward = undefined;
});

describe("the tools", () => {
  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testAMarkIsMadeOnThePaneAndListed
  it("makes a mark on the pane and lists it", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x1000));
    const made = (
      await call(service, "mark", {
        offset: "0x10",
        length: 4,
        label: "Signature",
        note: "The magic the parser looks for.",
      })
    ).json;
    expect(member(made, "id")).toBe("m1");
    expect(member(made, "range")).toEqual({ start: "0x10", end: "0x14", length: "0x4" });
    expect(agentMarksFor("a").map((mark) => mark.label)).toEqual(["Signature"]);

    const listed = member((await call(service, "marks")).json, "marks") as Json[];
    expect(listed).toHaveLength(1);
    expect(member(listed[0], "note")).toBe("The magic the parser looks for.");
  });

  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testARelationNamesAnotherMarkAndGoesWithIt
  it("keeps a relation, which goes when either end does", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x1000));
    await call(service, "mark", { offset: "0x100", length: 0x40, label: "Table" });
    const pointer = await call(service, "mark", {
      offset: "0x20",
      length: 4,
      label: "Pointer",
      related_to: ["m1"],
    });
    expect(member(pointer.json, "related_to")).toEqual(["m1"]);

    const unknown = await call(service, "mark", {
      offset: 0,
      length: 1,
      label: "X",
      related_to: ["m9"],
    });
    expect(unknown.text).toBe("No mark m9. Call `marks` for the ones there are.");

    const removed = await call(service, "unmark", { ids: ["m1"] });
    expect(member(removed.json, "removed")).toEqual(["m1"]);
    expect(agentMarksFor("a").map((mark) => mark.id)).toEqual(["m2"]);
    expect(agentMarksFor("a")[0]?.relatedTo).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testAMarkPastTheEndOrWithoutALabelIsRefused
  it("refuses a mark past the end, one with no label and one with no length", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x100));
    const past = await call(service, "mark", { offset: "0xF0", length: "0x20", label: "Tail" });
    expect(past.text).toBe(
      "The range 0xF0+0x20 runs past the end of d1, which is 0x100 bytes long."
    );
    expect((await call(service, "mark", { offset: 0, length: 1, label: "  " })).isError).toBe(true);
    expect((await call(service, "mark", { offset: 0, length: 0, label: "Nothing" })).isError).toBe(
      true
    );
    expect(agentMarksFor("a")).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testUnmarkAllClearsEveryDocument
  it("clears every document with `all`, and refuses an unmark that names nothing", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x1000));
    open(ramp(0x100), "b", "other.bin");
    await call(service, "mark", { offset: 0, length: 1, label: "A" });
    await call(service, "mark", { document: "d2", offset: 2, length: 1, label: "B" });
    const removed = await call(service, "unmark", { all: true });
    expect(member(removed.json, "removed")).toEqual(["m1", "m2"]);
    expect(agentMarksFor("a")).toEqual([]);
    expect(agentMarksFor("b")).toEqual([]);
    expect((await call(service, "unmark")).isError).toBe(true);
  });

  it("says which ids it did not find", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x100));
    await call(service, "mark", { offset: 0, length: 1, label: "A" });
    const answer = (await call(service, "unmark", { ids: ["m1", "m7"] })).json;
    expect(member(answer, "removed")).toEqual(["m1"]);
    expect(member(answer, "not_found")).toEqual(["m7"]);
  });
});

describe("on screen", () => {
  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testTheTooltipIsTheInnermostMarksLabelAndNote
  it("explains the byte with the innermost mark's label and note", () => {
    const marks = [
      { id: "m1", start: 0, end: 0x100, label: "Region", note: "", relatedTo: [] },
      { id: "m2", start: 0x10, end: 0x14, label: "Signature", note: "Magic.", relatedTo: [] },
    ];
    expect(agentMarkTooltip(marks, 0x11)).toBe("Signature\nMagic.");
    expect(agentMarkTooltip(marks, 0x80)).toBe("Region");
    expect(agentMarkTooltip(marks, 0x200)).toBe("");
  });

  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testMarksGoWhenAnotherFileIsOpenedInThePane
  it("drops the marks when another file is opened in the pane", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x100));
    await call(service, "mark", { offset: 0, length: 1, label: "A" });
    expect(agentMarksFor("a")).toHaveLength(1);
    open(Uint8Array.from([1, 2, 3]));
    expect(agentMarksFor("a")).toEqual([]);
    expect(agentMarkStore.getSnapshot().panes.a).toBeUndefined();
  });
});

describe("the Agent window", () => {
  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testTheWindowListsMarksWithTheirRelationsAndClearsThem
  it("lists marks with their relations, and clears them", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x1000));
    await call(service, "mark", { offset: "0x100", length: 0x40, label: "Table" });
    await call(service, "mark", {
      offset: "0x20",
      length: 4,
      label: "Pointer",
      related_to: ["m1"],
    });
    const marks = service.markTools.all();
    const all = marks.map((one) => one.mark);
    const text = (row: number, column: (typeof AGENT_MARK_COLUMNS)[number]) => {
      const one = marks[row];
      return one === undefined ? undefined : markText(one.mark, column, one.place.name, all);
    };
    expect(text(0, "label")).toBe("Table");
    expect(text(1, "range")).toBe("0x20–0x24");
    expect(text(1, "note")).toBe("Related Marks: m1 Table");
    expect(agentMarkTooltip(all, 0x20)).toBe("Pointer\nRelated Marks: m1 Table");

    service.markTools.remove(() => true);
    expect(agentMarksFor("a")).toEqual([]);
    expect(service.markTools.all()).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentMarkTests.swift#AgentMarkTests.testShowingAMarkSelectsItsBytesAsAStep
  it("shows a mark by selecting its bytes, as a step the reader's Back undoes", async () => {
    const service = new AgentService(undefined);
    open(ramp(0x10000));
    setActivePane("a");
    await call(service, "mark", { offset: "0x8000", length: 8, label: "Far" });
    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x10000 });
    };
    await service.markTools.show("m1");
    const selection = paneState("a")?.document.selection;
    expect([selection?.start, selection?.end]).toEqual([0x8000, 0x8008]);
    expect(canNavigateBack()).toBe(true);
  });
});
