import { describe, expect, it } from "vitest";
import { type Json, member } from "@/core/agent/json";
import { agentAnnotationStore, allAnnotations, drawnIn } from "@/state/agent/agentAnnotationStore";
import { agentShell } from "@/state/agent/agentShell";
import { closeFirmware, firmwareFor, firmwareNodeAt } from "@/state/firmwareStore";
import { surfaceOf } from "@/state/paneId";
import { partsLinkedTo } from "@/state/partUpdate";
import { setUpFirmwareAgent } from "@/state/testing/firmwareAgent";
import { compressedTestImage, LENOVO } from "@/state/testing/firmwareImages";
import { activate, sessionOn, toolController } from "@/state/toolController";
import { registerUefiPanelLink } from "@/state/uefiPanelLinks";
import { bringPaneForward, setActivePane, workspaceStore } from "@/state/workspaceStore";
import type { WireContentMatch } from "@/workers/protocol";

/**
 * Annotations on places a firmware image holds encoded — in what a compressed section
 * decompresses to, in a LENV block stored encoded — over the real parser and decompressor
 * (`firmwareAgent`).
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests
 * @upstream-differs going to such a place opens UEFI Structure's panel link, which is the React
 * panel's: what is checked here is where the place is kept and where it is drawn
 */

const UEFI_STRUCTURE = "dev.maxik.tool.uefi-structure";

const agent = setUpFirmwareAgent();
const { call, open } = agent;

async function answer(name: string, args: { [key: string]: Json } = {}): Promise<Json> {
  const answered = await call(name, args);
  if (answered.isError) throw new Error(`${name} was refused: ${answered.text}`);
  return answered.json as Json;
}

/** The first match of the model number in the image's contents, compressed sections included. */
async function modelMatch(): Promise<Json> {
  const found = await answer("find_bytes", { node: "root", text: "GH51G" });
  const match = (member(found, "matches") as Json[])[0];
  if (match === undefined) throw new Error(`no match: ${JSON.stringify(found)}`);
  return match;
}

