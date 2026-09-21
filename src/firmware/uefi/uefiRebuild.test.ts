import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { compress } from "@/firmware/compression/firmwareCompression";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { insideSection } from "@/firmware/uefi/byteSpace";
import { alignUp } from "@/firmware/uefi/checksums";
import {
  decodeCompressedSection,
  locateCompressedSection,
} from "@/firmware/uefi/compressedSection";
import { guid, guidEquals } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { Section } from "@/firmware/uefi/sectionParser";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import {
  planRebuild,
  RANGES_NOT_CHECKED,
  type RebuildProgress,
  type RebuildProtectedRange,
  type RebuildTarget,
  targetForFileRange,
} from "@/firmware/uefi/uefiRebuild";

/**
 * Putting an edited part back (`Design/UEFI/UPDATE_IN_PARENT.md` §6, §8): every
 * result is applied to the file and parsed again. Ported from upstream's
 * `UEFIRebuildTests`.
 */

const otherGUID = guid("22222222-3333-4444-5555-666666666666");
const lzmaX86GUID = guid("D42AE6BD-1352-4BFB-909A-CA72A6EAE889");

/** A run of sections as a buffer holds them, four-byte aligned. */
function sections(list: readonly Uint8Array[]): Uint8Array {
  const body = new BinaryWriter();
  for (const one of list) {
    body.pad(alignUp(body.count, 4) ?? body.count, 0x00);
    body.raw(one);
  }
  return body.bytes;
}

const fileA = (): Uint8Array =>
  Test.sectionedFile({
    sections: [
      Test.nameSection("Drv"),
      Test.section({ type: Section.raw, body: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }),
    ],
  });

const fileB = (options: { type?: number; attributes?: number } = {}): Uint8Array =>
  Test.file({
    guid: otherGUID,
    type: options.type ?? FFS.rawType,
    attributes: options.attributes ?? 0,
    body: new Uint8Array(40).fill(0x42),
  });

function driver(name = "InnerDriver", extra = 0): Uint8Array {
  const image = new Uint8Array(40).fill(0xcc);
  image.set([0xe8, 0x10, 0x00, 0x00, 0x00]);
  const list = [Test.nameSection(name), Test.section({ type: 0x10, body: image })];
  if (extra > 0) {
    const raw = new Uint8Array(extra);
    for (let index = 0; index < extra; index++) raw[index] = (index * 131 + 7) & 0xff;
    list.push(Test.section({ type: Section.raw, body: raw }));
  }
  return sections(list);
}

const parse = (bytes: Uint8Array): UEFIImage => parseUefiImage(sourceOver(bytes));

/** The file with the plan written, and what the plan said. */
function planned(
  replacement: Uint8Array,
  target: RebuildTarget,
  file: Uint8Array
): { file: Uint8Array; warnings: readonly string[] } {
  const result = planRebuild(replacement, target, file);
  if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
  expect(result.plan.warnings).toContain(RANGES_NOT_CHECKED);
  const written = Uint8Array.from(file);
  written.set(result.plan.bytes, result.plan.offset);
  return { file: written, warnings: result.plan.warnings };
}

const plan = (replacement: Uint8Array, target: RebuildTarget, file: Uint8Array): Uint8Array =>
  planned(replacement, target, file).file;

function refusal(
  replacement: Uint8Array,
  target: RebuildTarget,
  file: Uint8Array
): string | undefined {
  const result = planRebuild(replacement, target, file);
  return result.ok ? undefined : result.refusal.message;
}

/** The complaints that mean a structure is broken, by kind. */
const damage = (image: UEFIImage): string[] =>
  image.diagnostics
    .map((diagnostic) => diagnostic.detail.kind)
    .filter((kind) =>
      ["checksumMismatch", "sizeMismatch", "truncated", "decompression", "zeroSize"].some((name) =>
        kind.startsWith(name)
      )
    );

const slice = (file: Uint8Array, range: { start: number; end: number }): Uint8Array =>
  file.slice(range.start, range.end);

