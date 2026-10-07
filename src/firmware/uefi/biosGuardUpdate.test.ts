import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { type BiosGuardLine, biosGuardFile, block } from "@/firmware/testing/testBiosGuard";
import * as Test from "@/firmware/testing/testImage";
import {
  biosGuardBlockCount,
  biosGuardLayout,
  biosGuardTable,
  isBIOSGuardUpdate,
  parseBIOSGuardFile,
} from "@/firmware/uefi/biosGuardUpdate";
import { itemType } from "@/firmware/uefi/itemClassification";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { planRebuild } from "@/firmware/uefi/uefiRebuild";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * An AMI BIOS Guard update file (`BIOSGuardUpdate`, `UEFI_IMAGE_FORMAT.md` §1.2): the table
 * read as entries, the blocks' data laid end to end as the region, and every way a file can
 * fail to be one said as such.
 */

const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

const LINES: BiosGuardLine[] = [
  { key: "/B", name: "FV_BB", blocks: [block(0x11, 0x100)] },
  { key: "/N", name: "NVRAM", blocks: [block(0x22, 0x80)] },
  { key: "/P", name: "FV_MAIN_WRAPPER", blocks: [block(0x33, 0x100), block(0x44, 0x40)] },
];

const parse = (bytes: Uint8Array) => parseBIOSGuardFile(reader(bytes));
const problemOf = (bytes: Uint8Array) => {
  const read = parse(bytes);
  return read.ok ? undefined : read.problem;
};

