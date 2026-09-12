import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import { FFS } from "@/firmware/uefi/fileParser";
import { FFS_V1, FFS_V3, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/** Ported from `FileParseTests.swift`: walking a volume's body into files. */

const parse = (files: readonly Uint8Array[], length = 0x400) =>
  parseUefiImage(sourceOver(Test.volume({ length, files })));
const volumeOf = (files: readonly Uint8Array[], length = 0x400) => parse(files, length).roots[0];
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const ranges = (nodes: readonly UEFINode[]) =>
  nodes.map((node) => [nodeRange(node).start, nodeRange(node).end]);
const bytes = (...values: number[]) => new Uint8Array(values);

describe("the file walk", () => {
  it("reads files back to back", () => {
    const node = volumeOf([
      Test.file({ body: bytes(1, 2, 3, 4) }),
      Test.file({ body: bytes(5, 6, 7, 8, 9, 10, 11, 12) }),
    ]);

    expect(kinds(node?.children ?? [])).toEqual(["file", "padding", "file", "freeSpace"]);
    expect(ranges(node?.children ?? [])).toEqual([
      [0x48, 0x64],
      [0x64, 0x68],
      [0x68, 0x88],
      [0x88, 0x400],
    ]);
  });

  // The header is `0x18` bytes and the body is the rest — the split every
  // consumer of this tree reads a structure out of.
  it("splits a file into a header and a body", () => {
    const file = volumeOf([Test.file({ type: 0x07, body: bytes(1, 2, 3, 4) })])?.children[0];

    expect(file?.header).toEqual({ start: 0x48, end: 0x60 });
    expect(file?.body).toEqual({ start: 0x60, end: 0x64 });
    expect(file?.tail.end).toBe(file?.tail.start);
    expect(file?.guid).toEqual(Test.DRIVER_GUID);
    expect(file?.name).toBe("Driver");
    expect(file?.subtype).toBe(0x07);
  });

  // A file whose size stops short of the next eight-byte boundary leaves bytes
  // that belong to no structure, and a byte in no node is a byte that cannot be
  // written back.
  it("keeps the alignment gap between files", () => {
    const node = volumeOf([Test.file({ body: bytes(1, 2, 3, 4) }), Test.file({ body: bytes(5) })]);
    const gap = node?.children[1];

    expect(gap?.kind).toBe("padding");
    expect(nodeRange(gap ?? ({} as UEFINode))).toEqual({ start: 0x64, end: 0x68 });
    expect(gap?.isErased).toBe(true);
  });
});

describe("naming a file", () => {
  it("uses a GUID we know, whatever its type says", () => {
    const file = volumeOf([Test.file({ guid: VOLUME_TOP_FILE, body: bytes(1) })])?.children[0];
    expect(file?.name).toBe("Volume Top File");
  });

  it("names a pad file by its type, and says nothing about it", () => {
    const parsed = parse([Test.file({ type: 0xf0, body: bytes(1, 2) })]);
    expect(parsed.roots[0]?.children[0]?.name).toBe("Pad file");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("keeps an unknown type, and reports it", () => {
    const parsed = parse([Test.file({ type: 0x42, body: bytes(1) })]);

    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["file", "padding", "freeSpace"]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "unknownType", structure: "fileHeader", code: 0x42 },
    ]);
    expect(parsed.roots[0]?.children[0]?.name).toBe("File type 0x42");
  });
});

describe("a file that cannot be believed", () => {
  // A file that must not be moved when the image is rebuilt says so in one bit,
  // and losing it is how a rebuild breaks Boot Guard.
  it("carries its fixed attribute to the node", () => {
    const file = volumeOf([Test.file({ attributes: FFS.fixed, body: bytes(1) })])?.children[0];
    expect(file?.isFixed).toBe(true);
  });

  // A size of zero would put the walk back on the same offset for ever.
  it("stops the walk at a size of zero", () => {
    const parsed = parse([
      Test.file({ body: bytes(1, 2, 3, 4), size: 0 }),
      Test.file({ body: bytes(9) }),
    ]);

    expect(parsed.roots[0]?.children).toEqual([]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "zeroSize", structure: "fileHeader" },
    ]);
    expect(parsed.diagnostics.map((one) => one.offset)).toEqual([0x5c]);
  });

  it("stops the walk at a file smaller than its header", () => {
    const parsed = parse([Test.file({ body: bytes(1, 2, 3, 4), size: 0x10 })]);

    expect(parsed.roots[0]?.children).toEqual([]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "sizeMismatch", structure: "fileHeader", stored: 0x10, computed: 0x18 },
    ]);
  });

  it("cuts a file running past the volume, and reports it", () => {
    const parsed = parse([Test.file({ body: bytes(1, 2, 3, 4), size: 0x600 })]);

    expect(ranges(parsed.roots[0]?.children ?? [])).toEqual([[0x48, 0x400]]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "truncated", structure: "fileBody" },
    ]);
  });
});

