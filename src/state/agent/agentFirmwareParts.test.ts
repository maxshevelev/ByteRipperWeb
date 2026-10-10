import { describe, expect, it } from "vitest";
import { type Json, member } from "@/core/agent/json";
import { surfaceOf } from "@/state/paneId";
import { partsLinkedTo } from "@/state/partUpdate";
import { setUpFirmwareAgent } from "@/state/testing/firmwareAgent";
import { compressedTestImage, LENOVO } from "@/state/testing/firmwareImages";
import { sessionOn, toolController } from "@/state/toolController";
import { paneState, workspaceStore } from "@/state/workspaceStore";

/**
 * Parts of a firmware image opened and put back by an agent — a compressed section's body, a
 * Lenovo LENV block decoded — over the real parser, compressor and rebuild (`firmwareAgent`).
 *
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests
 * @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests
 */

const agent = setUpFirmwareAgent();
const { call, open } = agent;

/** The id of the image's compressed section, as `uefi_find` lists it. */
async function compressedSection(): Promise<Json> {
  const found = await call("uefi_find", { type: "Section", limit: 50 });
  const section = (member(found.json, "matches") as Json[]).find(
    (one) => member(one, "subtype") === "Compressed section"
  );
  if (section === undefined) throw new Error(`no compressed section in ${found.text}`);
  return section;
}

/** The id of the innermost node over block 2's serial number. */
async function serialEntry(): Promise<string> {
  const at = await call("uefi_at", { offset: `0x${LENOVO.serialInBlock2.toString(16)}` });
  const id = member((member(at.json, "chain") as Json[]).at(-1), "id");
  if (typeof id !== "string") throw new Error(`no node at the serial: ${at.text}`);
  return id;
}

describe("open_part, decompressed", () => {
  // What a compressed section decompresses to opens as a part, in a panel over the same window —
  // not a tab — and goes back compressed.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testACompressedSectionOpensDecompressedInAPanel
  it("opens what a compressed section decompresses to, in a panel over the same window", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    expect(member(opened, "in_compressed")).toBe(true);
    expect(member(opened, "parent")).toBe("d1");
    expect(partsLinkedTo("a")).toHaveLength(1);
    const part = member(opened, "document") as string;
    const found = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    expect(member(found, "total")).toBe(1);

    const plain = await call("open_part", { node: section, part: "decoded" });
    expect(plain.isError).toBe(true);
  });

  // `size` is the length of what the section decompresses to, known before the part opens — and
  // in the answer that raises the part already open.
  // Upstream's `PartPlan.size` is `found.reader.count` in both answers.
  it("says the decompressed size, the second time too", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    const part = member(opened, "document") as string;
    const size = paneState(partsLinkedTo("a")[0] ?? "a")?.document.size ?? 0;
    expect(size).toBe(4 + 18 + 12);
    expect(member(opened, "size")).toBe(`0x${size.toString(16).toUpperCase()}`);

    // The focus is on the part now: the node is the parent's.
    const again = (await call("open_part", { document: "d1", node: section, part: "decompressed" }))
      .json;
    expect(member(again, "reused")).toBe(true);
    expect(member(again, "document")).toBe(part);
    expect(member(again, "size")).toBe(member(opened, "size"));
    expect(partsLinkedTo("a")).toHaveLength(1);
  });

  // A section whose stream is damaged has nothing under it to open: refused, with nothing put in
  // front of the person and no panel.
  it("refuses a section whose stream is damaged, before anything opens", async () => {
    const image = compressedTestImage("SECRET-MODEL-GH51G");
    // The LZMA stream's properties byte, past the largest a stream can have (225 and up).
    image[0x60 + 9] = 0xff;
    open(image);
    const section = member(await compressedSection(), "id") as string;
    const refused = await call("open_part", { node: section, part: "decompressed" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(
      `Node ${section} is not a compressed section; part "decompressed" is a compressed section's.`
    );
    expect(workspaceStore.getSnapshot().alert).toBeUndefined();
    expect(partsLinkedTo("a")).toHaveLength(0);
  });

  // The section is decompressed where the tree is before anything opens, as upstream's
  // `UEFIAgentNodeData.bytes` does: when the tree has no buffer to give, its refusal is the
  // agent's answer — not an alert put in front of the person and "The part could not be opened."
  it("is refused in the tree's words when the tree cannot decompress it", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    agent.answerInstead((request) => {
      const values = request.values as { [key: string]: unknown } | undefined;
      return request.kind === "agentUefi" &&
        request.query === "uefi_node_data" &&
        values?.part === "decompressed"
        ? {
            kind: "agentUefi",
            id: request.id,
            error: `Section ${section} could not be decompressed.`,
          }
        : undefined;
    });
    const refused = await call("open_part", { node: section, part: "decompressed" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`Section ${section} could not be decompressed.`);
    expect(workspaceStore.getSnapshot().alert).toBeUndefined();
    expect(partsLinkedTo("a")).toHaveLength(0);
  });

  // A decompressed part is a file of its own to every tool: read, searched, its own UEFI tree —
  // and `documents` says what its bytes are. A finding in bytes the file holds only compressed
  // leads to the section they came out of.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testADecompressedPartIsAFileToEveryTool
  // @upstream-differs no `uefi_select` on the part's panel: the session it acts on is the mounted panel's, and no component is mounted here
  it("is a file of its own to every tool", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    const part = member(opened, "document") as string;

    const documents = (await call("documents")).json;
    const entry = (member(documents, "documents") as Json[]).find(
      (one) => member(one, "id") === part
    );
    expect(member(entry, "decoded")).toBe("LZMA");
    expect(member(entry, "keeps_offsets")).toBe(false);

    const found = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    expect(member(found, "total")).toBe(1);
    const raw = (await call("uefi_tree", { document: part })).json;
    expect(member((member(raw, "children") as Json[])[0], "name")).toBe("Raw");

    // Its own tool panel; the parent's is untouched.
    const panel = (await call("open_panel", { document: part, module: "uefi-structure" })).json;
    expect(member(panel, "document")).toBe(part);
    const partPane = partsLinkedTo("a")[0];
    if (partPane === undefined) throw new Error("the part should be open");
    const tools = toolController.getSnapshot();
    expect(sessionOn(tools, surfaceOf(partPane)).activeIdentifier).toBe(
      "dev.maxik.tool.uefi-structure"
    );
    expect(surfaceOf(partPane)).not.toBe(surfaceOf("a"));
    expect(sessionOn(tools, surfaceOf("a")).activeIdentifier).toBeUndefined();

    const finding = (await call("finding", { document: part, offset: "0x4", length: 4, text: "t" }))
      .json;
    expect(member(member(finding, "from_part"), "exact")).toBe(false);
    expect(member(member(finding, "range"), "start")).toBe(
      member(member(opened, "source"), "start")
    );
    expect(member(member(finding, "range"), "end")).toBe(member(member(opened, "source"), "end"));
  });
});