describe("an annotation in decoded bytes", () => {
  // A match `find_bytes` found in what a compressed section decompresses to is annotated as
  // `node` and `node_offset`: the place is kept in those bytes, not drawn over the whole section,
  // and drawn in the panel of them.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAPlaceInDecompressedBytesIsShownInAPanelOfThem
  it("is kept in decompressed bytes, and drawn in a panel of them", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const match = await modelMatch();
    const node = member(member(match, "node"), "id") as string;
    const made = await answer("annotate", {
      node,
      offset: member(match, "node_offset") as Json,
      length: 5,
      title: "Model",
    });
    // No bytes of the file.
    expect(member(made, "range")).toBeUndefined();
    const decoded = member(made, "decoded");
    expect(member(decoded, "codecs")).toEqual(["LZMA"]);
    // The section the panel opens.
    expect(member(decoded, "node")).toBe(member(match, "section"));
    expect(member(member(decoded, "range"), "start")).toBe(member(match, "buffer_start"));
    expect(member(member(decoded, "range"), "end")).toBe(member(match, "buffer_end"));
    // The compressed section is not outlined.
    expect(drawnIn("a")).toEqual([]);

    await answer("open_part", { node: member(match, "section") as Json, part: "decompressed" });
    const part = partsLinkedTo("a")[0];
    if (part === undefined) throw new Error("the part should be open");
    const start = Number.parseInt(member(match, "buffer_start") as string, 16);
    expect(drawnIn(part).map((one) => [one.start, one.end])).toEqual([[start, start + 5]]);
  });

  // Annotated in a part of the decompressed bytes, the place stays in them.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAPlaceInAPartOfDecompressedBytesStaysThere
  it("made in a part of decompressed bytes stays there", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const match = await modelMatch();
    const opened = await answer("open_part", {
      node: member(match, "section") as Json,
      part: "decompressed",
    });
    const made = await answer("annotate", {
      document: member(opened, "document") as Json,
      offset: member(match, "buffer_start") as Json,
      length: 5,
      title: "Model",
    });
    expect(member(member(made, "from_part"), "decoded")).toBe(true);
    // Not the whole section in the file.
    expect(member(made, "range")).toBeUndefined();
    expect(member(member(member(made, "decoded"), "range"), "start")).toBe(
      member(match, "buffer_start")
    );
    expect(member(member(made, "decoded"), "codecs")).toEqual(["LZMA"]);
    // The file's annotation.
    expect(member(made, "file")).toBe("front.bin");
  });

  // A place given by its addresses in a LENV block stored encoded — as a survey's answers give
  // it — is read decoded: the card wears the XOR badge, and the file's bytes are outlined too.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAnAddressInAnEncodedLENVBlockIsReadDecoded
  // @upstream-differs the same file opened by path is the shell's, which this harness has no disk
  // for
  it("at an address in an encoded LENV block is read decoded", async () => {
    open(LENOVO.make());
    const made = await answer("annotate", {
      offset: `0x${LENOVO.serialInBlock2.toString(16)}`,
      length: 8,
      title: "Serial",
    });
    expect(member(member(made, "decoded"), "codecs")).toEqual(["XOR 77"]);
    expect(member(made, "range")).toBeDefined();
  });

  // A row of UEFI Structure: Add Annotation… puts the person's note on the node — one inside a
  // compressed section in the bytes it decompresses to, with the codec its card shows.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testThePersonsNoteIsMadeOnANodeOfTheTree
  // @upstream-differs the row's menu is the React panel's; the note is made as the menu makes it
  it("of the person on a node of the tree", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const node = member(member(await modelMatch(), "node"), "id") as string;
    await agent.service.annotationTools.addNodeNote("Model", "", "a", node);
    const note = allAnnotations()[0];
    expect(note?.author).toBe("person");
    expect(note?.node).toBe(node);
    // Kept in the decompressed bytes.
    expect(note?.decoded?.codecs).toEqual(["LZMA"]);
    // The person's own is never unseen.
    expect(agentAnnotationStore.getSnapshot().unseen.size).toBe(0);
  });

  // A place in the dump that is a node of the tree opens UEFI Structure on the pane, at the node
  // holding it, as a click on a Contents match goes there.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAPlaceOnANodeOpensUEFIStructureAtIt
  // @upstream-differs the panel's link stands in for the React panel, which is not mounted here
  it("on a node opens UEFI Structure at it", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    await answer("annotate", { offset: "0x10", length: 4, title: "Header" });
    const went: WireContentMatch[] = [];
    const gone = registerUefiPanelLink("a", {
      goTo: async (match) => {
        went.push(match);
      },
      open: async () => undefined,
    });
    try {
      await agent.service.annotationTools.show("a1");
    } finally {
      gone();
    }
    expect(sessionOn(toolController.getSnapshot(), surfaceOf("a")).activeIdentifier).toBe(
      "dev.maxik.tool.uefi-structure"
    );
    expect(went.map((one) => one.range)).toEqual([[0x10, 0x14]]);
  });

  // In a comparison whose other pane is the active one, going to a note on a file makes that
  // file's pane active and takes UEFI Structure, open on the other file, to the note's file.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testAPlaceInTheInactivePaneOfAComparisonActivatesItAndMovesUEFIStructure
  it("in the inactive pane of a comparison activates it and moves UEFI Structure there", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    open(compressedTestImage("OTHER-MODEL-XY12Z"), "b", "other.bin");
    setActivePane("a");
    activate(UEFI_STRUCTURE, surfaceOf("a"));
    expect(sessionOn(toolController.getSnapshot(), surfaceOf("a")).boundPane).toBe("a");
    await answer("annotate", { document: "d2", offset: "0x28", length: 4, title: "Signature" });
    const went: WireContentMatch[] = [];
    agentShell.bringForward = bringPaneForward;
    const gone = registerUefiPanelLink("b", {
      goTo: async (match) => {
        went.push(match);
      },
      open: async () => undefined,
    });
    try {
      await agent.service.annotationTools.show("a1");
    } finally {
      gone();
      agentShell.bringForward = undefined;
    }
    expect(workspaceStore.getSnapshot().activePane, "the note's pane is the active one").toBe("b");
    const session = sessionOn(toolController.getSnapshot(), surfaceOf("b"));
    expect(session.activeIdentifier).toBe(UEFI_STRUCTURE);
    expect(session.boundPane, "UEFI Structure reads the note's file").toBe("b");
    expect(went.map((one) => one.range)).toEqual([[0x28, 0x2c]]);
  });

  // A file whose tree is not read yet — just opened to show the place — is read first, and the
  // branches down to the section the place is in are opened, before the place goes to UEFI
  // Structure: the route is the tree's to choose, and chosen before it the file opened with no
  // panel of the place.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testShowingAPlaceInAFileNotOpenWaitsForItsTree
  // @upstream-differs the file's tree is dropped in place of opening a file not open, which the
  // harness has no disk for; the panel's link stands in for the React panel
  it("in decoded bytes waits for the tree and its branches before it opens", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const match = await modelMatch();
    await answer("annotate", {
      node: member(member(match, "node"), "id") as string,
      offset: member(match, "node_offset") as Json,
      length: 5,
      title: "Model",
    });
    closeFirmware("a");
    expect(firmwareFor("a")).toBeUndefined();

    let section: readonly number[] | undefined;
    let foundThere = false;
    const gone = registerUefiPanelLink("a", {
      goTo: async () => undefined,
      open: async (asked: WireContentMatch) => {
        section = asked.section;
        const held = firmwareFor("a");
        foundThere =
          held?.status === "ready" &&
          asked.section !== undefined &&
          firmwareNodeAt(held.roots ?? [], asked.section) !== undefined;
      },
    });
    try {
      await agent.service.annotationTools.show("a1");
    } finally {
      gone();
    }
    expect(section).toBeDefined();
    // The tree was read, and the section reached, by the time the panel was asked.
    expect(foundThere).toBe(true);
  });
});
