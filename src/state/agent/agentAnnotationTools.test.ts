import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotationTitles, drawnTooltip } from "@/core/agent/agentAnnotation";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import {
  agentAnnotationStore,
  allAnnotations,
  discardAnnotationsForTesting,
  drawnIn,
  updateAnnotation,
} from "@/state/agent/agentAnnotationStore";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { canNavigateBack, forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import {
  closePane,
  foldParts,
  notesPanelIsUp,
  openInPane,
  openNotesPanel,
  type PaneId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * An agent's annotations: made, listed, related and removed through the service; drawn by the
 * pane and explained under the pointer; counted on the Annotations pill until the panel is up;
 * kept with the file when it closes, and drawn again when it opens. And the person's own notes
 * beside them.
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests
 * @upstream-differs the cards' layout, the toolbar button and the window's language are AppKit
 * drawing, and the dock pill is tested where the dock is
 */

/** The machine's files, as the shell's bridge answers about them. */
const disk = new Map<string, { bytes: Uint8Array; modified: number }>();
const bridge = (): AgentBridge => ({
  setEnabled: async () => ({ ok: true }),
  info: async () => undefined,
  onConnection: () => () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  send: () => undefined,
  end: () => undefined,
  file: (async (request: { op: string; path: string; offset?: number; length?: number }) => {
    const held = disk.get(request.path);
    if (held === undefined) {
      throw new Error(`ENOENT: no such file or directory, stat '${request.path}'`);
    }
    if (request.op === "stat") {
      return {
        path: request.path,
        size: held.bytes.length,
        modified: held.modified,
        isDirectory: false,
      };
    }
    const offset = request.offset ?? 0;
    return held.bytes.slice(offset, offset + (request.length ?? held.bytes.length));
  }) as AgentBridge["file"],
});

const leave: (() => void)[] = [];
let service: AgentService;

const counting = (size: number) => Uint8Array.from({ length: size }, (_, index) => index & 0xff);

function open(
  bytes: Uint8Array<ArrayBuffer>,
  name = "agent-annotation.bin",
  pane: "a" | "b" = "a"
) {
  openInPane(pane, { name, size: bytes.length, lastModified: 1000, source: new Blob([bytes]) });
  const view: LinkedScroller = {
    rowHeight: () => 16,
    position: () => ({ top: 0, left: 0 }),
    extent: () => ({ maxTop: 1000, maxLeft: 0, viewportHeight: 64 }),
    moveTo: () => undefined,
  };
  leave.push(scrollLink.register(pane, view));
}

async function call(name: string, args: { [key: string]: Json } = {}) {
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

async function answer(name: string, args: { [key: string]: Json } = {}): Promise<Json> {
  const answered = await call(name, args);
  if (answered.isError) throw new Error(`${name} was refused: ${answered.text}`);
  return answered.json as Json;
}

/** What pane `pane` draws, as half-open stretches of its own addresses. */
const spans = (pane: PaneId = "a") => drawnIn(pane).map((one) => [one.start, one.end]);

/** What the pointer resting on byte `offset` of pane `pane` shows. */
const tooltip = (offset: number, pane: PaneId = "a") =>
  drawnTooltip(drawnIn(pane), offset, annotationTitles(allAnnotations()));

/** Lets the selection a reveal asks for land, as the pane would. */
function selectOnReveal(): void {
  agentShell.reveal = (pane, start, end) => {
    const document = paneState(pane)?.document;
    document?.setSelection({ start, end, fileSize: document.size });
  };
}

const selection = (pane: PaneId = "a") => {
  const held = paneState(pane)?.document.selection;
  return [held?.start, held?.end];
};

beforeEach(() => {
  navigationHistory.removeAll();
  disk.clear();
  service = new AgentService(bridge());
});

afterEach(() => {
  discardAnnotationsForTesting();
  service.desk.background.closeAll();
  while (leave.length > 0) leave.pop()?.();
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

describe("an annotation", () => {
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAnAnnotationIsDrawnOnThePaneAndListed
  it("is drawn on the pane and listed", async () => {
    open(counting(0x1000));
    const made = await answer("annotate", {
      offset: "0x10",
      length: 4,
      title: "Signature",
      note: "The magic the parser looks for.",
    });
    expect(member(made, "id")).toBe("a1");
    expect(member(made, "range")).toEqual({ start: "0x10", end: "0x14", length: "0x4" });
    expect(member(made, "document")).toBe("d1");
    expect(member(made, "file")).toBe("agent-annotation.bin");
    expect(spans()).toEqual([[0x10, 0x14]]);

    const listed = member(await answer("annotations"), "annotations") as Json[];
    expect(listed).toHaveLength(1);
    expect(member(listed[0], "note")).toBe("The magic the parser looks for.");
    const one = await answer("annotate", { offset: "0x20", title: "One byte" });
    // A place is a byte unless told otherwise.
    expect(member(member(one, "range"), "length")).toBe("0x1");
  });

  // A pointer and what it points at: the relation is kept, and goes when either end does.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testARelationNamesAnotherAnnotationAndGoesWithIt
  it("names another as related, and the relation goes with it", async () => {
    open(counting(0x1000));
    await answer("annotate", { offset: "0x100", length: 0x40, title: "Table" });
    const pointer = await answer("annotate", {
      offset: "0x20",
      length: 4,
      title: "Pointer",
      related_to: ["a1"],
    });
    expect(member(pointer, "related_to")).toEqual(["a1"]);
    expect(tooltip(0x20)).toBe("Pointer\nRelated Annotations: a1 Table");

    const unknown = await call("annotate", { offset: 0, title: "X", related_to: ["a9"] });
    expect(unknown.text).toBe("No annotation a9. Call `annotations` for the ones there are.");

    const removed = await answer("remove_annotations", { ids: ["a1"] });
    expect(member(removed, "removed")).toEqual(["a1"]);
    expect(allAnnotations().map((one) => one.id)).toEqual(["a2"]);
    // The relation went with its other end.
    expect(allAnnotations()[0]?.relatedTo).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAnAnnotationPastTheEndOrWithoutATitleOrAPlaceIsRefused
  it("is refused past the end, without a title or without a place", async () => {
    open(counting(0x100));
    const past = await call("annotate", { offset: "0xF0", length: "0x20", title: "Tail" });
    expect(past.text.endsWith(" (d1), which is 0x100 bytes long.")).toBe(true);
    expect((await call("annotate", { offset: 0, title: "  " })).isError).toBe(true);
    expect((await call("annotate", { offset: 0, length: 0, title: "Nothing" })).isError).toBe(true);
    // The top of the tree is no node.
    expect((await call("annotate", { offset: 0, node: "root", title: "Root" })).isError).toBe(true);
    expect(allAnnotations()).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testRemovingAllClearsEveryFile
  it("all removed clears every file", async () => {
    open(counting(0x1000));
    await answer("annotate", { offset: 0, title: "A" });
    await answer("annotate", { offset: 2, title: "B" });
    expect(member(await answer("remove_annotations", { all: true }), "removed")).toEqual([
      "a1",
      "a2",
    ]);
    expect(spans()).toEqual([]);
    // A removal that names nothing removes nothing.
    expect((await call("remove_annotations")).isError).toBe(true);
  });
});

describe("on screen", () => {
  // The note is what the pointer resting on the bytes shows — the innermost annotation's, where
  // two overlap.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testTheTooltipIsTheInnermostAnnotationsTitleAndNote
  it("the tooltip is the innermost annotation's title and note", async () => {
    open(counting(0x1000));
    await answer("annotate", { offset: 0, length: 0x100, title: "Region" });
    await answer("annotate", { offset: 0x10, length: 4, title: "Signature", note: "Magic." });
    expect(tooltip(0x11)).toBe("Signature\nMagic.");
    expect(tooltip(0x80)).toBe("Region");
    expect(tooltip(0x200)).toBe("");
  });

  // An annotation belongs to the file: another file in the pane does not show it, the list keeps
  // it, and the file opened again shows it again.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAnAnnotationOutlivesItsFileClosingAndReturnsWithIt
  it("outlives its file closing, and returns with it", async () => {
    open(counting(0x1000));
    await answer("annotate", { offset: 0x10, length: 2, title: "A" });
    open(Uint8Array.from([1, 2, 3]), "agent-annotation-other.bin");
    expect(spans()).toEqual([]);
    closePane("a");
    const listed = await answer("annotations");
    // Kept when its file closed, and says it is not open.
    expect(member(listed, "total")).toBe(1);
    expect(member((member(listed, "annotations") as Json[])[0], "document")).toBeUndefined();

    open(counting(0x1000));
    expect(spans()).toEqual([[0x10, 0x12]]);
  });

  // A file that is not open is annotated by its path; showing the annotation opens it.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAFileNotOpenIsAnnotatedByPathAndOpenedToShowIt
  it("is made on a file not open by its path, which showing it opens", async () => {
    disk.set("/dumps/front.bin", { bytes: counting(0x1000), modified: 1000 });
    const made = await answer("annotate", {
      path: "/dumps/front.bin",
      offset: "0x40",
      length: 4,
      title: "Result",
      note: "What was found here.",
    });
    expect(member(made, "document")).toBeUndefined();
    expect(member(made, "path")).toBe("/dumps/front.bin");

    selectOnReveal();
    await service.annotationTools.show("a1");
    expect(paneState("a")?.name).toBe("front.bin");
    expect(selection()).toEqual([0x40, 0x44]);
    expect(spans()).toEqual([[0x40, 0x44]]);

    const missing = await call("annotate", {
      path: "/nonexistent/file.bin",
      offset: 0,
      title: "X",
    });
    expect(missing.text).toBe("There is no file at /nonexistent/file.bin.");
  });

  // A double-click on a card goes to its bytes, and Back comes back.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testShowingAnAnnotationSelectsItsBytesAsAStep
  it("shown selects its bytes as a step", async () => {
    open(counting(0x10000));
    selectOnReveal();
    await answer("annotate", { offset: "0x8000", length: 8, title: "Far" });
    await service.annotationTools.show("a1");
    expect(selection()).toEqual([0x8000, 0x8008]);
    expect(canNavigateBack()).toBe(true);
  });

  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testRevealBringsThePlaceOnScreen
  it("with reveal brings the place on screen", async () => {
    open(counting(0x10000));
    selectOnReveal();
    await answer("annotate", { offset: "0x9000", length: 2, title: "Here", reveal: true });
    expect(selection()).toEqual([0x9000, 0x9002]);
  });
});

describe("the Annotations panel", () => {
  // The agent's notes made while the panel is not up are counted on its pill until it is; one made
  // while it is up is seen at once. Nothing raises the panel but the person.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testTheToolbarButtonCountsTheAgentsNotesUntilTheWindowIsInFront
  // @upstream-differs a pill in the dock, there while there is an annotation, where upstream has a
  // toolbar button and a window
  it("counts the agent's notes on its pill until it is up", async () => {
    open(counting(0x1000));
    expect(workspaceStore.getSnapshot().notesPanel).toBeUndefined();
    await answer("annotate", { offset: 0, title: "A" });
    await answer("annotate", { offset: 2, title: "B" });
    expect(workspaceStore.getSnapshot().notesPanel).toBeDefined();
    expect(notesPanelIsUp(workspaceStore.getSnapshot())).toBe(false);
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(2);

    openNotesPanel();
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(0);
    await answer("annotate", { offset: 4, title: "C" });
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(0);

    foldParts();
    await answer("annotate", { offset: 6, title: "D" });
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(1);
    expect(allAnnotations()).toHaveLength(4);

    // The pill goes with the last annotation.
    await answer("remove_annotations", { all: true });
    expect(workspaceStore.getSnapshot().notesPanel).toBeUndefined();
  });

  // The person's note on a selection: kept and drawn as the agent's is, and never counted as
  // unseen; the person edits it, and its place stays.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testThePersonsNoteIsMadeOnTheSelectionInTheirHue
  it("holds the person's note on a selection", async () => {
    open(counting(0x1000));
    await service.annotationTools.addNote("Board ID", "Checked by hand.", "a", 0x30, 0x38);
    const note = allAnnotations()[0];
    expect(note?.author).toBe("person");
    expect(note?.range).toEqual([0x30, 0x38]);
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(0);
    expect(drawnIn("a").map((one) => one.annotation.author)).toEqual(["person"]);
    const listed = member(await answer("annotations"), "annotations") as Json[];
    // The agent is told whose it is.
    expect(member(listed[0], "author")).toBe("person");

    const id = note?.id ?? "";
    updateAnnotation(id, "Board ID, checked", "Twice.");
    const edited = allAnnotations().find((one) => one.id === id);
    expect([edited?.title, edited?.note]).toEqual(["Board ID, checked", "Twice."]);
    expect(edited?.range).toEqual([0x30, 0x38]);
    expect(edited?.author).toBe("person");
  });
});
