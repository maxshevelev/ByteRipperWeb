import { describe, expect, it } from "vitest";
import { type Json, member } from "@/core/agent/json";
import { loadCatalogue } from "@/core/localization/bundledCatalogues";
import {
  appLanguage,
  forgetCatalogues,
  installCatalogue,
  L,
} from "@/core/localization/localization";
import { surfaceOf } from "@/state/paneId";
import { setUpFirmwareAgent } from "@/state/testing/firmwareAgent";
import { compressedTestImage, fitTestImage, uefiTestImage } from "@/state/testing/firmwareImages";
import { sessionOn, toolController } from "@/state/toolController";
import { paneState } from "@/state/workspaceStore";

/**
 * The module tools and the firmware queries of the find and edit tools, over the real parser
 * (`firmwareAgent`): what the tree says of a node, what a compressed section holds, the checksums
 * an agent puts right.
 *
 * @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests
 * @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests
 */

const agent = setUpFirmwareAgent();
const { call, open } = agent;

/** An answer that must have been one, as JSON. */
async function answer(name: string, args: { [key: string]: Json } = {}): Promise<Json> {
  const answered = await call(name, args);
  if (answered.isError || answered.json === undefined) {
    throw new Error(`${name} refused: ${answered.text}`);
  }
  return answered.json;
}

/** The id `uefi_find` gives the driver of `uefiTestImage`. */
async function driverID(): Promise<string> {
  const found = await answer("uefi_find", { name: "MyDriver", exact: true, type: "File" });
  const id = member((member(found, "matches") as Json[])[0], "id");
  if (typeof id !== "string") throw new Error(`no driver in ${JSON.stringify(found)}`);
  return id;
}

/** `length` bytes of pane A's document from `at`, as it now holds them. */
async function bytes(at: number, length: number): Promise<number[]> {
  const document = paneState("a")?.document;
  if (document === undefined) throw new Error("nothing open in A");
  return [...(await document.read(at, length))];
}

