import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dumpFiles, parsePath, valueAt } from "@/core/agent/agentSurvey";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import type { OpenedFile } from "@/platform/files/openedFile";
import { discardAnnotationsForTesting } from "@/state/agent/agentAnnotationStore";
import {
  AGENT_BACKGROUND_LIMITS,
  defaultMemoryMiB,
  memoryChoicesMiB,
  snapped,
} from "@/state/agent/agentBackgroundDocuments";
import type { ElsewhereDocument } from "@/state/agent/agentDesk";
import { showHandedRange } from "@/state/agent/agentDumpTools";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { canNavigateBack, forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { loadAgentSettings, rememberAgentBackgroundFiles } from "@/state/settingsStore";
import type { HandedPlace } from "@/state/workspace/paneTransfer";
import { closePane, openInPane, paneState, workspaceStore } from "@/state/workspaceStore";
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
  agentShell.openInNewWindow = undefined;
  service.desk.others = undefined;
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
      `image.rom (${id}) is open in the background, not on screen. Call \`show\` to put it on screen first.`
    );
    // An annotation on a file with no pane belongs to the file, and is drawn once it is shown.
    const annotated = (await call("annotate", { document: id, offset: 0, title: "X" })).json;
    expect(member(annotated, "path")).toBe("/dumps/image.rom");
    expect(member(annotated, "document")).toBeUndefined();
    // And the dock never saw it: the Annotations pill is the only one there.
    const state = workspaceStore.getSnapshot();
    expect(state.dock.panels).toEqual([state.notesPanel]);
  });

  // A document is named to the person by its file, never by its id: two files of one name are told
  // apart by their folders where both have one, and by where they are where they have not.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testADocumentIsNamedByItsFileAndToldApartFromItsTwin
  it("names a document by its file, told apart from its twin", async () => {
    disk.put("/dumps/HP/front.bin", [1, 1], 1000);
    disk.put("/dumps/Dell/front.bin", [9, 9], 1000);
    await call("open_dump", { path: "/dumps/HP/front.bin" });
    await call("open_dump", { path: "/dumps/Dell/front.bin" });
    const labels = async () =>
      (member((await call("documents")).json, "documents") as Json[]).map((one) =>
        member(one, "label")
      );
    expect(new Set(await labels())).toEqual(new Set(["HP/front.bin", "Dell/front.bin"]));

    // Every answer about a document names it as well.
    const read = (await call("read", { document: "d1", offset: 0, length: 2 })).json;
    expect(member(read, "document_label")).toBe("HP/front.bin");

    // One in the window, whose folder the page was never told: it is told apart by where it is.
    open(Uint8Array.from([0, 1]), "a", "front.bin", 2000);
    expect(await labels()).toEqual([
      "front.bin, A",
      "front.bin, not on screen",
      "front.bin, not on screen",
    ]);
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
    service.desk.background.fileLimit = 2;
    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      disk.put(`/dumps/${name}`, [0]);
      await call("open_dump", { path: `/dumps/${name}` });
    }
    expect(service.desk.background.entries.map((one) => one.path)).toEqual([
      "/dumps/b.bin",
      "/dumps/c.bin",
    ]);
  });

  // Past the memory bound the least recently used file is let go after the call that grew the set —
  // and the one asked about last stays, though it alone is over the bound.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testTheMemoryBoundLetsGoOfTheLeastRecentlyUsed
  // @upstream-differs a file weighs its whole Blob as well as what was read of it into the cache, so
  // a four-byte file read through weighs eight, and the bound is twelve where upstream's is six
  it("lets go of the least recently used past the memory bound", async () => {
    service.desk.background.memoryLimit = 12;
    for (const name of ["a.bin", "b.bin"]) {
      disk.put(`/dumps/${name}`, [1, 2, 3, 4]);
      const opened = (await call("open_dump", { path: `/dumps/${name}` })).json;
      await call("read", { document: member(opened, "document") as string, offset: 0, length: 4 });
    }
    expect(service.desk.background.entries.map((one) => one.path)).toEqual(["/dumps/b.bin"]);
    // The file the bridge read, and what was read of it.
    expect(await service.desk.background.heldBytes()).toBe(8);

    service.desk.background.memoryLimit = 1;
    await service.desk.background.trim();
    // The last one asked about is kept.
    expect(service.desk.background.entries.length).toBe(1);
  });

  // A file let go to stay inside the bounds keeps its id: named again, it is read again, and answers
  // under the same id.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAFileLetGoIsReadAgainUnderItsId
  it("reads a file let go again under its id", async () => {
    service.desk.background.fileLimit = 1;
    disk.put("/dumps/a.bin", [7, 7]);
    disk.put("/dumps/b.bin", [0]);
    const id = member(
      (await call("open_dump", { path: "/dumps/a.bin" })).json,
      "document"
    ) as string;
    await call("open_dump", { path: "/dumps/b.bin" });
    expect(service.desk.background.entries.map((one) => one.path)).toEqual(["/dumps/b.bin"]);

    const read = (await call("read", { document: id, offset: 0, length: 2, format: "u8" })).json;
    expect(member(read, "values")).toEqual(["0x07", "0x07"]);
    expect(member(read, "document")).toBe(id);
    expect(service.desk.background.entries.map((one) => one.path)).toEqual(["/dumps/a.bin"]);

    // One closed on purpose is gone.
    await call("close_dump", { document: id });
    expect((await call("read", { document: id, offset: 0, length: 1 })).isError).toBe(true);
  });

  // The bounds are kept in the settings and reach the open set.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testTheBoundsAreKeptAndApplied
  it("keeps the bounds and applies them", async () => {
    expect(service.store.getSnapshot().backgroundFileLimit).toBe(
      AGENT_BACKGROUND_LIMITS.defaultFiles
    );
    service.setBackgroundFileLimit(16);
    service.setBackgroundMemoryLimitMiB(256);
    expect((await loadAgentSettings()).backgroundFiles).toBe(16);
    expect(service.store.getSnapshot().backgroundMemoryLimitMiB).toBe(256);
    expect(service.desk.background.fileLimit).toBe(16);
    expect(service.desk.background.memoryLimit).toBe(256 << 20);

    // A value past the choices is the largest choice.
    rememberAgentBackgroundFiles(1000);
    await service.start();
    expect(service.store.getSnapshot().backgroundFileLimit).toBe(64);
    expect(service.desk.background.fileLimit).toBe(64);
    rememberAgentBackgroundFiles(AGENT_BACKGROUND_LIMITS.defaultFiles);
  });

  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testTheMemoryChoicesFollowTheMac
  it("offers memory bounds that follow the computer", () => {
    const gib = 2 ** 30;
    expect(memoryChoicesMiB(8 * gib)).toEqual([256, 512, 1024, 2048]);
    expect(memoryChoicesMiB(128 * gib).at(-1)).toBe(16384);
    // The smallest is always offered.
    expect(memoryChoicesMiB(gib / 2)).toEqual([256]);
    expect(defaultMemoryMiB(16 * gib)).toBe(1024);
    expect(defaultMemoryMiB(2 * gib)).toBe(512);
    expect(snapped(3000, [256, 1024, 4096], 1024)).toBe(1024);
    expect(snapped(100, [256, 1024], 1024)).toBe(256);
    expect(snapped(undefined, [256, 1024], 1024)).toBe(1024);
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
      "front.bin (d1) is open in the window; only the person closes it."
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

  /**
   * Dumps of one board are often all `bios.bin`, one to a folder: a file is named by its path from
   * the folder, or from the folder the `paths` share, and `root` joined to it is the file.
   *
   * @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testASurveyNamesAFileByItsPathFromTheFolder
   */
  it("names a file by its path from the folder", async () => {
    disk.put("/boards/X1/bios.bin", [1, 9]);
    disk.put("/boards/T14/bios.bin", [1, 8]);
    const question = { tool: "read", arguments: { offset: 0, length: 1, format: "u8" } };
    const survey = (
      await call("survey", {
        folder: "/boards",
        recursive: true,
        ...question,
        group_by: "values.0",
      })
    ).json;
    const groups = member(survey, "groups") as Json[];
    expect(member(groups[0], "files")).toEqual(["T14/bios.bin", "X1/bios.bin"]);
    expect(member(survey, "root")).toBe("/boards");

    const listed = (
      await call("survey", {
        paths: ["/boards/X1/bios.bin", "/boards/T14/bios.bin"],
        ...question,
        group_by: "values.0",
      })
    ).json;
    // From the folder they share, in the order given.
    expect(member((member(listed, "groups") as Json[])[0], "files")).toEqual([
      "X1/bios.bin",
      "T14/bios.bin",
    ]);
    expect(member(listed, "root")).toBe(member(survey, "root"));
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
  // A background dump goes on screen in a new window, as upstream's goes in a new tab — with a pane
  // of this window free, which is for a comparison. That window shows the place itself; the answer
  // is the id it gives the document once it says it holds it.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testShowPutsABackgroundDumpOnScreenUnderANewId
  it("puts a background dump on screen in a new window, under a new id", async () => {
    open(Uint8Array.from([0]), "a", "front.bin");
    disk.put("/dumps/later.bin", new Array(0x100).fill(7));
    const id = member(
      (await call("open_dump", { path: "/dumps/later.bin" })).json,
      "document"
    ) as string;
    const theirs: ElsewhereDocument[] = [];
    const listeners = new Set<() => void>();
    service.desk.others = {
      documents: () => theirs.map((document) => ({ document, tab: 2 })),
      tab: () => 1,
      ask: () => Promise.reject(new Error("not asked")),
      changes(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const handed: [OpenedFile, HandedPlace][] = [];
    agentShell.openInNewWindow = (file, place) => {
      handed.push([file, place]);
      // The new window comes up and says what it holds.
      queueMicrotask(() => {
        theirs.push({
          id: "d99",
          name: file.name,
          slot: "A",
          file: { name: file.name, size: file.size, modified: file.lastModified, path: file.path },
        });
        for (const listener of listeners) listener();
      });
      return true;
    };

    const shown = (await call("show", { document: id, offset: "0x10", length: 4 })).json;
    expect(handed.map(([file, place]) => [file.name, place])).toEqual([
      ["later.bin", { kind: "range", start: 0x10, end: 0x14 }],
    ]);
    expect(member(shown, "document")).toBe("d99");
    expect(member(shown, "replaces")).toBe(id);
    expect(paneState("a")?.name).toBe("front.bin");
    expect(paneState("b")).toBeUndefined();
    expect(service.desk.background.entries).toEqual([]);

    // The new window's half: the file opened there, the range selected as a step.
    const [file] = handed[0] ?? [];
    if (file === undefined) throw new Error("nothing handed");
    closePane("a");
    openInPane("a", file);
    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x100 });
    };
    await showHandedRange(file, 0x10, 0x14);
    const selection = paneState("a")?.document.selection;
    expect([selection?.start, selection?.end]).toEqual([0x10, 0x14]);
    expect(canNavigateBack()).toBe(true);
  });

  it("says so when no new window could be opened", async () => {
    open(Uint8Array.from([0]), "a", "one.bin");
    open(Uint8Array.from([0]), "b", "two.bin");
    disk.put("/dumps/later.bin", [1, 2]);
    const id = member(
      (await call("open_dump", { path: "/dumps/later.bin" })).json,
      "document"
    ) as string;
    service.desk.others = {
      documents: () => [],
      tab: () => 1,
      ask: () => Promise.reject(new Error("not asked")),
    };
    agentShell.openInNewWindow = () => false;
    const refused = await call("show", { document: id });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/could not open later\.bin in a new window/);
    expect(paneState("a")?.name).toBe("one.bin");
    expect(paneState("b")?.name).toBe("two.bin");
  });
});

