import { describe, expect, it } from "vitest";
import { maskedPattern, parseHexPattern } from "@/core/search/maskedSearch";
import * as Test from "@/firmware/testing/testImage";
import { DRIVER_LZMA, driverBody, streamBytes } from "@/firmware/uefi/testing/compressedFixtures";
import {
  type AgentTree,
  agentTreeOver,
  expanded,
  nodeAtPath,
} from "@/tools/uefi/agent/uefiAgentTree";
import {
  isMERegion,
  isRemembered,
  matchFileRange,
  runContentSearch,
} from "@/tools/uefi/uefiContentSearch";

/**
 * The search through what the tree holds: the volumes' bytes, and what their compressed sections
 * decompress to, each match placed at its node and in its volume.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests
 * @upstream-differs the hidden text is the driver's name in the checked-in LZMA fixture, the web
 * having no LZMA encoder: its Name section holds it in UTF-16 alone
 */

/** Text that is in the image only inside the compressed section, in UTF-16. */
const HIDDEN = "InnerDriver";

const utf16 = (text: string, ignoreCase = false) =>
  maskedPattern(
    [...text].flatMap((one) => [(one.codePointAt(0) ?? 0) & 0xff, 0]),
    ignoreCase ? { folding: { kind: "utf16", littleEndian: true } } : {}
  );
const ascii = (text: string, ignoreCase = false) =>
  maskedPattern(
    [...text].map((one) => one.codePointAt(0) ?? 0),
    ignoreCase ? { folding: { kind: "asciiBytes" } } : {}
  );

/**
 * A volume of two files: a raw one holding `DE AD BE EF`, and a driver whose LZMA compression
 * section holds a name section and an image.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.image
 */
function image(): { bytes: Uint8Array; rawFileAt: number } {
  const raw = Test.file({
    type: 0x01,
    body: Uint8Array.from([0x00, 0x01, 0xde, 0xad, 0xbe, 0xef, 0x02, 0x03]),
  });
  const driver = Test.sectionedFile({
    type: 0x07,
    sections: [Test.compressionSection(0x02, streamBytes(DRIVER_LZMA), driverBody().length)],
  });
  const bytes = Test.volume({ length: 0x2000, files: [raw, driver] });
  return { bytes, rawFileAt: 0x48 };
}

const ask = { generation: 1 };

