import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { canNavigateBack, forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { applyTransaction } from "@/state/toolEdits";
import { openInPane, paneState, setActivePane, workspaceStore } from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * The host's own tools through an in-memory connection, not the pipe: a test opens a file, calls
 * `documents`, `focus`, `read` and `reveal`, and checks the window.
 *
 */

const ROW = 16;
const leave: (() => void)[] = [];

function open(pane: "a" | "b", bytes: Uint8Array<ArrayBuffer>, name = "dump.bin") {
  openInPane(pane, { name, size: bytes.length, lastModified: 0, source: new Blob([bytes]) });
  const view: LinkedScroller = {
    rowHeight: () => ROW,
    position: () => ({ top: 0, left: 0 }),
    extent: () => ({ maxTop: 1000, maxLeft: 0, viewportHeight: 4 * ROW }),
    moveTo: () => undefined,
  };
  leave.push(scrollLink.register(pane, view));
}

/** Calls a tool as a client would, and gives back what the connection wrote. */
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

beforeEach(() => {
  navigationHistory.removeAll();
});

afterEach(() => {
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
});

const ramp = (size: number) => Uint8Array.from({ length: size }, (_, index) => index & 0xff);

describe("documents", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testDocumentsNamesBothFilesOfAComparisonTheFocusedOneFirst
  it("lists what is open, the focused one marked, with ids that stay", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100), "first.bin");
    open("b", ramp(0x40), "second.bin");
    setActivePane("a");
    const answer = (await call(service, "documents")).json;
    const documents = member(answer, "documents") as Json[];
    expect(documents.map((one) => member(one, "name"))).toEqual(["first.bin", "second.bin"]);
    expect(documents.map((one) => member(one, "slot"))).toEqual(["A", "B"]);
    expect(documents.map((one) => member(one, "size"))).toEqual(["0x100", "0x40"]);
    expect(documents.map((one) => member(one, "focused"))).toEqual([true, undefined]);
    expect(documents.map((one) => member(one, "unsaved_edits"))).toEqual([false, false]);
    const again = (await call(service, "documents")).json;
    expect((member(again, "documents") as Json[]).map((one) => member(one, "id"))).toEqual(
      documents.map((one) => member(one, "id"))
    );
  });

  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testWithNothingOpenTheToolsSaySo
  it("says no file is open when none is", async () => {
    const service = new AgentService(undefined);
    expect((await call(service, "documents")).json).toEqual({ documents: [] });
    const refusal = await call(service, "focus");
    expect(refusal.isError).toBe(true);
    expect(refusal.text).toBe("No file is open in ByteRipper.");
  });
  // An id is the document's for as long as it is open; a file opened in its place is a new
  // document with an id of its own.
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testAnIdStaysWithItsDocumentAndANewFileGetsANewOne
  it("keeps an id with its document, and gives a new file a new one", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100));
    expect(member((await call(service, "focus")).json, "document")).toBe("d1");
    expect(member((await call(service, "focus")).json, "document")).toBe("d1");
    open("a", Uint8Array.from([9, 9, 9]), "agent-c.bin");
    expect(member((await call(service, "focus")).json, "document")).toBe("d2");
  });
});

describe("focus", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testFocusReportsTheCaretTheSelectionAndWhatIsOnScreen
  it("names the document, the caret and the selection, and the other of a comparison", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100), "first.bin");
    open("b", ramp(0x100), "second.bin");
    setActivePane("a");
    const slot = paneState("a");
    slot?.document.setSelection({ start: 0x20, end: 0x30, fileSize: 0x100 });
    const focus = (await call(service, "focus")).json;
    expect(member(focus, "name")).toBe("first.bin");
    expect(member(focus, "caret")).toBe("0x20");
    expect(member(focus, "selection")).toEqual({ start: "0x20", end: "0x30", length: "0x10" });
    expect(member(focus, "on_screen")).toEqual({ start: "0x0", end: "0x40", length: "0x40" });
    const other = ((await call(service, "documents")).json as { documents: Json[] }).documents[1];
    expect(member(focus, "compared_with")).toBe(member(other, "id"));
  });

  it("gives a caret alone as a null selection", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100));
    expect(member((await call(service, "focus")).json, "selection")).toBeNull();
  });
});

