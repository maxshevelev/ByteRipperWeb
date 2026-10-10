import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Json, jsonText, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { divided, runsOf } from "@/state/agent/agentDiffTools";
import { AgentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { openInPane, paneState, workspaceStore } from "@/state/workspaceStore";
import type { ToolAgentPlace } from "@/tools/toolAgent";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * Two documents compared byte by byte, searched, and opened as parts.
 *
 * @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests
 */

const files = new Map<string, Uint8Array>();
const bridge = (): AgentBridge => ({
  setEnabled: async () => ({ ok: true }),
  info: async () => undefined,
  onConnection: () => () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  send: () => undefined,
  end: () => undefined,
  file: (async (request: { op: string; path: string; offset?: number; length?: number }) => {
    const held = files.get(request.path);
    if (held === undefined) throw new Error("ENOENT");
    if (request.op === "stat") {
      return { path: request.path, size: held.length, modified: 1, isDirectory: false };
    }
    const offset = request.offset ?? 0;
    return held.slice(offset, offset + (request.length ?? held.length));
  }) as AgentBridge["file"],
});

const leave: (() => void)[] = [];
let service: AgentService;

function open(bytes: Uint8Array, pane: "a" | "b" = "a", name = "front.bin") {
  openInPane(pane, {
    name,
    size: bytes.length,
    lastModified: 0,
    source: new Blob([bytes.slice()]),
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
  let json: Json | undefined;
  try {
    json = isError ? undefined : (parseJson(text) as Json);
  } catch {
    json = undefined;
  }
  return { isError, text, json };
}

/** A background document made of `bytes`. */
async function background(bytes: Uint8Array, name = "other.bin"): Promise<string> {
  files.set(`/dumps/${name}`, bytes);
  const opened = await call("open_dump", { path: `/dumps/${name}` });
  return member(opened.json, "document") as string;
}

const runsText = (answer: Json | undefined): string[] =>
  ((member(answer, "runs") as Json[] | undefined) ?? []).map(
    (run) =>
      `${member(run, "start")}–${member(run, "end")}:${jsonText(member(run, "differing_bytes"))}`
  );

const zeros = (size: number, fill = 0) => new Uint8Array(size).fill(fill);

beforeEach(() => {
  navigationHistory.removeAll();
  files.clear();
  // No modules: nothing places a run in a structure, and a file is one area.
  service = new AgentService(bridge(), () => []);
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

describe("the pure parts", () => {
  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testRunsMergeAcrossAtMostTheGap
  it("merges runs across at most the gap", () => {
    const differing = [
      { start: 0, end: 2 },
      { start: 4, end: 5 },
      { start: 9, end: 10 },
    ];
    expect(runsOf(differing, 2).map((one) => [one.start, one.end])).toEqual([
      [0, 5],
      [9, 10],
    ]);
    expect(runsOf(differing, 4).map((one) => [one.start, one.end])).toEqual([[0, 10]]);
    expect(runsOf(differing, 4)[0]?.differing).toBe(4);
    expect(runsOf(differing, 0)).toHaveLength(3);
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testADividedAreaKeepsItsGaps
  it("keeps the gaps of an area a finer one divides", () => {
    const region: ToolAgentPlace = {
      kind: "uefi",
      id: "0.1",
      name: "ME region",
      range: { start: 0x1000, end: 0x6000 },
    };
    const finer: ToolAgentPlace[] = [
      { kind: "me", id: "2.1", name: "Boot 1", range: { start: 0x2000, end: 0x3000 } },
      { kind: "me", id: "2.0", name: "Data", range: { start: 0x3000, end: 0x4000 } },
      { kind: "me", id: "9", name: "Elsewhere", range: { start: 0x7000, end: 0x8000 } },
    ];
    const pieces = divided(region, finer);
    expect(pieces.map((one) => one.name)).toEqual(["ME region", "Boot 1", "Data", "ME region"]);
    expect(pieces.map((one) => [one.range?.start, one.range?.end])).toEqual([
      [0x1000, 0x2000],
      [0x2000, 0x3000],
      [0x3000, 0x4000],
      [0x4000, 0x6000],
    ]);
    expect(divided(region, [])).toEqual([region]);
  });
});

describe("the tools", () => {
  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testTheDiffToolsAreListed
  it("are listed with their annotations", () => {
    const tools = new Map(service.allTools().map((tool) => [tool.name, tool]));
    expect(tools.get("diff")?.annotations.readOnly).toBe(true);
    expect(tools.get("compare")?.annotations.readOnly).toBe(false);
    expect(tools.get("reveal_diff")?.annotations.idempotent).toBe(true);
    expect(member(tools.get("diff")?.inputSchema, "required")).toEqual(["against"]);
    expect(tools.get("find_bytes")?.annotations.readOnly).toBe(true);
    expect(tools.get("open_part")?.annotations.readOnly).toBe(false);
  });
});

describe("diff", () => {
  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testIdenticalFilesHaveNoRuns
  it("has no runs for identical files", async () => {
    open(zeros(0x3000, 7));
    const other = await background(zeros(0x3000, 7));
    const answer = (await call("diff", { against: other, structure: "none" })).json;
    expect(member(answer, "runs")).toEqual([]);
    expect(member(answer, "totals")).toEqual({ runs: 0, differing_bytes: 0 });
    expect(member(answer, "next")).toBeNull();
    expect(member(answer, "tail")).toBeUndefined();
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testRunsAreMergedAcrossTheGapAndCounted
  it("merges runs across the gap and counts them, across a chunk boundary", async () => {
    const bytes = zeros(0x20_0010);
    open(bytes);
    const changed = bytes.slice();
    changed[0] = 1;
    changed[0x10_0000 - 1] = 1;
    changed[0x10_0000 + 4] = 1;
    changed[changed.length - 1] = 1;
    const other = await background(changed);

    const merged = (await call("diff", { against: other, structure: "none" })).json;
    expect(runsText(merged)).toEqual(["0x0–0x1:1", "0xFFFFF–0x100005:2", "0x20000F–0x200010:1"]);
    expect(member(merged, "totals")).toEqual({ runs: 3, differing_bytes: 4 });
    expect(member((member(merged, "runs") as Json[])[1], "length")).toBe("0x6");

    const apart = (await call("diff", { against: other, structure: "none", merge_gap: 3 })).json;
    expect(member(member(apart, "totals"), "runs")).toBe(4);
    const none = (await call("diff", { against: other, structure: "none", merge_gap: 0 })).json;
    expect(member(member(none, "totals"), "runs")).toBe(4);
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testARangeIsComparedAlone
  it("compares a range alone", async () => {
    const bytes = zeros(0x100);
    open(bytes);
    const changed = bytes.slice();
    changed[0x10] = 1;
    changed[0x80] = 1;
    const other = await background(changed);
    const answer = (
      await call("diff", { against: other, structure: "none", offset: "0x40", end: "0x100" })
    ).json;
    expect(runsText(answer)).toEqual(["0x80–0x81:1"]);
    expect(member(member(answer, "range"), "start")).toBe("0x40");
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testTheLongerFilesTailIsReportedApart
  it("reports the longer file's tail apart", async () => {
    open(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    const other = await background(Uint8Array.from([1, 2, 9, 4]));
    const answer = (await call("diff", { against: other, structure: "none" })).json;
    expect(runsText(answer)).toEqual(["0x2–0x3:1"]);
    expect(member(answer, "tail")).toEqual({ in: "document", start: "0x4", end: "0x6" });
    expect(member(answer, "truncated_at")).toBe("0x4");
    const past = await call("diff", { against: other, end: "0x6" });
    expect(past.text).toBe(
      "`end` 0x6 is past the end of the shorter document, which is 0x4 bytes long."
    );
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testWrongArgumentsAreRefused
  it("refuses the same document and a backwards range", async () => {
    open(Uint8Array.from([1, 2, 3, 4]));
    const other = await background(Uint8Array.from([1, 2, 3, 4]));
    expect((await call("diff", { against: "d1" })).text).toBe(
      "`document` and `against` are the same document, d1."
    );
    expect((await call("diff", { against: other, offset: "0x3", end: "0x2" })).text).toBe(
      "`offset` 0x3 is not below `end` 0x2."
    );
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testPagesAddUpAndACursorDiesWithAnEdit
  it("pages that add up to the totals, and a cursor that dies with an edit", async () => {
    const bytes = zeros(0x100);
    open(bytes);
    const changed = bytes.slice();
    for (let index = 0; index < 0x100; index += 0x20) changed[index] = 1;
    const other = await background(changed);

    const seen: string[] = [];
    let after: Json | undefined;
    do {
      const page = (
        await call("diff", {
          against: other,
          structure: "none",
          limit: 3,
          ...(after === undefined ? {} : { after }),
        })
      ).json;
      expect(member(member(page, "totals"), "runs")).toBe(8);
      seen.push(...runsText(page));
      const next = member(page, "next");
      after = next === null ? undefined : next;
    } while (after !== undefined);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);

    const first = (await call("diff", { against: other, structure: "none", limit: 3 })).json;
    await paneState("a")?.document.overwrite(0x40, Uint8Array.of(1));
    const stale = await call("diff", {
      against: other,
      structure: "none",
      limit: 3,
      after: member(first, "next") ?? null,
    });
    expect(stale.text).toBe(
      "A document changed since that page, or the range or `merge_gap` did; ask again without `after`."
    );
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testAPageStopsAtTheSizeBoundAndGoesOn
  it("stops a page at the size bound and goes on, every run once", async () => {
    const bytes = zeros(0x2000);
    open(bytes);
    const changed = bytes.slice();
    for (let index = 0; index < 0x2000; index += 2) changed[index] = 1;
    const other = await background(changed);

    const seen: string[] = [];
    let after: Json | undefined;
    let pages = 0;
    do {
      const answer = await call("diff", {
        against: other,
        merge_gap: 0,
        limit: 1000,
        ...(after === undefined ? {} : { after }),
      });
      expect(answer.isError, answer.text).toBe(false);
      expect(answer.text.length).toBeLessThanOrEqual(24 << 10);
      const page = answer.json;
      expect(member(member(page, "totals"), "runs")).toBe(0x1000);
      const got = runsText(page);
      expect(got.length).toBeLessThan(1000);
      seen.push(...got);
      const next = member(page, "next");
      after = next === null ? undefined : next;
      expect(member(page, "truncated")).toBe(after === undefined ? undefined : "size");
      pages += 1;
    } while (after !== undefined);
    expect(seen).toHaveLength(0x1000);
    expect(new Set(seen).size).toBe(0x1000);
    expect(pages).toBeGreaterThan(4);
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testAFileWithNoStructureIsOneArea
  it("takes a file no module knows as one area", async () => {
    open(zeros(0x200, 0x55));
    const changed = zeros(0x200, 0x55);
    changed[0x100] = 0;
    const other = await background(changed);
    const summary = (await call("diff", { against: other, summary: true })).json;
    const areas = member(summary, "areas") as Json[];
    expect(areas).toHaveLength(1);
    expect(member(areas[0], "end")).toBe("0x200");
    expect(member(areas[0], "differing_bytes")).toBe(1);
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testASurveyComparesAFolderWithOneDump
  it("is surveyed over a folder of dumps against one", async () => {
    const bytes = zeros(0x40);
    open(bytes);
    files.set("/dumps/same.bin", bytes.slice());
    const changed = bytes.slice();
    changed[3] = 1;
    files.set("/dumps/changed.bin", changed);
    const survey = (
      await call("survey", {
        paths: ["/dumps/same.bin", "/dumps/changed.bin"],
        tool: "diff",
        arguments: { against: "d1", structure: "none" },
        group_by: "totals.runs",
      })
    ).json;
    const groups = new Map(
      (member(survey, "groups") as Json[]).map((one) => [jsonText(member(one, "value")), one])
    );
    expect(member(groups.get("1"), "files")).toEqual(["changed.bin"]);
    expect(member(groups.get("0"), "files")).toEqual(["same.bin"]);
  });
});

describe("compare and reveal_diff", () => {
  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testThePairIsShownAndWalked
  it("puts a file alone in the window beside the other, in the free pane", async () => {
    const bytes = zeros(0x400);
    open(bytes);
    const changed = bytes.slice();
    changed[0x100] = 1;
    const other = await background(changed);

    const result = await call("compare", { against: other });
    expect(result.isError, result.text).toBe(false);
    const shown = result.json;
    expect(member(shown, "a")).toBe("d1");
    expect(paneState("b")?.name).toBe("other.bin");
    expect(service.desk.background.entries).toEqual([]);
    const again = (
      await call("compare", {
        document: member(shown, "a") as string,
        against: member(shown, "b") as string,
      })
    ).json;
    expect(member(again, "was_shown")).toBe(true);
  });

  it("never replaces a file the window holds", async () => {
    open(zeros(0x10));
    open(zeros(0x10), "b", "second.bin");
    const other = await background(zeros(0x10));
    const refused = await call("compare", { against: other });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/Both panes of the window hold files/);
  });

  // @upstream ByteRipperTests/AgentDiffToolsTests.swift#AgentDiffToolsTests.testRevealDiffNeedsAPair
  it("needs a pair to walk", async () => {
    open(Uint8Array.from([0, 1]));
    expect((await call("reveal_diff")).text).toBe(
      "d1 is not one of a pair shown side by side. `compare` shows it beside another."
    );
  });
});

describe("find_bytes", () => {
  const starts = (answer: Json | undefined) =>
    ((member(answer, "matches") as Json[] | undefined) ?? []).map((one) => member(one, "start"));

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testTextIsFoundAsASCIIAndAsUTF16AndBytesWithHoles
  it("finds text as ASCII and UTF-16, and bytes with holes", async () => {
    const bytes = zeros(0x400);
    bytes.set(new TextEncoder().encode("Acer"), 0x10);
    bytes.set([0x41, 0, 0x43, 0, 0x45, 0, 0x52, 0], 0x41);
    bytes.set([0x24, 0x44, 0x4d, 0x49], 0x200);
    open(bytes);

    const both = (await call("find_bytes", { text: "acer", ignore_case: true, context: 4 })).json;
    expect(member(both, "total")).toBe(2);
    expect(starts(both)).toEqual(["0x10", "0x41"]);
    const matches = member(both, "matches") as Json[];
    expect(matches.map((one) => member(one, "encoding"))).toEqual(["ascii", "utf16le"]);
    expect(member(member(matches[0], "preview"), "hex")).toBe(
      "00 00 00 00 41 63 65 72 00 00 00 00"
    );
    expect(member(member(matches[0], "preview"), "before")).toBe(4);
    expect(member(both, "next")).toBeNull();

    expect(member((await call("find_bytes", { text: "acer" })).json, "total")).toBe(0);
    expect(starts((await call("find_bytes", { text: "ACER", encoding: "utf16le" })).json)).toEqual([
      "0x41",
    ]);
    expect(starts((await call("find_bytes", { hex: "24 ?? 4D 49" })).json)).toEqual(["0x200"]);
    expect(
      member(
        (await call("find_bytes", { text: "Acer", encoding: "ascii", offset: "0x11" })).json,
        "total"
      )
    ).toBe(0);
  });

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testManyMatchesComeInPagesWithAnExactTotal
  it("comes in pages under the bound with an exact total", async () => {
    open(zeros(0x2000, 0xff));
    const plain = await call("find_bytes", { hex: "FF FF", limit: 1000 });
    expect(member(plain.json, "total")).toBe(0x1000);
    expect(member(plain.json, "truncated")).toBe("size");
    expect(plain.text.length).toBeLessThanOrEqual(24 << 10);
    const overlapping = (await call("find_bytes", { hex: "FF FF", overlapping: true, limit: 1 }))
      .json;
    expect(member(overlapping, "total")).toBe(0x1fff);

    let seen = 0;
    let after: Json | undefined;
    do {
      const page = (
        await call("find_bytes", {
          hex: "FF FF",
          limit: 1000,
          ...(after === undefined ? {} : { after }),
        })
      ).json;
      seen += ((member(page, "matches") as Json[] | undefined) ?? []).length;
      const next = member(page, "next");
      after = next === null ? undefined : next;
    } while (after !== undefined);
    expect(seen).toBe(0x1000);
  });

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testAPatternThatCannotBeSearchedIsRefused
  it("refuses a pattern that cannot be searched", async () => {
    open(Uint8Array.from([1, 2, 3, 4]));
    expect((await call("find_bytes")).text).toBe("Give `text` or `hex`, one of them.");
    expect(
      (await call("find_bytes", { hex: "ABC" })).text.startsWith("`hex` is not a byte pattern.")
    ).toBe(true);
    expect((await call("find_bytes", { hex: "?? ??" })).isError).toBe(true);
    expect((await call("find_bytes", { text: "longer than the file" })).text).toBe(
      "The pattern is longer than the range searched."
    );
    expect(
      (await call("find_bytes", { hex: "01", end: "0x10" })).text.startsWith(
        "The range 0x0–0x10 is not inside d1"
      )
    ).toBe(true);
    expect((await call("find_bytes", { text: "é" })).text).toBe(
      '`text` is not ASCII; look for it with `encoding` "utf16le".'
    );
  });
});

describe("open_part", () => {
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testTwoStretchesOpenedAsPartsCompareFromZero
  it("opens two stretches as parts that compare from zero", async () => {
    const bytes = zeros(0x1000);
    for (let index = 0; index < 0x40; index++) {
      bytes[0x100 + index] = index;
      bytes[0x800 + index] = index;
    }
    bytes[0x800 + 0x10] = 0xee;
    bytes[0x800 + 0x11] = 0xee;
    open(bytes);
    const first = (await call("open_part", { offset: "0x100", length: "0x40", name: "One" })).json;
    const second = (await call("open_part", { document: "d1", offset: "0x800", length: "0x40" }))
      .json;
    expect(member(first, "parent")).toBe("d1");
    expect(member(first, "name")).toBe("One");
    expect(member(member(first, "source"), "start")).toBe("0x100");
    const one = member(first, "document") as string;
    const two = member(second, "document") as string;

    const documents = member((await call("documents")).json, "documents") as Json[];
    expect(documents.find((entry) => member(entry, "id") === one)).toMatchObject({ slot: "part" });
    const read = (await call("read", { document: one, offset: 0, length: 4, format: "u8" })).json;
    expect(member(read, "values")).toEqual(["0x00", "0x01", "0x02", "0x03"]);

    const diff = (await call("diff", { document: one, against: two, structure: "none" })).json;
    expect(member(member(diff, "totals"), "differing_bytes")).toBe(2);
    expect(member((member(diff, "runs") as Json[])[0], "start")).toBe("0x10");
  });

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testAPartNeedsItsParentOnScreenAndAPlace
  it("needs its parent on screen and a place", async () => {
    open(zeros(0x100));
    const other = await background(zeros(0x100, 1));
    const refused = await call("open_part", { document: other, offset: 0, length: 4 });
    expect(refused.text).toContain("Call `show`");
    expect(
      (await call("open_part", { document: "d1", offset: "0xF0", length: "0x20" })).isError
    ).toBe(true);
    expect((await call("open_part")).text).toBe("Give `offset` and `length`, or `node`.");
  });
});

describe("open_part, again", () => {
  const panelCount = () => partsOfA();
  const partsOfA = () =>
    Object.values(workspaceStore.getSnapshot().parts).filter((part) => part?.origin?.parent === "a")
      .length;

  // Asking again for a part that is open raises its panel, and answers with it: no copy beside it.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testAskingAgainForAnOpenPartReusesItsPanel
  it("raises a part that is already open instead of opening a copy", async () => {
    open(zeros(0x1000));
    const first = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    expect(member(first, "reused")).toBeUndefined();
    const again = (await call("open_part", { document: "d1", offset: "0x800", length: "0x100" }))
      .json;
    expect(member(again, "reused")).toBe(true);
    expect(member(again, "document")).toBe(member(first, "document"));
    expect(panelCount()).toBe(1);

    const other = (await call("open_part", { document: "d1", offset: "0x900", length: "0x100" }))
      .json;
    expect(member(other, "reused")).toBeUndefined();
    expect(member(other, "document")).not.toBe(member(first, "document"));
    expect(panelCount()).toBe(2);
  });

  // The answer says whether the part has a tool panel, and how to open one on it.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeNamesItsDecodedCounterpartAndTheOtherWayRound
  it("says the part has no tool panel yet, and how to open one", async () => {
    open(zeros(0x1000));
    const opened = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    expect(member(opened, "tool_panel")).toBeNull();
    expect(String(member(opened, "next"))).toContain("open_panel");
  });

  // An argument `open_part` does not take is refused, not dropped.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testALENVBlockOpenedAsItIsSaysHowToDecodeIt
  it("refuses an argument it does not take, saying what was meant", async () => {
    open(zeros(0x1000));
    const refused = await call("open_part", { node: "0.1", decoded: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Perhaps `part: "decoded"`');
    expect(partsOfA()).toBe(0);
  });

  // `documents` says what a part's bytes are to the file's.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testADecompressedPartIsAFileToEveryTool
  it("lists whether a part keeps the file's addresses", async () => {
    open(zeros(0x1000));
    const opened = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const documents = member((await call("documents")).json, "documents") as Json[];
    const entry = documents.find((one) => member(one, "id") === member(opened, "document"));
    expect(member(entry, "keeps_offsets")).toBe(true);
    expect(member(entry, "decoded")).toBeUndefined();
    expect(member(entry, "part_of")).toBe("d1");
  });
});

describe("a call that names the parent while the focus is on its part", () => {
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeNamesItsDecodedCounterpartAndTheOtherWayRound
  it("answers with a focus_note, and says nothing when the call went where the focus is", async () => {
    open(zeros(0x1000));
    const opened = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const part = member(opened, "document") as string;
    const named = (await call("read", { document: "d1", offset: 0, length: 4 })).json;
    expect(String(member(named, "focus_note"))).toContain(`a part of d1`);
    const there = (await call("read", { document: part, offset: 0, length: 4 })).json;
    expect(member(there, "focus_note")).toBeUndefined();
    const bare = (await call("read", { offset: 0, length: 4 })).json;
    expect(member(bare, "focus_note")).toBeUndefined();
  });
});

describe("finding", () => {
  // A finding in a part that keeps the file's addresses lands on the same bytes of the file.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testAFindingInAPartLeadsToTheSameBytesOfTheFile
  it("in a part leads to the same bytes of the file", async () => {
    open(zeros(0x1000));
    const opened = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const finding = (
      await call("finding", {
        document: member(opened, "document") as string,
        offset: "0x10",
        length: 4,
        text: "t",
      })
    ).json;
    expect(member(member(finding, "range"), "start")).toBe("0x810");
    expect(member(member(finding, "range"), "end")).toBe("0x814");
    expect(member(member(finding, "from_part"), "exact")).toBe(true);
    expect(member(member(finding, "from_part"), "range")).toMatchObject({
      start: "0x10",
      end: "0x14",
    });
  });
});