describe("the contents search", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testTextInACompressedSectionIsFoundInWhatItDecompressesTo
  it("finds text in a compressed section in what it decompresses to", async () => {
    const tree = agentTreeOver(image().bytes);
    const result = await runContentSearch(
      [ascii(HIDDEN.toLowerCase(), true), utf16(HIDDEN)],
      [],
      tree,
      ask
    );

    expect(result.total).toBe(1);
    const match = result.matches[0];
    if (match === undefined) throw new Error("a match");
    expect(match.pattern).toBe(1);
    expect(matchFileRange(match)).toBeUndefined();
    const node = match.node === undefined ? undefined : nodeAtPath(tree, match.node);
    expect(node?.kind).toBe("section");
    expect(node?.subtype).toBe(0x15);
    const section = match.section === undefined ? undefined : nodeAtPath(tree, match.section);
    expect(section?.compression).toBeDefined();
    const volume = match.volume === undefined ? undefined : nodeAtPath(tree, match.volume);
    expect(volume?.kind).toBe("volume");
    expect(match.volumeOffset).toBeUndefined();
    expect(result.buffers).toBe(1);
    expect(result.unreadSections).toEqual([]);
  });

  // A compressed stream holds nothing to look for: its bytes as stored are not searched, only what
  // they decompress to.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testTheBytesOfACompressedStreamAreNotSearched
  it("does not search the bytes of a compressed stream", async () => {
    const built = image();
    const tree = agentTreeOver(built.bytes);
    await runContentSearch([parseHexPattern("FF")], [], tree, ask);
    const section = tree
      .image()
      .allNodes.find((node) => node.compression !== undefined && node.kind === "section");
    if (section === undefined) throw new Error("the compressed section");
    const stored = built.bytes.slice(section.body.start + 8, section.body.start + 16);
    const pattern = [maskedPattern(stored)];
    expect((await runContentSearch(pattern, [], tree, ask)).total).toBe(0);
    expect((await runContentSearch(pattern, section.id, tree, ask)).total).toBe(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testAMatchInTheFileHasItsAddressAndItsPlaceInTheVolume
  it("gives a match in the file its address and its place in the volume", async () => {
    const built = image();
    const tree = agentTreeOver(built.bytes);
    const result = await runContentSearch([parseHexPattern("DE AD ?? EF")], [], tree, ask);

    expect(result.total).toBe(1);
    const match = result.matches[0];
    if (match === undefined) throw new Error("a match");
    const address = built.rawFileAt + 0x18 + 2;
    expect(matchFileRange(match)).toEqual({ start: address, end: address + 4 });
    const node = match.node === undefined ? undefined : nodeAtPath(tree, match.node);
    expect(node?.kind).toBe("file");
    expect(match.nodeOffset).toBe(0x18 + 2);
    expect(match.volumeOffset).toBe(address);
    expect(match.section).toBeUndefined();
    expect([...match.excerpt.subarray(match.excerptMatch.start, match.excerptMatch.end)]).toEqual([
      0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testASearchFromANodeLooksOnlyUnderIt
  it("looks only under the node it starts from", async () => {
    const tree = agentTreeOver(image().bytes);
    expanded(tree, [0]);
    const rawFile = [0, 0];
    const driver = [0, 1];
    expect(nodeAtPath(tree, rawFile)?.subtype).toBe(0x01);

    const text = [utf16(HIDDEN)];
    const inRaw = await runContentSearch(text, rawFile, tree, ask);
    expect(inRaw.total).toBe(0);
    expect(inRaw.buffers).toBe(0);
    const inDriver = await runContentSearch(text, driver, tree, ask);
    expect(inDriver.total).toBe(1);
    expect(inDriver.matches[0]?.node?.slice(0, 2)).toEqual(driver);

    const notInDriver = await runContentSearch([parseHexPattern("DEADBEEF")], driver, tree, ask);
    expect(notInDriver.total).toBe(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testANodeNotInTheTreeIsRefused
  it("refuses a node that is not in the tree", async () => {
    const tree = agentTreeOver(image().bytes);
    await expect(runContentSearch([parseHexPattern("00")], [7, 7], tree, ask)).rejects.toThrow(
      /7\.7/
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testTheMERegionIsNotSearched
  it("leaves the ME region out", async () => {
    const marker = [..."MEONLYMARK"].map((one) => one.codePointAt(0) ?? 0);
    const tree = agentTreeOver(imageWithME(marker));
    const me = tree.roots
      .flatMap((root) => [root, ...root.children])
      .find((node) => isMERegion(node));
    if (me === undefined) throw new Error("the ME region");
    const pattern = [maskedPattern(marker)];

    const whole = await runContentSearch(pattern, [], tree, ask);
    expect(whole.total).toBe(1);
    const first = whole.matches[0];
    expect(first === undefined ? undefined : matchFileRange(first)?.start).toBe(0x400);
    const inME = await runContentSearch(pattern, me.id, tree, ask);
    expect(inME.total).toBe(0);
    expect(inME.searchedBytes).toBe(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.testTheSameSearchOfTheSameBytesIsAnsweredFromTheLastOne
  it("answers the same search of the same bytes from the last one", async () => {
    const tree = agentTreeOver(image().bytes);
    const text = [utf16(HIDDEN)];
    expect(isRemembered(text, [], tree, ask)).toBe(false);
    const first = await runContentSearch(text, [], tree, ask);
    expect(isRemembered(text, [], tree, ask)).toBe(true);
    expect(await runContentSearch(text, [], tree, ask)).toEqual(first);

    expect(isRemembered([parseHexPattern("DEADBEEF")], [], tree, ask)).toBe(false);
    expect(isRemembered(text, [0], tree, ask)).toBe(false);
    expect(isRemembered(text, [], agentTreeOver(image().bytes), ask)).toBe(false);
    expect(isRemembered(text, [], tree, { generation: 2 })).toBe(false);
  });

  it("stops when asked, between its steps", async () => {
    const tree: AgentTree = agentTreeOver(image().bytes);
    await expect(
      runContentSearch([utf16(HIDDEN)], [], tree, { generation: 9, shouldCancel: () => true })
    ).rejects.toThrow();
  });
});

/**
 * A descriptor that maps an ME region at 0x1000–0x1FFF, with `marker` written once in the
 * descriptor's own bytes and once in the ME region.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIContentSearchTests.swift#UEFIContentSearchTests.imageWithME
 */
function imageWithME(marker: readonly number[]): Uint8Array {
  const image = new Uint8Array(0x2000).fill(0xff);
  const put = (value: number, offset: number) => {
    for (let index = 0; index < 4; index++) image[offset + index] = (value >>> (8 * index)) & 0xff;
  };
  const put16 = (value: number, offset: number) => {
    image[offset] = value & 0xff;
    image[offset + 1] = (value >>> 8) & 0xff;
  };
  put(0x0ff0_a55a, 0x10);
  put(0x0004_0000, 0x14);
  put(0x1200_00ff, 0x18);
  put(0x0021_0120, 0x1c);
  image[0x0eff] = 0x00;
  for (let index = 0; index < 16; index++) {
    put16(0, 0x40 + index * 4);
    put16(0, 0x40 + index * 4 + 2);
  }
  put16(0x01, 0x48);
  put16(0x01, 0x4a);
  image.set(marker, 0x400);
  image.set(marker, 0x1100);
  return image;
}