describe("annotations", () => {
  // What a survey leaves: an annotation, listed in the panel, which leads back to its place.
  // @upstream ByteRipperTests/AgentDumpToolsTests.swift#AgentDumpToolsTests.testAnAnnotationIsListedAndLeadsBackToItsPlace
  // @upstream-differs the card's text is the React panel's; the list the agent reads stands for it
  it("are listed, and lead back to their place", async () => {
    open(new Uint8Array(0x10000), "a", "front.bin");
    const recorded = (
      await call("annotate", {
        document: "d1",
        offset: "0x8000",
        length: 8,
        title: "Stray byte",
        note: "A stray byte.",
      })
    ).json;
    expect(member(recorded, "id")).toBe("a1");
    const listed = member((await call("annotations")).json, "annotations") as Json[];
    expect(member(listed[0], "note")).toBe("A stray byte.");
    expect(member(listed[0], "range")).toMatchObject({ start: "0x8000", end: "0x8008" });

    agentShell.reveal = (pane, start, end) => {
      paneState(pane)?.document.setSelection({ start, end, fileSize: 0x10000 });
    };
    await service.annotationTools.show("a1");
    const selection = paneState("a")?.document.selection;
    expect([selection?.start, selection?.end]).toEqual([0x8000, 0x8008]);

    expect(member((await call("remove_annotations", { all: true })).json, "removed")).toEqual([
      "a1",
    ]);
    expect(member((await call("annotations")).json, "total")).toBe(0);
  });
});