describe("open_part, decoded", () => {
  // A LENV block, or an entry in one, opens with its XOR encoding removed.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testALENVBlockOpensDecodedInAPanel
  it("opens a LENV block with its XOR encoding removed", async () => {
    open(LENOVO.make());
    const entry = await serialEntry();
    const opened = (await call("open_part", { node: entry, part: "decoded" })).json;
    expect(member(opened, "size")).toBe("0x1000");
    expect(partsLinkedTo("a")).toHaveLength(1);
    const part = member(opened, "document") as string;
    const read = (
      await call("read", { document: part, offset: "0x28", length: 8, format: "ascii" })
    ).json;
    expect(member(read, "text")).toBe("PF0TEST1");
    expect(member(opened, "part")).toBe("decoded");
    expect(member(opened, "hint")).toBeUndefined();
  });

  // A LENV block opened as it is says it is encoded and how to open it decoded; an argument
  // `open_part` does not take is refused, not dropped.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testALENVBlockOpenedAsItIsSaysHowToDecodeIt
  it("says, opened as it is, how to open it decoded", async () => {
    open(LENOVO.make());
    const entry = await serialEntry();
    const raw = (await call("open_part", { node: entry })).json;
    expect(member(raw, "part")).toBe("all");
    expect(String(member(raw, "hint"))).toContain('part: "decoded"');

    const refused = await call("open_part", { node: entry, decoded: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Perhaps `part: "decoded"`');
  });
});

describe("open_part, asked again", () => {
  // The part already open is found by the name it is given when the call names none, as upstream
  // finds it: a call that names the same bytes under a name of its own raises that panel rather
  // than opening a copy beside it.
  it("is found by the name it would be given, whatever the call names it", async () => {
    open(new Uint8Array(0x1000));
    const first = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const named = (
      await call("open_part", { document: "d1", offset: "0x800", length: "0x100", name: "Mine" })
    ).json;
    expect(member(named, "reused")).toBe(true);
    expect(member(named, "document")).toBe(member(first, "document"));
    expect(partsLinkedTo("a")).toHaveLength(1);
  });
});

describe("update_in_parent, decompressed", () => {
  // A decompressed body goes back compressed: the file then holds the change only inside the
  // section, and the section reads it.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testADecompressedPartGoesBackCompressed
  it("puts a decompressed part back compressed", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    agent.service.setEditsAllowed(true);
    const section = member(await compressedSection(), "id") as string;
    const part = member(
      (await call("open_part", { node: section, part: "decompressed" })).json,
      "document"
    ) as string;
    const at = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    const start = member((member(at, "matches") as Json[])[0], "start") as string;
    await call("write", { document: part, offset: start, bytes: "58593939 5A", label: "t" });

    const updated = await call("update_in_parent", { document: part });
    expect(member(updated.json, "updated"), updated.text).toBe(true);
    expect(paneState("a")?.document.isDirty).toBe(true);
    const inFile = (await call("find_bytes", { document: "d1", text: "XY99Z" })).json;
    expect(member(inFile, "total")).toBe(0);
    const inSection = (await call("find_bytes", { document: "d1", node: section, text: "XY99Z" }))
      .json;
    expect(member(inSection, "total")).toBe(1);
  });
});