describe("read", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testReadGivesRowsAsTheDumpDrawsThem
  it("shows bytes as the dump does, from the offset asked for", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100));
    const answer = (await call(service, "read", { offset: "0x10", length: 20 })).json;
    expect(member(answer, "rows")).toEqual([
      "00000010  10 11 12 13 14 15 16 17 18 19 1A 1B 1C 1D 1E 1F  |................|",
      `00000020  20 21 22 23${" ".repeat(36)}  | !"#|`,
    ]);
    expect(member(answer, "length")).toBe("0x14");
  });

  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testReadInTheOtherFormats
  it("reads integers, ascii and utf16le", async () => {
    const service = new AgentService(undefined);
    open("a", Uint8Array.from([0x41, 0x00, 0x42, 0x00, 0x01, 0x02, 0x03, 0x04]));
    expect(
      member(
        (await call(service, "read", { offset: 0, length: 4, format: "utf16le" })).json,
        "text"
      )
    ).toBe("AB");
    expect(
      member((await call(service, "read", { offset: 4, length: 4, format: "u32" })).json, "values")
    ).toEqual(["0x04030201"]);
    expect(
      member(
        (await call(service, "read", { offset: 4, length: 4, format: "u32", endian: "big" })).json,
        "values"
      )
    ).toEqual(["0x01020304"]);
    expect(
      member((await call(service, "read", { offset: 0, length: 2, format: "ascii" })).json, "text")
    ).toBe("A.");
  });

  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testAReadPastTheEndIsCutThereAndOneStartingPastItIsRefused
  it("cuts a read at the end of the file and says so, and refuses one past it", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x20));
    const cut = (await call(service, "read", { offset: 0x18, length: 0x20 })).json;
    expect(member(cut, "length")).toBe("0x8");
    expect(member(cut, "cut_at_end_of_file")).toBe(true);
    const past = await call(service, "read", { offset: 0x20 });
    expect(past.isError).toBe(true);
    expect(past.text).toMatch(/past the end of d1, which is 0x20 bytes long/);
    expect((await call(service, "read", { offset: 0, length: 5000 })).text).toMatch(
      /at most 4096 bytes/
    );
  });

  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testAnUnknownDocumentIsRefusedWithWhereToLook
  it("takes a document by id, and refuses an unknown one by name", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x10), "a.bin");
    open("b", Uint8Array.from([0xaa, 0xbb]), "b.bin");
    const second = ((await call(service, "documents")).json as { documents: Json[] }).documents[1];
    const answer = (
      await call(service, "read", {
        document: member(second, "id") as string,
        offset: 0,
        length: 2,
        format: "u8",
      })
    ).json;
    expect(member(answer, "values")).toEqual(["0xAA", "0xBB"]);
    expect((await call(service, "read", { document: "d99", offset: 0 })).text).toBe(
      "No open document has the id d99. Call `documents` for the ones that are open."
    );
  });
  // A read is of the document as it is now, its unsaved edits included, and `documents` says
  // it has some.
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testReadSeesUnsavedEdits
  it("sees unsaved edits", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100));
    expect(
      await applyTransaction("a", {
        name: "Test",
        writes: [{ offset: 0, bytes: Uint8Array.of(0xee) }],
      })
    ).toBeUndefined();
    const read = (await call(service, "read", { offset: 0, length: 1, format: "u8" })).json;
    expect(member(read, "values")).toEqual(["0xEE"]);
    const documents = member((await call(service, "documents")).json, "documents") as Json[];
    expect(member(documents[0], "unsaved_edits")).toBe(true);
  });
});

describe("reveal", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testRevealSelectsThePlaceAndBackReturnsToWhereTheReaderWas
  it("shows a place, selects it, and is a step the reader's Back undoes", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x100));
    const shown: unknown[] = [];
    agentShell.reveal = (pane, start, end, select) => {
      shown.push([pane, start, end, select]);
      // What the shell does: the range is selected, so the place is no longer the one left.
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x100 });
    };
    expect(canNavigateBack()).toBe(false);
    const answer = (await call(service, "reveal", { offset: "0x10", length: "0x10" })).json;
    expect(shown).toEqual([["a", 0x10, 0x20, true]]);
    expect(member(answer, "selected")).toBe(true);
    expect(member(answer, "shown")).toEqual({ start: "0x10", end: "0x20", length: "0x10" });
    expect(canNavigateBack()).toBe(true);
  });

  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testRevealWithoutALengthMovesTheCaretOnly
  it("moves the caret alone for no length, and refuses an offset past the end", async () => {
    const service = new AgentService(undefined);
    open("a", ramp(0x40));
    const shown: unknown[] = [];
    agentShell.reveal = (pane, start, end, select) => {
      shown.push([pane, start, end, select]);
    };
    expect(member((await call(service, "reveal", { offset: 8 })).json, "selected")).toBe(false);
    expect(shown).toEqual([["a", 8, 8, false]]);
    expect((await call(service, "reveal", { offset: 0x41 })).isError).toBe(true);
  });
});
