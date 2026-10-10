import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHexBytes } from "@/core/agent/agentHexBytes";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { openInPane, paneState, workspaceStore } from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * The one door an agent's change to a file goes through: `write` and every edit a module works out,
 * applied there and nowhere else.
 *
 * @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests
 */

const leave: (() => void)[] = [];
let service: AgentService;

/** What the shell's bridge answers about the machine's files: one file, `/dumps/other.bin`. */
const bridge = (): AgentBridge => ({
  setEnabled: async () => ({ ok: true }),
  info: async () => undefined,
  onConnection: () => () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  send: () => undefined,
  end: () => undefined,
  file: (async (request: { op: string; path: string }) => {
    if (request.path !== "/dumps/other.bin") throw new Error("ENOENT");
    if (request.op === "stat") {
      return { path: request.path, size: 2, modified: 5, isDirectory: false };
    }
    return Uint8Array.from([1, 2]);
  }) as AgentBridge["file"],
});

function open(bytes: number[], pane: "a" | "b" = "a") {
  openInPane(pane, {
    name: "dump.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([Uint8Array.from(bytes)]),
  });
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

const bytesOf = async (start: number, end: number) => [
  ...((await paneState("a")?.document.read(start, end - start)) ?? []),
];

beforeEach(() => {
  navigationHistory.removeAll();
  service = new AgentService(bridge());
});

afterEach(() => {
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

describe("the edit tools", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testTheEditToolsAreListedAsEdits
  it("are listed as edits that take a document", () => {
    const tools = new Map(service.allTools().map((tool) => [tool.name, tool]));
    for (const name of [
      "write",
      "copy_to_other_pane",
      "update_in_parent",
      "uefi_fix_checksum",
      "fit_fix_checksum",
    ]) {
      const tool = tools.get(name);
      expect(tool?.annotations, name).toEqual({
        readOnly: false,
        destructive: false,
        idempotent: false,
      });
      expect(member(member(tool?.inputSchema, "properties"), "document"), name).toBeDefined();
    }
  });
});

describe("the switch", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testAWriteIsRefusedUntilThePersonAllowsEdits
  it("refuses a write until the person allows edits", async () => {
    open([0, 0, 0, 0]);
    expect(service.store.getSnapshot().editsAllowed).toBe(false);
    const refused = await call("write", { offset: 1, bytes: "FF", label: "Patch" });
    expect(refused.isError).toBe(true);
    expect(refused.text.startsWith("Editing is switched off.")).toBe(true);
    expect(await bytesOf(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("write", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testAWriteIsOneUndoStepNamedByItsLabel
  it("is one undo step named by its label, unsaved like a hand edit", async () => {
    open([0x10, 0x11, 0x12, 0x13, 0x14]);
    service.setEditsAllowed(true);
    const answer = (await call("write", { offset: "0x1", bytes: "de ad", label: "Patch the flag" }))
      .json;
    expect(await bytesOf(0, 5)).toEqual([0x10, 0xde, 0xad, 0x13, 0x14]);
    expect(member(answer, "undo")).toBe("Agent: Patch the flag");
    expect(member(answer, "saved")).toBe(false);
    const written = (member(answer, "written") as Json[])[0];
    expect(member(written, "before")).toBe("11 12");
    expect(member(written, "end")).toBe("0x3");
    const document = paneState("a")?.document;
    expect(document?.undoHistory.undoLabel).toBe("Agent: Patch the flag");
    expect(document?.isDirty).toBe(true);

    await document?.undo();
    expect(await bytesOf(0, 5)).toEqual([0x10, 0x11, 0x12, 0x13, 0x14]);
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testExpectWritesOnlyOverTheBytesNamed
  it("writes only over the bytes `expect` names", async () => {
    open([1, 2, 3, 4]);
    service.setEditsAllowed(true);
    const refused = await call("write", { offset: 0, bytes: "AA", label: "X", expect: "09" });
    expect(refused.text).toBe("Nothing written: the bytes at 0x0 are 01, not 09.");
    expect(await bytesOf(0, 4)).toEqual([1, 2, 3, 4]);
    await call("write", { offset: 0, bytes: "AA", label: "X", expect: "0x01" });
    expect(await bytesOf(0, 1)).toEqual([0xaa]);
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testWritesThatWouldResizeOrAreNotHexAreRefused
  it("refuses what would resize the file, what is not hex and what has no label", async () => {
    open([1, 2, 3, 4]);
    service.setEditsAllowed(true);
    const past = await call("write", { offset: 3, bytes: "AA BB", label: "X" });
    expect(past.text).toContain("Writes overwrite; they do not grow the file.");
    expect((await call("write", { offset: 0, bytes: "ABC", label: "X" })).text).toBe(
      '`bytes` is not hex bytes. Give pairs of hex digits, e.g. "DE AD BE EF".'
    );
    expect((await call("write", { offset: 0, bytes: "AA", label: "  " })).text).toBe(
      "`label` is empty; say what the change is."
    );
    expect(await bytesOf(0, 4)).toEqual([1, 2, 3, 4]);
    expect(paneState("a")?.document.canUndo).toBe(false);
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testABackgroundDumpIsNeverChanged
  it("never changes a background dump", async () => {
    open([0]);
    service.setEditsAllowed(true);
    const id = member(
      (await call("open_dump", { path: "/dumps/other.bin" })).json,
      "document"
    ) as string;
    const refused = await call("write", { document: id, offset: 0, bytes: "AA", label: "X" });
    expect(refused.text).toBe(
      `${id} is open in the background, not on screen. Call \`show\` to put it on screen first.`
    );
  });

  it("brings the change on screen as a step of the history", async () => {
    open([0, 0, 0, 0]);
    service.setEditsAllowed(true);
    const shown: unknown[] = [];
    agentShell.reveal = (pane, start, end, select) => {
      shown.push([pane, start, end, select]);
    };
    await call("write", { offset: 1, bytes: "AA BB", label: "X" });
    expect(shown).toEqual([["a", 1, 3, false]]);
  });
});

const idOf = (pane: "a" | "b"): string => {
  const document = paneState(pane)?.document;
  const place = service.desk.places().find((one) => one.document === document);
  if (place === undefined) throw new Error("no such pane");
  return place.id;
};

describe("copy_to_other_pane", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testACopyToTheOtherPaneIsOneUndoStepThere
  it("writes over the same addresses in the other file as one undo step there", async () => {
    open([1, 2, 3, 4, 5, 6], "a");
    open([1, 9, 3, 9, 9, 6], "b");
    service.setEditsAllowed(true);
    const answer = (
      await call("copy_to_other_pane", { document: idOf("a"), offset: 1, length: "0x4" })
    ).json;
    const read = async (pane: "a" | "b") => [
      ...((await paneState(pane)?.document.read(0, 6)) ?? []),
    ];
    expect(await read("b")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await read("a")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(member(answer, "changed")).toBe(3);
    expect(member(answer, "to")).toBe(idOf("b"));
    expect(member(answer, "end")).toBe("0x5");
    expect(member(answer, "undo")).toBe("Agent: Copy to Other Pane");
    expect(paneState("b")?.document.undoHistory.undoLabel).toBe("Agent: Copy to Other Pane");
    expect(paneState("a")?.document.isDirty).toBe(false);
    await paneState("b")?.document.undo();
    expect(await read("b")).toEqual([1, 9, 3, 9, 9, 6]);

    // And back, B into A, under the agent's own words.
    await call("copy_to_other_pane", {
      document: idOf("b"),
      offset: 0,
      length: 2,
      label: "Take B's header",
    });
    expect([...((await paneState("a")?.document.read(0, 2)) ?? [])]).toEqual([1, 9]);
    expect(paneState("a")?.document.undoHistory.undoLabel).toBe("Agent: Take B's header");
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testACopyOverIdenticalBytesWritesNothing
  it("writes nothing over identical bytes", async () => {
    open([1, 2, 3], "a");
    open([1, 2, 3], "b");
    service.setEditsAllowed(true);
    const answer = (await call("copy_to_other_pane", { offset: 0, length: 3 })).json;
    expect(member(answer, "changed")).toBe(0);
    expect(member(answer, "undo")).toBeNull();
    expect(paneState("b")?.document.isDirty).toBe(false);
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testACopyIsRefusedWhereTheMenuRefusesIt
  it("is refused where the menu refuses it, and never grows the file", async () => {
    open([1, 2, 3, 4, 5, 6], "a");
    open([0, 0, 0, 0], "b");
    const off = await call("copy_to_other_pane", { offset: 0, length: 2 });
    expect(off.text.startsWith("Editing is switched off.")).toBe(true);
    service.setEditsAllowed(true);
    const past = await call("copy_to_other_pane", { document: idOf("a"), offset: 2, length: 4 });
    expect(past.isError).toBe(true);
    expect(past.text).toContain("past the end of");
    expect([...((await paneState("b")?.document.read(0, 4)) ?? [])]).toEqual([0, 0, 0, 0]);
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testACopyNeedsASecondFileThatCanBeWritten
  it("needs a second file", async () => {
    open([1, 2, 3], "a");
    service.setEditsAllowed(true);
    const alone = await call("copy_to_other_pane", { offset: 0, length: 1 });
    expect(alone.text).toContain("alone in the window");
  });
});

describe("hex bytes", () => {
  it("reads pairs of digits, ignoring spaces, commas and 0x", () => {
    expect([...parseHexBytes("0xDE ad,be EF", "bytes")]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(() => parseHexBytes("ABC", "bytes")).toThrow("is not hex bytes");
    expect(() => parseHexBytes("GG", "bytes")).toThrow("is not hex bytes");
  });
});

describe("update_in_parent", () => {
  /** Opens `[0x800, 0x900)` of a zeroed 0x1000-byte file as a part, and says its id. */
  async function openedPart(): Promise<string> {
    open(new Array<number>(0x1000).fill(0));
    service.setEditsAllowed(true);
    const part = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    return member(part, "document") as string;
  }

  // A part edited and put back: the parent gets the bytes as one undo step; asked again, there is
  // nothing new to put back.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testAPartGoesBackIntoItsParent
  it("puts a part back into its parent, once", async () => {
    const id = await openedPart();
    await call("write", { document: id, offset: "0x10", bytes: "DEADBEEF", label: "t" });
    const updated = (await call("update_in_parent", { document: id })).json;
    expect(member(updated, "updated")).toBe(true);
    expect(member(updated, "parent")).toBe("d1");
    expect(member(updated, "saved")).toBe(false);
    expect(await bytesOf(0x810, 0x814)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(paneState("a")?.document.isDirty).toBe(true);

    const again = (await call("update_in_parent", { document: id })).json;
    expect(member(again, "updated")).toBe(false);
  });

  // Bytes changed in the parent since the part was opened are not overwritten unless the call says
  // so.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testAChangedSourceIsOverwrittenOnlyWhenAsked
  it("overwrites a changed source only when asked", async () => {
    const id = await openedPart();
    await call("write", { document: "d1", offset: "0x880", bytes: "11", label: "t" });
    await call("write", { document: id, offset: "0x0", bytes: "22", label: "t" });

    const refused = await call("update_in_parent", { document: id });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("overwrite_changed_source");
    expect(await bytesOf(0x800, 0x801)).toEqual([0x00]);

    const updated = (
      await call("update_in_parent", { document: id, overwrite_changed_source: true })
    ).json;
    expect(member(updated, "updated")).toBe(true);
    expect(await bytesOf(0x800, 0x801)).toEqual([0x22]);
    expect(await bytesOf(0x880, 0x881)).toEqual([0x00]);
  });

  // What has no parent, may not be changed, or cannot be put back is refused, and nothing is
  // written.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testWhatCannotGoBackIsRefused
  it("refuses what is no part, what edits are off for, and what has no parent", async () => {
    open(new Array<number>(0x1000).fill(0));
    expect((await call("update_in_parent", { document: "d1" })).text).toContain("is not a part");

    const part = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const id = member(part, "document") as string;
    expect((await call("update_in_parent", { document: id })).text).toContain(
      "Editing is switched off"
    );

    service.setEditsAllowed(true);
    await call("write", { document: id, offset: "0x0", bytes: "22", label: "t" });
    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));
    const closed = await call("update_in_parent", { document: id });
    expect(closed.isError).toBe(true);
    expect(closed.text).toContain("is no longer open");
  });

  // The undo step the person's Edit menu offers is in the app's language; the refusal an agent
  // reads is in English.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testUpdateInParentAnswersInEnglishAndUndoesInTheAppsLanguage
  it("names the undo step by the update's own words", async () => {
    const id = await openedPart();
    await call("write", { document: id, offset: "0x0", bytes: "22", label: "t" });
    const updated = (await call("update_in_parent", { document: id })).json;
    expect(String(member(updated, "undo"))).toMatch(/^Update from /);
  });
});