describe("a file's checksums", () => {
  it("reports a stale header checksum", () => {
    const parsed = parse([Test.file({ body: bytes(1, 2), headerChecksum: 0x11 })]);

    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["file", "padding", "freeSpace"]);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.offset).toBe(0x58);
    expect(parsed.diagnostics[0]?.detail).toMatchObject({
      kind: "checksumMismatch",
      structure: "fileHeader",
      stored: 0x11,
    });
  });

  // A file without the checksum attribute carries a fixed value in the field,
  // and which fixed value depends on the volume's revision.
  it("reports a wrong fixed body checksum", () => {
    const parsed = parse([Test.file({ body: bytes(1, 2), bodyChecksum: FFS.fixedChecksum })]);

    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "checksumMismatch", structure: "fileBody", stored: 0x5a, computed: 0xaa },
    ]);
  });

  // With the attribute set the field is a real checksum of the body, and a body
  // edited without recomputing it is exactly what this catches.
  it("checks a computed body checksum against the body", () => {
    const good = Test.file({ attributes: FFS.checksumBit, body: bytes(1, 2, 3, 4) });
    expect(parse([good]).diagnostics).toEqual([]);

    const edited = Uint8Array.from(good);
    edited[FFS.headerSize] = 0x99;
    expect(parse([edited]).diagnostics.map((one) => one.detail)).toEqual([
      { kind: "checksumMismatch", structure: "fileBody", stored: 0xf6, computed: 0x5e },
    ]);
  });
});

describe("the shapes a file header can take", () => {
  // FFSv3 puts a large file's size in a 64-bit field after the base header,
  // which makes the header longer — read it as a short file and the body starts
  // eight bytes early.
  it("gives an FFSv3 large file a longer header", () => {
    const image = Test.volume({
      fileSystem: FFS_V3,
      files: [Test.largeFile({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
    });
    const file = parseUefiImage(sourceOver(image)).roots[0]?.children[0];

    expect(file?.header).toEqual({ start: 0x48, end: 0x68 });
    expect(file?.body).toEqual({ start: 0x68, end: 0x70 });
  });

  // Only FFSv1 files have a tail, and only in a Revision 1 volume — the same
  // attribute bit means "large file" everywhere else.
  it("holds an FFSv1 tail apart from the body", () => {
    const image = Test.volume({
      fileSystem: FFS_V1,
      revision: 1,
      files: [
        Test.file({
          attributes: FFS.tailPresent,
          body: bytes(1, 2, 3, 4, 0xaa, 0xbb),
          volumeRevision: 1,
        }),
      ],
    });
    const file = parseUefiImage(sourceOver(image)).roots[0]?.children[0];

    expect(file?.header).toEqual({ start: 0x48, end: 0x60 });
    expect(file?.body).toEqual({ start: 0x60, end: 0x64 });
    expect(file?.tail).toEqual({ start: 0x64, end: 0x66 });
  });
});

describe("what is past the last file", () => {
  // The bytes after the last erased one are data somebody put there, and they
  // are kept as their own node rather than swallowed by the free space.
  it("holds data after the free space apart", () => {
    const trailing = new Uint8Array(0x104).fill(0xff);
    trailing.set([0x11, 0x22, 0x33, 0x44], 0x100);
    const image = Test.volume({
      length: 0x400,
      files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
      trailing,
    });
    const children = parseUefiImage(sourceOver(image)).roots[0]?.children ?? [];

    expect(kinds(children)).toEqual(["file", "freeSpace", "nonUEFIData"]);
    expect(nodeRange(children[2] as UEFINode)).toEqual({ start: 0x168, end: 0x400 });
  });

  // And what is in there gets searched: vendors put runs of microcode and whole
  // volumes in the space after a volume's files, and leaving it as one opaque
  // block would hide them.
  it("searches inside non-UEFI data", () => {
    const microcode = Test.microcode();
    const trailing = new Uint8Array(0x100 + microcode.length).fill(0xff);
    trailing.set(microcode, 0x100);
    const image = Test.volume({
      length: 0x1000,
      files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
      trailing,
    });
    const children = parseUefiImage(sourceOver(image)).roots[0]?.children ?? [];
    const data = children.at(-1);

    expect(data?.kind).toBe("nonUEFIData");
    expect(kinds(data?.children ?? [])).toEqual(["microcode", "padding"]);
    expect(nodeRange(data?.children[0] as UEFINode)).toEqual({ start: 0x168, end: 0x1d8 });
  });

  // And the boundary between the two goes *back* to the eight-byte mark:
  // whatever the data turns out to be, it starts aligned, so the erased bytes
  // in front of it belong to it and not to the free space.
  it("steps the free-space boundary back to the alignment", () => {
    const trailing = new Uint8Array(0x105).fill(0xff);
    trailing.set([0x11, 0x22, 0x33, 0x44], 0x101);
    const image = Test.volume({
      length: 0x400,
      files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
      trailing,
    });
    const children = parseUefiImage(sourceOver(image)).roots[0]?.children ?? [];

    expect(ranges(children)).toEqual([
      [0x48, 0x68],
      [0x68, 0x168],
      [0x168, 0x400],
    ]);
  });
});