describe("an AMI BIOS Guard update file", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testTheEntriesAreTheTablesLinesPlacedOneAfterAnother
  it("has the table's lines placed one after another", () => {
    const read = parse(biosGuardFile(LINES));
    if (!read.ok) throw new Error("not an update");
    expect(read.update.platform).toBe("RAPTORLAKE");
    expect(biosGuardBlockCount(read.update)).toBe(4);
    expect(read.update.entries).toEqual([
      { name: "FV_BB", key: "/B", blockCount: 1, range: { start: 0, end: 0x100 } },
      { name: "NVRAM", key: "/N", blockCount: 1, range: { start: 0x100, end: 0x180 } },
      {
        name: "FV_MAIN_WRAPPER",
        key: "/P",
        blockCount: 2,
        range: { start: 0x180, end: 0x2c0 },
      },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testTheRegionIsTheBlocksDataInFileOrderWithoutScriptsOrSignatures
  it("makes the region of the blocks' data, without scripts or signatures", () => {
    const read = parse(biosGuardFile(LINES, { tail: block(0xee, 0x200) }));
    if (!read.ok) throw new Error("not an update");
    expect(Array.from(read.update.region)).toEqual(
      Array.from(
        concat(block(0x11, 0x100), block(0x22, 0x80), block(0x33, 0x100), block(0x44, 0x40))
      )
    );
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testAnRSA3072SignatureIsSteppedOverAsWell
  it("steps over an RSA-3072 signature as well", () => {
    const read = parse(biosGuardFile(LINES, { signature: 0x30c }));
    if (!read.ok) throw new Error("not an update");
    expect(read.update.region.length).toBe(0x2c0);
    expect(read.update.entries.at(-1)?.range).toEqual({ start: 0x180, end: 0x2c0 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testAnUnsignedBlockHasNoSignatureAfterIt
  it("has no signature after an unsigned block", () => {
    const read = parse(biosGuardFile(LINES, { signed: false }));
    expect(read.ok && read.update.region.length).toBe(0x2c0);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testALineWithoutAKeyIsStillAnEntry
  it("keeps a line without a key as an entry", () => {
    const lines = biosGuardTable(ascii("Title\r\n1 /P 7 ;FV_MAIN\r\n1 2 ;RAW\r\nnonsense\r\n"));
    expect(lines.map((line) => line.name)).toEqual(["FV_MAIN", "RAW"]);
    expect(lines.map((line) => line.key)).toEqual(["/P", ""]);
    expect(lines.map((line) => line.blockCount)).toEqual([7, 2]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testWhatIsNotAnUpdateIsSaidToBeNone
  it("says what is not an update to be none", () => {
    expect(isBIOSGuardUpdate(reader(block(0xff, 0x100)))).toBe(false);
    expect(problemOf(block(0xff, 0x100))).toEqual({ kind: "notAnUpdate" });
    expect(problemOf(new Uint8Array())).toEqual({ kind: "notAnUpdate" });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testATableThatNamesNoBlocksIsRefused
  it("refuses a table that names no blocks", () => {
    expect(problemOf(biosGuardFile([]))).toEqual({ kind: "noEntries" });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testAFileCutShortSaysWhichBlockItEndsIn
  it("says which block a file cut short ends in", () => {
    const whole = biosGuardFile(LINES);
    const cut = whole.subarray(0, whole.length - 0x20c - 0x20);
    expect(problemOf(cut)).toEqual({ kind: "truncated", block: 3 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testATableNamingMoreBlocksThanFollowIsRefused
  it("refuses a table naming more blocks than follow", () => {
    const bytes = biosGuardFile([...LINES, { key: "/X", name: "EXTRA", blocks: [] }]);
    const at = String.fromCharCode(...bytes.subarray(0, 0x200)).indexOf("0 ;EXTRA");
    bytes.set(ascii("1"), at);
    expect(problemOf(bytes)).toEqual({ kind: "truncated", block: 4 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testABlockOfAnotherPlatformIsNotABlockOfThisFile
  it("does not take a block of another platform for one of this file", () => {
    const bytes = biosGuardFile(LINES);
    const headerSize = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
    const second = headerSize + 0x30 + 0x20 + 0x100 + 0x20c;
    bytes.set(ascii("ALDERLAKE\0"), second + 4);
    expect(problemOf(bytes)).toEqual({ kind: "notABlock", block: 1 });
  });
});

describe("an update file in the tree", () => {
  const treeFile = (tail?: Uint8Array) =>
    biosGuardFile(
      [
        { key: "/B", name: "FV_BB", blocks: [Test.volume({ length: 0x400 })] },
        { key: "/N", name: "NVRAM", blocks: [block(0xff, 0x200)] },
      ],
      tail === undefined ? {} : { tail }
    );
  const parseTree = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
  const updateIn = (bytes: Uint8Array) => {
    const found = parseTree(bytes).allNodes.find((node) => node.kind === "biosGuardUpdate");
    if (found === undefined) throw new Error("no update row");
    return found;
  };

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testAnUpdateAtTheTopOfTheFileIsARowOverItsHeaderAndBlocks
  it("is a row over its header and blocks at the top of the file", () => {
    const bytes = treeFile();
    const image = parseTree(bytes);
    const update = updateIn(bytes);
    const read = biosGuardLayout(reader(bytes));
    if (!read.ok) throw new Error("not an update");
    expect(image.roots.map((root) => root.kind)).toEqual(["biosGuardUpdate"]);
    expect(update.header).toEqual({ start: 0, end: read.layout.headerSize });
    expect(update.body).toEqual({ start: read.layout.headerSize, end: bytes.length });
    expect(update.space).toEqual([]);
    expect(update.compression).toEqual({ algorithm: "BIOS Guard", decodes: true });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testWhatFollowsTheBlocksIsReadBesideTheUpdate
  it("reads what follows the blocks beside the update", () => {
    const tail = concat(block(0xff, 0x100), Test.volume({ length: 0x400 }));
    const image = parseTree(treeFile(tail));
    const root = image.roots[0];
    expect(root?.kind).toBe("uefiImage");
    expect(root?.children.map((child) => child.kind)).toEqual([
      "biosGuardUpdate",
      "padding",
      "volume",
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testTheEntriesAreStretchesOfTheAssembledRegionAndOpenAsRawAreas
  it("has entries that are stretches of the assembled region, opened as raw areas", () => {
    const bytes = treeFile();
    const image = parseTree(bytes);
    const entries = updateIn(bytes).children;
    expect(entries.map((entry) => entry.kind)).toEqual(["biosGuardEntry", "biosGuardEntry"]);
    expect(entries.map((entry) => entry.name)).toEqual(["FV_BB", "NVRAM"]);
    expect(entries.map((entry) => entry.body)).toEqual([
      { start: 0, end: 0x400 },
      { start: 0x400, end: 0x600 },
    ]);
    expect(entries.map((entry) => entry.space)).toEqual([[0], [0]]);
    expect(entries[0]?.children.map((child) => child.kind)).toEqual(["volume"]);
    expect(entries[0]?.children[0]?.space).toEqual([0]);
    expect(entries[1]?.children.map((child) => child.isErased)).toEqual([true]);
    expect(image.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testTheRegionSpaceReadsAsTheBlocksDataLaidEndToEnd
  it("reads the region space as the blocks' data laid end to end", () => {
    const region = new SpaceReaders(reader(treeFile())).readerFor([0]);
    expect(Array.from(region?.bytes(region.all) ?? [])).toEqual(
      Array.from(concat(Test.volume({ length: 0x400 }), block(0xff, 0x200)))
    );
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testAnUpdateCutShortIsNotReadAsOne
  it("is not read as one when cut short", () => {
    const bytes = treeFile();
    const image = parseTree(bytes.subarray(0, bytes.length - 0x300));
    expect(image.allNodes.some((node) => node.kind === "biosGuardUpdate")).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.testTheItemClassificationIsUEFIToolsPadding
  it("is UEFITool's padding by classification", () => {
    const update = updateIn(treeFile());
    expect(itemType(update)).toBe(ItemType.padding);
    expect(update.children[0] && itemType(update.children[0])).toBe(ItemType.padding);
  });

  // @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.compressedSection
  it("refuses a change inside the assembled region", () => {
    const bytes = treeFile();
    const result = planRebuild(Test.volume({ length: 0x400 }), { space: [0] }, bytes);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.refusal.message).toContain("signed blocks");
  });
});
