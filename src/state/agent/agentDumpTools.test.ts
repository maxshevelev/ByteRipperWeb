import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findingText } from "@/core/agent/agentFindingText";
import { dumpFiles, parsePath, valueAt } from "@/core/agent/agentSurvey";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { agentFindingStore } from "@/state/agent/agentDumpTools";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { canNavigateBack, forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { openInPane, paneState, workspaceStore } from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * Work across many dumps: a file opened by path with no window, a folder asked one question, a dump
 * put on screen, and findings that lead back to their place.
 *
 * @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests
 */

/** The machine's files, as the shell's bridge answers about them. */
class FakeFiles {
  readonly files = new Map<string, { bytes: Uint8Array; modified: number }>();

  put(path: string, bytes: number[] | Uint8Array, modified = 1000): void {
    this.files.set(path, { bytes: Uint8Array.from(bytes), modified });
  }

  bridge(): AgentBridge {
    const files = this.files;
    const missing = (path: string) =>
      new Error(`ENOENT: no such file or directory, stat '${path}'`);
    return {
      setEnabled: async () => ({ ok: true }),
      info: async () => undefined,
      onConnection: () => () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      send: () => undefined,
      end: () => undefined,
      file: (async (request: {
        op: string;
        path: string;
        recursive?: boolean;
        offset?: number;
        length?: number;
      }) => {
        if (request.op === "list") {
          const prefix = request.path.endsWith("/") ? request.path : `${request.path}/`;
          const found = [...files.keys()].filter(
            (one) =>
              one.startsWith(prefix) &&
              (request.recursive === true || !one.slice(prefix.length).includes("/"))
          );
          return { files: found, truncated: false };
        }
        const held = files.get(request.path);
        if (held === undefined) throw missing(request.path);
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
    };
  }
}

const leave: (() => void)[] = [];
let disk: FakeFiles;
let service: AgentService;

function open(bytes: Uint8Array<ArrayBuffer>, pane: "a" | "b", name: string, modified = 0) {
  openInPane(pane, { name, size: bytes.length, lastModified: modified, source: new Blob([bytes]) });
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

beforeEach(() => {
  navigationHistory.removeAll();
  disk = new FakeFiles();
  service = new AgentService(disk.bridge());
});

afterEach(() => {
  service.desk.background.closeAll();
  while (leave.length > 0) leave.pop()?.();
  agentFindingStore.update(() => ({ findings: [] }));
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

describe("the pure parts", () => {
  it("takes the dump files of a listing, naturally sorted, hidden ones left out", () => {
    expect(
      dumpFiles(["/d/b10.bin", "/d/b2.BIN", "/d/.hidden.bin", "/d/notes.txt", "/d/noext"])
    ).toEqual(["/d/b2.BIN", "/d/b10.bin"]);
    expect(dumpFiles(["C:\\d\\b.rom", "C:\\d\\.x.rom", "C:\\d\\a.img"])).toEqual([
      "C:\\d\\a.img",
      "C:\\d\\b.rom",
    ]);
  });

  it("reads a path into an answer, a negative index counting from the end", () => {
    const answer = { matches: [{ start: "0x10" }, { start: "0x20" }], values: ["0x01", "0x02"] };
    expect(valueAt(parsePath("matches.1.start"), answer)).toBe("0x20");
    expect(valueAt(parsePath("values.-1"), answer)).toBe("0x02");
    expect(valueAt(parsePath("values.5"), answer)).toBeUndefined();
    expect(valueAt(parsePath("nothing"), answer)).toBeUndefined();
  });
});

describe("open_dump", () => {
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testABackgroundDumpAnswersQuestionsButIsNotOnScreen
  it("answers questions about a background dump, which is not on screen", async () => {
    open(Uint8Array.from([0, 1, 2, 3]), "a", "front.bin");
    disk.put(
      "/dumps/image.rom",
      Array.from({ length: 0x20 }, (_, index) => index)
    );
    const opened = (await call("open_dump", { path: "/dumps/image.rom" })).json;
    expect(member(opened, "on_screen")).toBe(false);
    const id = member(opened, "document") as string;

    const listing = member((await call("documents")).json, "documents") as Json[];
    expect(listing.find((one) => member(one, "id") === id)).toMatchObject({ slot: "background" });

    const bytes = (await call("read", { document: id, offset: 0, length: 4, format: "u8" })).json;
    expect((member(bytes, "values") as Json[]).length).toBe(4);

    const reveal = await call("reveal", { document: id, offset: 0 });
    expect(reveal.text).toBe(
      `${id} is open in the background, not on screen. Call \`show\` to put it on screen first.`
    );
    expect((await call("mark", { document: id, offset: 0, length: 1, label: "X" })).isError).toBe(
      true
    );
    // And the dock never saw it.
    expect(workspaceStore.getSnapshot().dock.panels).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAFileAlreadyInATabAnswersWithThatTabsId
  it("answers with the pane's id for a file the window already has", async () => {
    open(Uint8Array.from([0, 1, 2, 3]), "a", "front.bin", 1000);
    disk.put("/dumps/front.bin", [0, 1, 2, 3], 1000);
    const opened = (await call("open_dump", { path: "/dumps/front.bin" })).json;
    expect(member(opened, "on_screen")).toBe(true);
    expect(member(opened, "document")).toBe("d1");
    expect(service.desk.background.entries).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAFileChangedOnDiskIsReadAgainUnderTheSameId
  it("reads a file changed on disk again, under the same id", async () => {
    disk.put("/dumps/changing.bin", [1, 1, 1, 1], 1000);
    const id = member(
      (await call("open_dump", { path: "/dumps/changing.bin" })).json,
      "document"
    ) as string;
    disk.put("/dumps/changing.bin", [2, 2], 2000);
    const read = (await call("read", { document: id, offset: 0, length: 2, format: "u8" })).json;
    expect(member(read, "values")).toEqual(["0x02", "0x02"]);
    expect(member(read, "document")).toBe(id);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testOnlyTheMostRecentlyUsedAreKept
  it("keeps only the most recently used", async () => {
    service.desk.background.limit = 2;
    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      disk.put(`/dumps/${name}`, [0]);
      await call("open_dump", { path: `/dumps/${name}` });
    }
    expect(service.desk.background.entries.map((one) => one.path)).toEqual([
      "/dumps/b.bin",
      "/dumps/c.bin",
    ]);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testCloseDumpClosesABackgroundFileAndRefusesATab
  it("closes a background file and refuses one in the window", async () => {
    open(Uint8Array.from([0]), "a", "front.bin");
    disk.put("/dumps/b.bin", [0]);
    const id = member(
      (await call("open_dump", { path: "/dumps/b.bin" })).json,
      "document"
    ) as string;
    expect(member((await call("close_dump", { document: id })).json, "closed")).toBe(id);
    expect(service.desk.background.entries).toEqual([]);
    expect((await call("close_dump", { document: "d1" })).text).toBe(
      "d1 is open in the window; only the person closes it."
    );
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAMissingFileIsRefusedWithItsPath
  it("refuses a missing file with its path, and a relative one", async () => {
    const missing = await call("open_dump", { path: "/nowhere/at/all.bin" });
    expect(missing.isError).toBe(true);
    expect(missing.text.startsWith("Could not read /nowhere/at/all.bin")).toBe(true);
    expect((await call("open_dump", { path: "dumps/a.bin" })).text).toBe(
      "`dumps/a.bin` is not an absolute path."
    );
  });

  it("takes a Windows path as absolute", async () => {
    disk.put("C:\\dumps\\a.bin", [5]);
    expect((await call("open_dump", { path: "C:\\dumps\\a.bin" })).isError).toBe(false);
  });
});

describe("survey", () => {
  beforeEach(() => {
    disk.put("/dumps/one.rom", [1, 9]);
    disk.put("/dumps/two.bin", [1, 8]);
    disk.put("/dumps/blank.bin", [0xff, 7]);
    disk.put("/dumps/notes.txt", [1, 2, 3]);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testASurveyGroupsTheFolderByTheValueAskedFor
  it("groups a folder by the value asked for, leaving out what is no dump", async () => {
    const answer = (
      await call("survey", {
        folder: "/dumps",
        tool: "read",
        arguments: { offset: 0, length: 1, format: "u8" },
        group_by: "values.0",
      })
    ).json;
    expect(member(answer, "files")).toBe(3);
    const groups = member(answer, "groups") as Json[];
    const byValue = new Map(groups.map((one) => [member(one, "value"), one]));
    expect(member(byValue.get("0x01"), "count")).toBe(2);
    expect(member(byValue.get("0x01"), "files")).toEqual(["one.rom", "two.bin"]);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testASurveysGroupsArePaged
  it("pages its groups from the same run, and refuses a cursor of another survey", async () => {
    const question = {
      folder: "/dumps",
      tool: "read",
      arguments: { offset: 0, length: 1, format: "u8" },
      group_by: "values.0",
      limit: 1,
    };
    const first = (await call("survey", question)).json;
    expect((member(first, "groups") as Json[]).length).toBe(1);
    expect(member(first, "groups_total")).toBe(2);
    const next = member(first, "next") as string;
    const second = (await call("survey", { ...question, after: next })).json;
    expect((member(second, "groups") as Json[]).length).toBe(1);
    expect(member(second, "next")).toBeNull();
    expect(member(first, "groups")).not.toEqual(member(second, "groups"));

    const refused = await call("survey", { ...question, after: next, group_by: "values" });
    expect(refused.text).toBe("That page is of another survey; ask again without `after`.");
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAPathCanCountFromTheEndAndARefusalIsListed
  it("counts a path from the end, and lists the files a tool refused", async () => {
    disk.put("/dumps/short.bin", [1]);
    const answer = (
      await call("survey", {
        paths: ["/dumps/one.rom", "/dumps/short.bin"],
        tool: "read",
        arguments: { offset: 1, length: 1, format: "u8" },
        group_by: "values.-1",
      })
    ).json;
    expect((member(answer, "groups") as Json[]).length).toBe(1);
    expect(member((member(answer, "failed") as Json[])[0], "file")).toBe("short.bin");
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testASurveyOnlyRunsToolsThatTakeADocument
  it("only runs tools that take a document", async () => {
    const refused = await call("survey", { folder: "/dumps", tool: "documents" });
    expect(refused.text).toBe("`documents` is not a tool that answers about one document.");
  });

  it("says when there is nothing to survey", async () => {
    expect((await call("survey", { folder: "/empty", tool: "read" })).text).toBe(
      "No dump files to survey there."
    );
  });
});

describe("show", () => {
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testShowPutsABackgroundDumpOnScreenUnderANewId
  it("puts a background dump on screen in a free pane, under a new id", async () => {
    open(Uint8Array.from([0]), "a", "front.bin");
    disk.put("/dumps/later.bin", new Array(0x100).fill(7));
    const id = member(
      (await call("open_dump", { path: "/dumps/later.bin" })).json,
      "document"
    ) as string;
    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x100 });
    };
    const shown = (await call("show", { document: id, offset: "0x10", length: 4 })).json;
    expect(member(shown, "replaces")).toBe(id);
    expect(member(shown, "document")).not.toBe(id);
    expect(paneState("b")?.name).toBe("later.bin");
    const selection = paneState("b")?.document.selection;
    expect([selection?.start, selection?.end]).toEqual([0x10, 0x14]);
    expect(service.desk.background.entries).toEqual([]);
    expect(canNavigateBack()).toBe(true);
  });

  it("never opens into a pane that holds a file", async () => {
    open(Uint8Array.from([0]), "a", "one.bin");
    open(Uint8Array.from([0]), "b", "two.bin");
    disk.put("/dumps/later.bin", [1, 2]);
    const id = member(
      (await call("open_dump", { path: "/dumps/later.bin" })).json,
      "document"
    ) as string;
    const refused = await call("show", { document: id });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/Both panes of the window hold a file/);
    expect(paneState("a")?.name).toBe("one.bin");
    expect(paneState("b")?.name).toBe("two.bin");
  });
});

describe("findings", () => {
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAFindingIsListedAndLeadsBackToItsPlace
  it("lists a finding and leads back to its place", async () => {
    open(new Uint8Array(0x10000), "a", "front.bin");
    const recorded = (
      await call("finding", { document: "d1", offset: "0x8000", length: 8, text: "A stray byte." })
    ).json;
    expect(member(recorded, "id")).toBe("f1");
    expect(member(recorded, "file")).toBe("front.bin");
    const listed = member((await call("findings")).json, "findings") as Json[];
    expect(member(listed[0], "text")).toBe("A stray byte.");

    const finding = service.dumpTools.findings[0];
    if (finding === undefined) throw new Error("recorded");
    expect(findingText(finding, "file")).toBe("front.bin");
    expect(findingText(finding, "place")).toBe("0x8000–0x8008");

    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x10000 });
    };
    await service.dumpTools.showFinding(finding);
    const selection = paneState("a")?.document.selection;
    expect([selection?.start, selection?.end]).toEqual([0x8000, 0x8008]);

    service.dumpTools.clearFindings();
    expect(service.dumpTools.findings).toEqual([]);
  });

  it("records a finding by path, which a closed file can be opened again from", async () => {
    disk.put("/dumps/x.bin", new Array(0x40).fill(0));
    const recorded = (
      await call("finding", { path: "/dumps/x.bin", offset: 4, length: 2, text: "Odd." })
    ).json;
    expect(member(recorded, "path")).toBe("/dumps/x.bin");
    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x40 });
    };
    const finding = service.dumpTools.findings[0];
    if (finding === undefined) throw new Error("recorded");
    await service.dumpTools.showFinding(finding);
    expect(paneState("a")?.name).toBe("x.bin");
    expect(paneState("a")?.document.selection.start).toBe(4);
  });

  it("refuses a finding about a document that is no file", async () => {
    const refused = await call("finding", { document: "d1", text: "X" });
    expect(refused.isError).toBe(true);
  });
});