describe("the module tools", () => {
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testEveryModuleToolIsListedWithADocumentArgument
  it("are all listed, each UEFI one with a `document` argument", () => {
    const tools = agent.service.allTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "uefi_tree",
      "uefi_node",
      "uefi_find",
      "uefi_at",
      "uefi_select",
      "uefi_selection",
      "open_panel",
    ]) {
      expect(names).toContain(name);
    }
    for (const tool of tools.filter((one) => one.name.startsWith("uefi_"))) {
      expect(member(member(tool.inputSchema, "properties"), "document"), tool.name).toBeDefined();
    }
    // It changes what is on screen.
    expect(tools.find((one) => one.name === "uefi_select")?.annotations.readOnly).toBe(false);
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testTheTreeIsReadWithThePanelClosed
  it("read the tree with the panel closed, and leave it closed", async () => {
    open(uefiTestImage());
    const panel = () => sessionOn(toolController.getSnapshot(), surfaceOf("a")).activeIdentifier;
    expect(panel()).toBeUndefined();
    const top = await answer("uefi_tree", { depth: 3 });
    expect(member(top, "document")).toBe("d1");
    expect(JSON.stringify(top)).toContain('"name":"MyDriver"');
    // A question does not open the panel.
    expect(panel()).toBeUndefined();
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testFindNodeAndAtAgreeOnTheDriver
  it("agree on the driver: found, described and holding an address", async () => {
    open(uefiTestImage());
    const id = await driverID();

    const node = await answer("uefi_node", { node: id });
    expect(member(member(node, "node"), "name")).toBe("MyDriver");
    expect(member(member(node, "node"), "start")).toBe("0x48");
    expect((member(node, "path") as Json[]).at(-1)).toBe("MyDriver");
    const labels = (member(node, "fields") as Json[]).map((one) => member(one, "label"));
    expect(labels).toContain("GUID");

    const chain = member(await answer("uefi_at", { offset: "0x60" }), "chain") as Json[];
    // The driver holds 0x60, and the outermost comes first.
    expect(chain.some((one) => member(one, "id") === id)).toBe(true);
    expect(member(chain[0], "start")).toBe("0x0");
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testABadNodeIdSaysWhereIdsComeFrom
  it("say, for an id that is none, where ids come from", async () => {
    open(uefiTestImage());
    const refused = await call("uefi_node", { node: "volume" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("uefi_tree");
    const missing = await call("uefi_node", { node: "9.9.9" });
    expect(missing.isError).toBe(true);
    expect(missing.text.startsWith("No node 9.9.9"), missing.text).toBe(true);
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testAnUnknownModuleIsRefusedWithTheOnesThereAre
  it("refuse a module there is none of, naming the ones there are", async () => {
    open(uefiTestImage());
    const refused = await call("open_panel", { module: "nope" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("uefi-structure");
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testAnswersAreInEnglishWhateverTheWindowSpeaks
  it("answer in English whatever the window speaks", async () => {
    open(uefiTestImage());
    const id = await driverID();
    installCatalogue(await loadCatalogue("ru"));
    try {
      expect(appLanguage()).toBe("ru");
      // The window does speak Russian: the panel's own label for the row is not "Kind".
      expect(L("Kind")).not.toBe("Kind");
      const node = await answer("uefi_node", { node: id });
      const labels = (member(node, "fields") as Json[]).map((one) => member(one, "label"));
      expect(labels).toContain("Kind");
    } finally {
      forgetCatalogues();
    }
  });
});

describe("a compressed section, searched and read", () => {
  // What a compressed section holds is found in what it decompresses to, at addresses of that
  // buffer, and read back from it.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testACompressedSectionIsSearchedInWhatItDecompressesTo
  it("is searched in what it decompresses to", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const inFile = await answer("find_bytes", { text: "GH51G" });
    // The file holds it compressed.
    expect(member(inFile, "total")).toBe(0);

    const tree = await answer("uefi_find", { type: "Section", limit: 50 });
    const section = member(
      (member(tree, "matches") as Json[]).find(
        (one) => member(one, "subtype") === "Compressed section"
      ),
      "id"
    );
    if (typeof section !== "string") throw new Error(`no compressed section in ${tree}`);
    const found = await answer("find_bytes", { node: section, text: "GH51G" });
    expect(member(found, "decompressed")).toBe(true);
    expect(member(found, "total")).toBe(1);
    const match = (member(found, "matches") as Json[])[0];
    // No file address: the bytes are not in the file as such.
    expect(member(match, "start")).toBeUndefined();
    const at = member(match, "node_start");
    if (typeof at !== "string") throw new Error(`no node_start in ${JSON.stringify(match)}`);
    expect(member((member(match, "where") as Json[])[0], "name")).toBe("Raw");
    expect(member(member(found, "source"), "start")).toBeDefined();

    const read = await answer("uefi_node_data", {
      node: section,
      part: "decompressed",
      offset: at,
      length: 5,
      format: "ascii",
    });
    expect(member(read, "text")).toBe("GH51G");
    expect(member(read, "in_compressed")).toBe(true);
  });

  // A node of the file reads as `read` reads the same bytes; a node that is no compressed section
  // has nothing decompressed to read.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeOfTheFileReadsAsReadDoes
  it("reads, for a node of the file, as `read` does", async () => {
    open(uefiTestImage());
    const node = await answer("uefi_node_data", { node: "0", part: "all", length: 32 });
    expect(member(node, "file_start")).toBe("0x0");
    expect(member(node, "in_compressed")).toBe(false);
    const read = await answer("read", { offset: 0, length: 32 });
    expect(member(node, "rows")).toEqual(member(read, "rows"));
    const header = await call("uefi_node_data", { node: "0", part: "decompressed" });
    expect(header.isError).toBe(true);
    expect(header.text).toContain("is not a compressed section");
  });
});

describe("the checksums an agent puts right", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testAVolumeChecksumIsPutRightAsOneUndoStep
  it("puts a volume's right as one undo step, once editing is allowed", async () => {
    const good = uefiTestImage();
    const corrupt = good.slice();
    corrupt[0x32] = (corrupt[0x32] ?? 0) ^ 0xff;
    open(corrupt);

    const refused = await call("uefi_fix_checksum", { node: "0" });
    expect(refused.text.startsWith("Editing is switched off."), refused.text).toBe(true);

    agent.service.setEditsAllowed(true);
    const fixed = await answer("uefi_fix_checksum", { node: "0" });
    expect(await bytes(0x32, 2)).toEqual([...good.slice(0x32, 0x34)]);
    expect(member(fixed, "undo")).toBe("Agent: Fix Checksum");
    expect(paneState("a")?.document.undoHistory.undoLabel).toBe("Agent: Fix Checksum");

    const again = await call("uefi_fix_checksum", { node: "0" });
    expect(again.text).toBe("The checksums of 0 already check out; nothing to write.");
  });

  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testTheFITChecksumIsPutRight
  it("puts the FIT's right", async () => {
    open(fitTestImage(0x42));
    agent.service.setEditsAllowed(true);
    const before = await answer("fit_table");
    const should = member(member(before, "table"), "checksum_should_be");
    const start = member(member(before, "table"), "start");
    if (typeof should !== "string" || typeof start !== "string") {
      throw new Error(`no checksum to put right in ${JSON.stringify(before)}`);
    }

    const fixed = await answer("fit_fix_checksum");
    expect(member(fixed, "undo")).toBe("Agent: Fix FIT Checksum");
    const after = await answer("fit_table");
    expect(member(member(after, "table"), "checksum")).toBe(should);
    const problems = (member(after, "problems") as Json[] | undefined) ?? [];
    expect(problems.some((one) => member(one, "severity") === "error")).toBe(false);
    const offset = Number.parseInt(start.slice(2), 16) + 0x0f;
    expect((await bytes(offset, 1))[0]).toBe(Number.parseInt(should.slice(2), 16));

    const again = await call("fit_fix_checksum");
    expect(again.text).toBe("The FIT checksum is already correct; nothing to write.");
  });
});
