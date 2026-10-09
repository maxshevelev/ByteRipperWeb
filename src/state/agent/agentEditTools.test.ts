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
    for (const name of ["write", "uefi_fix_checksum", "fit_fix_checksum"]) {
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

describe("hex bytes", () => {
  it("reads pairs of digits, ignoring spaces, commas and 0x", () => {
    expect([...parseHexBytes("0xDE ad,be EF", "bytes")]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(() => parseHexBytes("ABC", "bytes")).toThrow("is not hex bytes");
    expect(() => parseHexBytes("GG", "bytes")).toThrow("is not hex bytes");
  });
});