const asFile = (range: { start: number; end: number }): RebuildTarget => ({ space: [], range });

const repeated = (byte: number, count: number): Uint8Array => new Uint8Array(count).fill(byte);

const kindsOf = (nodes: readonly UEFINode[]): string[] => nodes.map((node) => node.kind);

/** The last byte flipped: one change at the body's end, one at its checksum. */
function flipLast(bytes: Uint8Array): Uint8Array {
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  return bytes;
}

describe("in the file", () => {
  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAFileEditedInPlaceGetsItsChecksumsBack
   */
  it("gets a file's checksums back when it is edited in place", () => {
    const image = Test.volume({ length: 0x400, files: [fileA()] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const range = nodeRange(node);
    const edited = flipLast(slice(image, range));

    const rebuilt = plan(edited, asFile(range), image);

    expect(damage(parse(rebuilt))).toEqual([]);
    expect(rebuilt[range.end - 1]).toBe((image[range.end - 1] as number) ^ 0xff);
  });

  /**
   * A grown file pushes the file after it into the volume's free space; the
   * file after it arrives whole, and nothing is left broken.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAGrownFileMovesTheFileAfterItIntoTheFreeSpace
   */
  it("moves the file after a grown one into the free space", () => {
    const image = Test.volume({ length: 0x400, files: [fileA(), fileB()] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const grown = Test.sectionedFile({
      sections: [
        Test.nameSection("Drv"),
        Test.section({ type: Section.raw, body: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }),
        Test.section({ type: Section.raw, body: repeated(9, 40) }),
      ],
    });

    const rebuilt = plan(grown, asFile(nodeRange(node)), image);

    const parsed = parse(rebuilt);
    expect(damage(parsed)).toEqual([]);
    const files = (parsed.roots[0]?.children ?? []).filter((one) => one.kind === "file");
    expect(files.length).toBe(2);
    expect(files[0]?.children.filter((one) => one.kind === "section").length).toBe(3);
    expect(slice(rebuilt, (files[1] as UEFINode).body)).toEqual(repeated(0x42, 40));
    expect((files[1] as UEFINode).header.start).toBeGreaterThan(nodeRange(node).end);
    expect(rebuilt.length).toBe(image.length);
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAShrunkFileLeavesMoreFreeSpace
   */
  it("leaves more free space where a file shrank", () => {
    const image = Test.volume({ length: 0x400, files: [fileA(), fileB()] });
    const before = parse(image);
    const node = before.roots[0]?.children[0] as UEFINode;
    const freeBefore = free(before);
    const shrunk = Test.sectionedFile({ sections: [Test.nameSection("Drv")] });

    const rebuilt = plan(shrunk, asFile(nodeRange(node)), image);

    const parsed = parse(rebuilt);
    expect(damage(parsed)).toEqual([]);
    expect(free(parsed)).toBeGreaterThan(freeBefore);
    const files = (parsed.roots[0]?.children ?? []).filter((one) => one.kind === "file");
    expect(slice(rebuilt, (files[1] as UEFINode).body)).toEqual(repeated(0x42, 40));
  });

  const free = (image: UEFIImage): number => {
    const node = (image.roots[0]?.children ?? []).find((one) => one.kind === "freeSpace");
    if (node === undefined) return 0;
    const range = nodeRange(node);
    return range.end - range.start;
  };

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testGrowthPastTheFreeSpaceIsRefusedWithTheNumbers
   */
  it("refuses growth past the free space, with the numbers", () => {
    const image = Test.volume({ length: 0xd0, files: [fileA(), fileB()] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const big = Test.sectionedFile({
      sections: [
        Test.nameSection("Drv"),
        Test.section({ type: Section.raw, body: repeated(9, 64) }),
      ],
    });

    const message = refusal(big, asFile(nodeRange(node)), image);
    expect(message).toContain("free");
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAFixedFileIsNotMoved
   */
  it("does not move a fixed file", () => {
    const image = Test.volume({
      length: 0x400,
      files: [fileA(), fileB({ attributes: FFS.fixed })],
    });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const grown = Test.sectionedFile({
      sections: [
        Test.nameSection("Drv"),
        Test.section({ type: Section.raw, body: repeated(9, 64) }),
      ],
    });

    expect(refusal(grown, asFile(nodeRange(node)), image)).toContain("fixed");
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testCodeThatRunsInPlaceIsNotMoved
   */
  it("does not move code that runs in place", () => {
    const peim = Test.sectionedFile({
      guid: otherGUID,
      type: 0x06,
      sections: [Test.nameSection("Pei")],
    });
    const image = Test.volume({ length: 0x400, files: [fileA(), peim] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const grown = Test.sectionedFile({
      sections: [
        Test.nameSection("Drv"),
        Test.section({ type: Section.raw, body: repeated(9, 64) }),
      ],
    });

    expect(refusal(grown, asFile(nodeRange(node)), image)).toContain("runs in place");
  });

  /**
   * A volume that fills the file has no empty space after it to grow into.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeWithNothingAfterItCannotGrow
   */
  it("cannot grow a volume with nothing after it", () => {
    const image = Test.volume({ length: 0x400, files: [fileA()] });
    const volume = parse(image).roots[0] as UEFINode;
    const longer = Test.volume({ length: 0x800, files: [fileA()] });

    expect(refusal(longer, asFile(nodeRange(volume)), image)).toContain(
      "only 0x0 empty bytes follow it before the end of the file"
    );
  });
});

describe("a structure at its own length (§7)", () => {
  const secondVolume = Test.volume({
    length: 0x400,
    files: [
      Test.file({
        guid: guid("33333333-4444-5555-6666-777777777777"),
        body: new Uint8Array(24).fill(0x5a),
      }),
    ],
  });

  /** `first`, `gap` erased bytes, and a second volume that has to stay put. */
  function volumes(first: Uint8Array, gap: number): Uint8Array {
    const out = new Uint8Array(first.length + gap + secondVolume.length).fill(0xff);
    out.set(first);
    out.set(secondVolume, first.length + gap);
    return out;
  }

  /**
   * The structures at the top of a file: volumes with padding around them are
   * held by one image node.
   */
  function top(image: Uint8Array): UEFINode[] {
    const roots = parse(image).roots;
    return roots.length === 1 && roots[0]?.kind === "uefiImage"
      ? (roots[0]?.children ?? [])
      : roots;
  }

  /**
   * A volume put back longer is written at its new length; the empty space
   * after it gives up the difference, and the volume after that stays where it
   * was, byte for byte.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumePutBackLongerTakesTheEmptySpaceAfterIt
   */
  it("takes the empty space after a volume put back longer", () => {
    const image = volumes(Test.volume({ length: 0x400, files: [fileA()] }), 0x800);
    const volume = top(image)[0] as UEFINode;
    const longer = Test.volume({ length: 0x800, files: [fileA(), fileB()] });

    const { file: rebuilt, warnings } = planned(longer, asFile(nodeRange(volume)), image);

    expect(damage(parse(rebuilt))).toEqual([]);
    const after = top(rebuilt);
    expect(kindsOf(after)).toEqual(["volume", "padding", "volume"]);
    expect(nodeRange(after[0] as UEFINode)).toEqual({ start: 0, end: 0x800 });
    expect(nodeRange(after[1] as UEFINode)).toEqual({ start: 0x800, end: 0xc00 });
    expect(rebuilt.slice(0xc00, 0x1000)).toEqual(secondVolume);
    expect(rebuilt.length).toBe(image.length);
    expect(warnings.some((one) => one.includes("flash map"))).toBe(true);
  });

  /**
   * A volume put back shorter leaves its old tail erased, as padding.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumePutBackShorterGivesTheRestToTheEmptySpace
   */
  it("gives the rest to the empty space when a volume is put back shorter", () => {
    const image = volumes(Test.volume({ length: 0x400, files: [fileA()] }), 0x400);
    const volume = top(image)[0] as UEFINode;
    const shorter = Test.volume({ length: 0x200, files: [fileA()] });

    const rebuilt = plan(shorter, asFile(nodeRange(volume)), image);

    expect(damage(parse(rebuilt))).toEqual([]);
    const after = top(rebuilt);
    expect(kindsOf(after)).toEqual(["volume", "padding", "volume"]);
    expect(nodeRange(after[0] as UEFINode)).toEqual({ start: 0, end: 0x200 });
    expect(nodeRange(after[1] as UEFINode)).toEqual({ start: 0x200, end: 0x800 });
    expect(after[1]?.isErased).toBe(true);
    expect(rebuilt.slice(0x800, 0xc00)).toEqual(secondVolume);
  });

  /**
   * Bytes added to a volume in its tab without touching its header: the header
   * is made to say the new length, in whole blocks.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeWhoseHeaderDoesNotSayItsLengthIsGivenIt
   */
  it("gives a volume the length its header does not say", () => {
    const image = volumes(
      Test.volume({ length: 0x400, files: [fileA()], blockMapLength: 0x100 }),
      0x400
    );
    const volume = top(image)[0] as UEFINode;
    const range = nodeRange(volume);
    const longer = new Uint8Array(range.end - range.start + 0x200).fill(0xff);
    longer.set(slice(image, range));

    const { file: rebuilt, warnings } = planned(longer, asFile(range), image);

    expect(damage(parse(rebuilt))).toEqual([]);
    expect(nodeRange(top(rebuilt)[0] as UEFINode)).toEqual({ start: 0, end: 0x600 });
    expect(warnings.some((one) => one.includes("header now gives 0x600"))).toBe(true);

    const odd = new Uint8Array(range.end - range.start + 8).fill(0xff);
    odd.set(slice(image, range));
    expect(refusal(odd, asFile(range), image)).toContain("whole blocks");
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeLongerThanTheEmptySpaceAfterItIsRefused
   */
  it("refuses a volume longer than the empty space after it", () => {
    const image = volumes(Test.volume({ length: 0x400, files: [fileA()] }), 0x100);
    const volume = top(image)[0] as UEFINode;
    const longer = Test.volume({ length: 0x800, files: [fileA()] });

    expect(refusal(longer, asFile(nodeRange(volume)), image)).toContain(
      "only 0x100 empty bytes follow it"
    );
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeHoldingTheVolumeTopFileKeepsItsSize
   */
  it("keeps the size of a volume holding the Volume Top File", () => {
    const vtf = Test.volumeTopFile({ size: 0x100 });
    const image = volumes(Test.volume({ length: 0x800, files: [fileA()], lastFile: vtf }), 0x800);
    const volume = top(image)[0] as UEFINode;
    const longer = Test.volume({ length: 0x1000, files: [fileA()], lastFile: vtf });

    expect(refusal(longer, asFile(nodeRange(volume)), image)).toContain("Volume Top File");
  });

  /**
   * A file that outgrows a volume in the file grows the volume by whole blocks
   * into the empty space after it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeInTheFileGrowsIntoTheEmptySpaceAfterIt
   */
  it("grows a volume in the file into the empty space after it", () => {
    const image = volumes(Test.volume({ length: 0x100, files: [fileA()] }), 0x400);
    const node = (top(image)[0]?.children ?? []).find((one) => one.kind === "file") as UEFINode;
    const big = Test.file({ body: new Uint8Array(0x180).fill(0x22) });

    const { file: rebuilt, warnings } = planned(big, asFile(nodeRange(node)), image);

    expect(damage(parse(rebuilt))).toEqual([]);
    // 0x48 + 0x198 = 0x1E0 takes two blocks of 0x100.
    expect(nodeRange(top(rebuilt)[0] as UEFINode)).toEqual({ start: 0, end: 0x200 });
    expect(rebuilt.slice(0x500, 0x900)).toEqual(secondVolume);
    expect(warnings.some((one) => one.includes("taken from the empty space"))).toBe(true);
  });

  /**
   * The Volume Top File stays flush with the end; the pad file in front of it
   * gives up the room.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testTheVolumeTopFileStaysAtTheEnd
   */
  it("keeps the Volume Top File at the end", () => {
    const image = Test.volume({
      length: 0x800,
      files: [fileA()],
      lastFile: Test.volumeTopFile({ size: 0x100 }),
    });
    const before = parse(image);
    const node = before.roots[0]?.children[0] as UEFINode;
    const volumeTop = before.allNodes.find(
      (one) => one.guid !== undefined && guidEquals(one.guid, VOLUME_TOP_FILE)
    ) as UEFINode;
    const grown = Test.sectionedFile({
      sections: [
        Test.nameSection("Drv"),
        Test.section({ type: Section.raw, body: repeated(9, 200) }),
      ],
    });

    const rebuilt = plan(grown, asFile(nodeRange(node)), image);

    const parsed = parse(rebuilt);
    expect(damage(parsed)).toEqual([]);
    const after = parsed.allNodes.find(
      (one) => one.guid !== undefined && guidEquals(one.guid, VOLUME_TOP_FILE)
    ) as UEFINode;
    expect(nodeRange(after)).toEqual(nodeRange(volumeTop));
    expect(slice(rebuilt, nodeRange(after))).toEqual(slice(image, nodeRange(volumeTop)));
  });
});

describe("out of a compressed section", () => {
  function compressedImage(section: Uint8Array): { file: Uint8Array; section: UEFINode } {
    const file = Test.volume({
      length: 0x2000,
      files: [Test.sectionedFile({ sections: [section] }), fileB()],
    });
    const node = parse(file).roots[0]?.children[0]?.children[0] as UEFINode;
    return { file, section: node };
  }

  const lzma = (inner: Uint8Array): Uint8Array =>
    Test.compressionSection(0x02, compress(inner, { variant: "LZMA" }), inner.length);

  const insideOf = (section: UEFINode): RebuildTarget => ({
    space: insideSection(section.space, section.header.start),
  });

  function buffer(section: UEFINode, file: Uint8Array): Uint8Array | undefined {
    const readers = new SpaceReaders(new ImageReader(sourceOver(file)));
    const reader = readers.readerFor(insideSection(section.space, section.header.start));
    return reader?.bytes(reader.all);
  }

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testADecompressedBodyGoesBackIntoItsSection
   */
  it("puts a decompressed body back into its section", () => {
    const { file, section } = compressedImage(lzma(driver()));
    const edited = driver("InnerDriveX");

    const rebuilt = plan(edited, insideOf(section), file);

    expect(damage(parse(rebuilt))).toEqual([]);
    expect(buffer(section, rebuilt)).toEqual(edited);
  });

  /**
   * A body that grew compresses to a longer stream: the section, its file and
   * the file after it all make room.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testABodyThatGrewMakesRoomAllTheWayOut
   */
  it("makes room all the way out for a body that grew", () => {
    const { file, section } = compressedImage(lzma(driver()));
    const edited = driver("InnerDriver", 600);

    const rebuilt = plan(edited, insideOf(section), file);

    const parsed = parse(rebuilt);
    expect(damage(parsed)).toEqual([]);
    expect(buffer(section, rebuilt)).toEqual(edited);
    const files = (parsed.roots[0]?.children ?? []).filter((one) => one.kind === "file");
    expect(slice(rebuilt, (files[1] as UEFINode).body)).toEqual(repeated(0x42, 40));
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testANodeInsideABufferGoesBack
   */
  it("puts a node inside a buffer back", () => {
    const { file, section } = compressedImage(lzma(driver()));
    const space = insideSection(section.space, section.header.start);
    const inside = parse(file).allNodes.find(
      (one) =>
        one.space.length === space.length &&
        one.space.every((step, index) => step === space[index]) &&
        one.subtype === Section.userInterface
    ) as UEFINode;
    const renamed = Test.nameSection("OtherDriver");

    const rebuilt = plan(renamed, { space, range: nodeRange(inside) }, file);

    expect(buffer(section, rebuilt)).toEqual(driver("OtherDriver"));
  });

  /**
   * The stream is written the way the section's was: LZMA with the x86 filter
   * stays that, Tiano stays Tiano.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testEachSectionIsCompressedItsOwnWay
   */
  it("compresses each section its own way", () => {
    const x86 = Test.guidedSectionBytes({
      guid: lzmaX86GUID,
      body: compress(driver(), { variant: "LZMA with x86 filter" }),
      attributes: 0x01,
    });
    const tiano = Test.compressionSection(
      0x01,
      compress(driver(), { variant: "Tiano" }),
      driver().length
    );
    const cases: readonly [Uint8Array, string][] = [
      [x86, "LZMA with x86 filter"],
      [tiano, "Tiano"],
    ];
    for (const [section, variant] of cases) {
      const { file, section: node } = compressedImage(section);
      const edited = driver("InnerDriveX");

      const rebuilt = plan(edited, insideOf(node), file);

      const reader = new ImageReader(sourceOver(rebuilt));
      const located = locateCompressedSection(node.header.start, reader);
      expect(located).toBeDefined();
      const decoded = decodeCompressedSection(
        located as NonNullable<typeof located>,
        reader,
        1 << 24
      );
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.variant).toBe(variant);
      expect(decoded.bytes).toEqual(edited);
    }
  });

  /**
   * Runs copied from anywhere earlier in the data, with a few stray bytes
   * between them: what the maximum level, searching deeper for matches, makes
   * hundreds of bytes shorter than the normal one does (measured: 0x8000 bytes
   * to 2652 against 2140). Word-like text barely differs.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.text
   */
  function text(length: number, seed: number): Uint8Array {
    let state = seed >>> 0;
    const next = (): number => {
      state = (Math.imul(state, 1_103_515_245) + 12345) >>> 0;
      return state >>> 8;
    };
    let out: number[] = [];
    for (let index = 0; index < 512; index++) out.push(next() & 0xff);
    while (out.length < length) {
      const from = next() % Math.max(1, out.length - 64);
      const end = Math.min(out.length, from + 16 + (next() % 200));
      out = out.concat(out.slice(from, end));
      const stray = next() % 6;
      for (let index = 0; index < stray; index++) out.push(next() & 0xff);
    }
    return Uint8Array.from(out.slice(0, length));
  }

  /**
   * A body too big for its volume's room at the normal level is compressed at
   * the maximum level before the rebuild gives up, and the plan says so; with
   * room enough for the normal level, the normal level is all it takes.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testTheMaximumLevelIsTriedOnlyWhenTheNormalOneDoesNotFit
   */
  it("tries the maximum level only when the normal one does not fit", () => {
    const edited = sections([
      Test.nameSection("Drv"),
      Test.section({ type: Section.raw, body: text(0x8000, 4) }),
    ]);
    const held = lzma(driver());
    const imageOf = (length: number): { file: Uint8Array; section: UEFINode } | undefined => {
      const file = Test.volume({
        length,
        files: [Test.sectionedFile({ sections: [held] }), fileB()],
      });
      if (file.length !== length) return undefined;
      const node = parse(file).roots[0]?.children[0]?.children[0];
      if (node === undefined || node.compression === undefined) return undefined;
      return { file, section: node };
    };
    const fits = (length: number, fallback: boolean) => {
      const made = imageOf(length);
      if (made === undefined) return undefined;
      return planRebuild(edited, insideOf(made.section), made.file, {
        maximumCompressionFallback: fallback,
      });
    };
    function smallest(fallback: boolean): number | undefined {
      let low = 0x40;
      let high = 0x8000;
      if (fits(high, fallback)?.ok !== true) return undefined;
      while (high - low > 8) {
        const middle = Math.floor((low + high) / 2 / 8) * 8;
        if (fits(middle, fallback)?.ok === true) high = middle;
        else low = middle;
      }
      return high;
    }
    const normalOnly = smallest(false);
    const withFallback = smallest(true);

    expect(normalOnly).toBeDefined();
    expect(withFallback).toBeDefined();
    // The maximum level fits where the normal one does not.
    expect(withFallback as number).toBeLessThan(normalOnly as number);

    const squeezed = fits(withFallback as number, true);
    expect(squeezed?.ok).toBe(true);
    if (squeezed?.ok !== true) return;
    expect(squeezed.plan.warnings.some((one) => one.includes("maximum level"))).toBe(true);
    const roomy = fits(normalOnly as number, true);
    expect(roomy?.ok).toBe(true);
    if (roomy?.ok !== true) return;
    expect(roomy.plan.warnings.some((one) => one.includes("maximum level"))).toBe(false);
  });

  /**
   * The plan says where the part is held once written: for a body, the
   * compressed section's new range, grown with it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testThePlanSaysWhereThePartIsHeldAfterwards
   */
  it("says where the part is held afterwards", () => {
    const { file, section } = compressedImage(lzma(driver()));
    const result = planRebuild(driver("InnerDriver", 600), insideOf(section), file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const range = nodeRange(section);
    expect(result.plan.source.start).toBe(range.start);
    expect(result.plan.source.end - result.plan.source.start).toBeGreaterThan(
      range.end - range.start
    );
  });

  /**
   * A file that outgrows the volume a firmware volume image section holds grows
   * that volume by whole blocks, and the section, the compressed stream and the
   * files around them follow.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeASectionHoldsGrowsByWholeBlocks
   */
  it("grows a volume a section holds by whole blocks", () => {
    const small = Test.file({ guid: otherGUID, body: new Uint8Array(0x40).fill(0x11) });
    const inner = Test.volume({ length: 0x100, files: [small] });
    const held = sections([Test.section({ type: Section.firmwareVolumeImage, body: inner })]);
    const { file, section } = compressedImage(lzma(held));
    const space = insideSection(section.space, section.header.start);
    const inSpace = (one: UEFINode) =>
      one.space.length === space.length && one.space.every((step, at) => step === space[at]);
    const node = parse(file).allNodes.find(
      (one) => inSpace(one) && one.kind === "file"
    ) as UEFINode;
    const big = Test.file({ guid: otherGUID, body: new Uint8Array(0x180).fill(0x22) });

    const rebuilt = plan(big, { space, range: nodeRange(node) }, file);

    const after = parse(rebuilt);
    expect(damage(after)).toEqual([]);
    const volume = after.allNodes.find((one) => inSpace(one) && one.kind === "volume") as UEFINode;
    const range = nodeRange(volume);
    // 0x48 + 0x198 takes two blocks of 0x100.
    expect(range.end - range.start).toBe(0x200);
    const grown = after.allNodes.find((one) => inSpace(one) && one.kind === "file") as UEFINode;
    const held2 = buffer(section, rebuilt) as Uint8Array;
    expect(slice(held2, grown.body)).toEqual(new Uint8Array(0x180).fill(0x22));
    const files = (after.roots[0]?.children ?? []).filter((one) => one.kind === "file");
    expect(slice(rebuilt, (files[1] as UEFINode).body)).toEqual(repeated(0x42, 40));
  });

  /**
   * A long rebuild says what it is doing and how far it has got: reading the
   * image, compressing the section again, checking the result — forward only,
   * and all the way at the end.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testARebuildSaysWhatItIsDoing
   */
  it("says what it is doing", () => {
    const { file, section } = compressedImage(lzma(driver()));
    const reports: RebuildProgress[] = [];

    const result = planRebuild(driver("InnerDriveX"), insideOf(section), file, {
      onProgress: (progress) => reports.push(progress),
    });

    expect(result.ok).toBe(true);
    const phases = reports
      .map((one) => one.phase)
      .filter((phase, index, all) => index === 0 || all[index - 1] !== phase);
    expect(phases.length).toBe(3);
    expect(phases[0]?.startsWith("Reading")).toBe(true);
    expect(phases[1]).toContain("LZMA compressed section");
    expect(phases[2]?.startsWith("Checking")).toBe(true);
    const fractions = reports.map((one) => one.fraction);
    expect(fractions).toEqual([...fractions].sort((one, other) => one - other));
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});

describe("a volume at the top of the file (§6.5)", () => {
  /**
   * A volume at the top of the file does not grow, however it is laid out.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAVolumeAtTheTopOfTheFileDoesNotGrow
   */
  it("does not grow", () => {
    const image = Test.volume({ length: 0x100, files: [fileA()] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const big = Test.file({ body: new Uint8Array(0x180).fill(0x22) });

    expect(refusal(big, asFile(nodeRange(node)), image)).toContain("free");
  });
});

describe("what a link follows", () => {
  /**
   * A zone is something to rebuild around only when it is exactly a volume, a
   * file or a section.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAZoneIsATargetWhenItIsAStructure
   */
  it("is a target when the zone is a structure", () => {
    const image = Test.volume({ length: 0x400, files: [fileA()] });
    const parsed = parse(image);
    const file = parsed.roots[0]?.children[0] as UEFINode;

    expect(targetForFileRange(nodeRange(file), parsed)).toEqual({
      space: [],
      range: nodeRange(file),
    });
    expect(targetForFileRange({ start: 0x50, end: 0x60 }, parsed)).toBeUndefined();
  });
});

describe("protected ranges (§6.4)", () => {
  /**
   * A file with the last byte of its body flipped: a change at the body's end,
   * and one at its checksum in the header.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.editedFile
   */
  function editedFile(): {
    image: Uint8Array;
    edited: Uint8Array;
    target: RebuildTarget;
    body: { start: number; end: number };
  } {
    const image = Test.volume({ length: 0x400, files: [fileA()] });
    const node = parse(image).roots[0]?.children[0] as UEFINode;
    const edited = flipLast(slice(image, nodeRange(node)));
    return { image, edited, target: asFile(nodeRange(node)), body: node.body };
  }

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAChangeInsideTheIBBIsRefused
   */
  it("refuses a change inside the IBB", () => {
    const { image, edited, target, body } = editedFile();
    const ibb: RebuildProtectedRange = { kind: "ibb", range: body, name: "IBB segment 1" };

    const result = planRebuild(edited, target, image, { protected: [ibb] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.message).toContain("IBB segment 1");
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAChangeInsideAVendorHashIsWarnedAbout
   */
  it("warns about a change inside a vendor hash", () => {
    const { image, edited, target, body } = editedFile();
    const hash: RebuildProtectedRange = {
      kind: "vendorHash",
      range: body,
      name: "AMI hash of DXE",
    };

    const result = planRebuild(edited, target, image, { protected: [hash] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings.some((one) => one.includes("AMI hash of DXE"))).toBe(true);
    expect(result.plan.warnings).not.toContain(RANGES_NOT_CHECKED);
  });

  /**
   * Two ranges of one list with one name — two entries of a flash device map —
   * written through by one change are one warning, not two.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testOneNameWrittenThroughTwiceIsOneWarning
   */
  it("says one name written through twice once", () => {
    const { image, edited, target, body } = editedFile();
    const half = body.start + Math.floor((body.end - body.start) / 2);
    const name = "Insyde flash device map range";
    const ranges: RebuildProtectedRange[] = [
      { kind: "vendorHash", range: { start: body.start, end: half }, name },
      { kind: "vendorHash", range: { start: half, end: body.end }, name },
      { kind: "vendorHash", range: { start: body.start - 0x18, end: body.start }, name },
    ];

    const result = planRebuild(edited, target, image, { protected: ranges });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings.filter((one) => one.includes(name)).length).toBe(1);
  });

  /**
   * Ranges the change does not write into say nothing — nor does a range that
   * only sits between two changed bytes it does not contain.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testRangesTheChangeDoesNotTouchSayNothing
   */
  it("says nothing about ranges the change does not touch", () => {
    const { image, edited, target } = editedFile();
    const far: RebuildProtectedRange = {
      kind: "ibb",
      range: { start: 0x300, end: 0x380 },
      name: "IBB segment 2",
    };

    const result = planRebuild(edited, target, image, { protected: [far] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings).toEqual([]);
  });
});
