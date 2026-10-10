import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { compress } from "@/firmware/compression/firmwareCompression";
import * as Test from "@/firmware/testing/testImage";
import { guidBytes, guidFromText } from "@/firmware/uefi/efiGuid";
import {
  type Form,
  forms,
  type Hit,
  MAX_HITS_PER_FILE,
  refs,
  withoutInner,
} from "@/tools/uefi/agent/uefiAgentRefs";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * Who refers to an address or a GUID (`refs`): the forms an address is searched as, hits inside
 * longer hits left out, a GUID found in what a compressed section decompresses to, hits grouped by
 * file.
 *
 * @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests
 */

const GUID_TEXT = "8964FEDC-6FE7-4E1E-A55E-FF821D71FFCF";
const GUID = guidBytes(guidFromText(GUID_TEXT) as NonNullable<ReturnType<typeof guidFromText>>);

const args = (values: { [key: string]: Json }) => new AgentArguments(values);
const context = { contentVersion: 1 };

/**
 * A volume holding one file whose only section is LZMA-compressed, and in it a raw section with
 * `payload`: bytes the file holds only compressed.
 */
function compressedImage(payload: Uint8Array): Uint8Array {
  const raw = Test.section({
    type: 0x19,
    body: Uint8Array.from([...payload, ...new Array(12).fill(0)]),
  });
  const section = Test.compressionSection(0x02, compress(raw, { variant: "LZMA" }), raw.length);
  return Test.volume({
    length: 0x1000,
    files: [Test.sectionedFile({ sections: [section] })],
  });
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

describe("the forms", () => {
  // @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests.testAnAddressIsSearchedOnTheBusInTheFileAndInTheRegion
  it("searches an address on the bus, in the file and in the region", () => {
    const bios = { start: 0x600000, end: 0x1000000 };
    const made = forms(0x668000, false, bios, new Set(["bus", "file", "region"]));
    expect(made.forms.map((one) => one.name)).toEqual(["bus", "bus", "file", "region"]);
    expect(made.forms[0]?.bytes).toEqual([0x00, 0x80, 0x66, 0xff, 0, 0, 0, 0]);
    expect(made.forms[1]?.bytes).toEqual([0x00, 0x80, 0x66, 0xff]);
    expect(made.forms[2]?.bytes).toEqual([0x00, 0x80, 0x66, 0x00]);
    expect(made.forms[3]?.bytes).toEqual([0x00, 0x80, 0x06, 0x00]);

    const region = forms(0x68000, true, bios, new Set(["file"]));
    expect(region.forms.map((one) => one.bytes)).toEqual([[0x00, 0x80, 0x66, 0x00]]);

    // A BIOS-only image: the file and the region are one, searched once.
    const alone = forms(0x8000, false, { start: 0, end: 0x800000 }, new Set(["file", "region"]));
    expect(alone.forms.map((one) => one.name)).toEqual(["file"]);

    const tiny = forms(0x600010, false, bios, new Set(["region"]));
    expect(tiny.forms).toEqual([]);
    expect(tiny.skipped).toEqual(["region"]);
  });

  // @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests.testAHitInsideALongerFormsHitIsLeftOut
  it("leaves out a hit inside a longer form's hit", () => {
    const wanted: Form[] = [
      { name: "bus", bytes: [1, 2, 3, 4, 0, 0, 0, 0] },
      { name: "bus", bytes: [1, 2, 3, 4] },
    ];
    const hits: Hit[] = [
      { start: 0x10, end: 0x14, form: 1 },
      { start: 0x10, end: 0x18, form: 0 },
      { start: 0x40, end: 0x44, form: 1 },
    ];
    expect(withoutInner(hits, wanted).map((one) => [one.start, one.end])).toEqual([
      [0x10, 0x18],
      [0x40, 0x44],
    ]);
  });
});

describe("refs", () => {
  // @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests.testAGUIDIsFoundInTheFileAndInWhatASectionDecompressesTo
  it("finds a GUID in the file and in what a section decompresses to, each in its own group", async () => {
    const volume = compressedImage(Uint8Array.from([0xaa, 0xbb, ...GUID]));
    const image = new Uint8Array(volume.length + 0x1100).fill(0xff);
    image.set(volume, 0);
    image.set(GUID, volume.length + 0x40);
    const tree = agentTreeOver(image);

    const answer = await refs(tree, args({ guid: GUID_TEXT }), context);
    expect(member(answer, "total")).toBe(2);
    expect(member(answer, "files")).toBe(2);
    const groups = member(answer, "refs") as Json[];
    const raw = groups.find(
      (one) => member(one, "in_compressed") === false && member(one, "node") !== undefined
    );
    expect(member((member(raw ?? null, "hits") as Json[])[0] ?? null, "file_start")).toBe(
      hex(volume.length + 0x40)
    );
    const file = groups.find((one) => member(one, "file") !== undefined);
    const hit = (member(file ?? null, "hits") as Json[])[0] ?? null;
    expect(member(hit, "form")).toBe("guid");
    expect(member(hit, "in_compressed")).toBe(true);
    expect(member(hit, "file_start")).toBeUndefined();
    expect(member(hit, "section")).toBeDefined();

    const raws = await refs(tree, args({ guid: GUID_TEXT, scope: "raw" }), context);
    expect(member(raws, "total")).toBe(1);
    const none = await refs(tree, args({ guid: "13C8B020-4F27-453B-8F80-1BFCA187380F" }), context);
    expect(member(none, "total")).toBe(0);
    expect(member(none, "refs")).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests.testSeveralFormsAreFoundAcrossAReadBoundary
  it("finds several forms of one address, one across a read boundary", async () => {
    const size = 0x20_0000;
    const image = new Uint8Array(size).fill(0xff);
    const address = 0x1f_0000;
    // A BIOS-only image: the region is the file, its end at 4 GiB.
    const bus = 0x1_0000_0000 - (size - address);
    const little = (value: number) =>
      [0, 1, 2, 3].map((index) => Math.floor(value / 2 ** (8 * index)) % 256);
    image.set(little(bus), 0x10_0000 - 2); // across 1 MiB
    image.set(little(address), 0x18_0000);
    const answer = await refs(agentTreeOver(image), args({ address: hex(address) }), context);
    const hits = (member(answer, "refs") as Json[]).flatMap((one) => member(one, "hits") as Json[]);
    expect(new Set(hits.map((one) => member(one, "form")))).toEqual(new Set(["bus", "file"]));
    expect(hits.some((one) => member(one, "file_start") === "0xFFFFE")).toBe(true);
    expect(hits.some((one) => member(one, "file_start") === "0x180000")).toBe(true);
  });

  // @upstream ByteRipperTests/AgentRefsToolsTests.swift#AgentRefsToolsTests.testManyHitsInOneAreaAreCountedExactly
  it("counts many hits in one area exactly and lists the first few", async () => {
    const image = new Uint8Array(0x10_0000).fill(0xff);
    for (let index = 0; index < 600; index++) {
      image.set([0x00, 0x80, 0x0a, 0x00], 0x2000 + index * 0x400);
    }
    const answer = await refs(
      agentTreeOver(image),
      args({ address: "0xA8000", forms: ["file"] }),
      context
    );
    expect(member(answer, "total")).toBe(600);
    expect(member(answer, "files")).toBe(1);
    const group = (member(answer, "refs") as Json[])[0] ?? null;
    expect((member(group, "hits") as Json[]).length).toBe(MAX_HITS_PER_FILE);
    expect(member(group, "hits_total")).toBe(600);
    expect(member(answer, "next")).toBeNull();
  });

  it("wants a GUID or an address, one of them", async () => {
    const tree = agentTreeOver(new Uint8Array(0x100).fill(0xff));
    await expect(refs(tree, args({}), context)).rejects.toThrow("Give `guid` or `address`");
    await expect(refs(tree, args({ guid: GUID_TEXT, address: 0x100 }), context)).rejects.toThrow(
      "Give `guid` or `address`"
    );
  });
});
