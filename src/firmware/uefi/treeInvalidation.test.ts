import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import type { ImageRange } from "@/firmware/imageReader";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import type { FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { DEFAULT_LIMITS } from "@/firmware/uefi/parserState";
import { NAME_LZMA, nameBody, streamBytes } from "@/firmware/uefi/testing/compressedFixtures";
import {
  collapsingFrom,
  collapsingOverlapping,
  invalidating,
} from "@/firmware/uefi/treeInvalidation";
import { childrenOf, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `UEFIImageTests/LazyUEFITreeTests.swift`'s invalidation cases —
 * what an edit does to a tree that is already read.
 */

const range = (start: number, end: number): ImageRange => ({ start, end });
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

const volumeA = Test.volume({
  length: 0x1000,
  files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
});
const volumeB = Test.volume({ length: 0x1000, files: [Test.file({ body: bytes(9, 9, 9) })] });

/**
 * Two volumes back to back in the BIOS region, so which of them an edit reaches
 * is a question the test can ask.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.twoVolumeImage
 */
function twoVolumeImage(): Uint8Array {
  return Test.intelImage({
    size: 0x8000,
    regions: [
      { type: "descriptor", start: 0, end: 0x1000 },
      { type: "me", start: 0x1000, end: 0x2000 },
      { type: "bios", start: 0x4000, end: 0x8000 },
    ],
    contents: new Map<FlashRegionType, Uint8Array>([["bios", concat(volumeA, volumeB)]]),
  });
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.built */
function built(bytes: Uint8Array): { reader: ImageReader; roots: UEFINode[] } {
  const reader = new ImageReader(sourceOver(bytes));
  return { reader, roots: stampIds(rootsOf(reader, DEFAULT_LIMITS).nodes, []) };
}

/** One node's children, read now — what an expansion does after an invalidation. */
function expandNode(reader: ImageReader, node: UEFINode): UEFINode[] {
  const result = childrenOf(node, reader, DEFAULT_LIMITS, new DecompressedBuffers());
  node.children = stampIds(result.nodes, node.id);
  node.isExpandable = false;
  return node.children;
}

/** The region the two volumes live under. */
const biosOf = (roots: readonly UEFINode[]): UEFINode =>
  roots[0]?.children.find((child) => child.name === "BIOS region") as UEFINode;

const volumesOf = (node: UEFINode): UEFINode[] =>
  node.children.filter((child) => child.kind === "volume");

const filesOf = (node: UEFINode): UEFINode[] =>
  node.children.filter((child) => child.kind === "file");

/** Back to the state a gate point was left in before anything asked inside it. */
const collapsed = (node: UEFINode): boolean => node.isExpandable && node.children.length === 0;

/** The two volumes of the BIOS region, both of them opened. */
function opened(bytes: Uint8Array): {
  reader: ImageReader;
  roots: UEFINode[];
  volumes: UEFINode[];
} {
  const { reader, roots } = built(bytes);
  // A region's raw area is scanned only when something asks to see inside it —
  // the one genuinely expensive walk, so it is never the top level's to pay.
  const bios = biosOf(roots);
  expandNode(reader, bios);
  const volumes = volumesOf(bios);
  expandNode(reader, volumes[0] as UEFINode);
  expandNode(reader, volumes[1] as UEFINode);
  return { reader, roots, volumes };
}

/** A byte inside the second volume's file body — past every header that holds a size. */
const bodyOfLastFile = (volume: UEFINode): ImageRange => {
  const files = filesOf(volume);
  return (files[files.length - 1] as UEFINode).body;
};

describe("invalidating an overwrite", () => {
  it("leaves an expanded volume alone when the edit misses it", () => {
    const { roots, volumes } = opened(twoVolumeImage());

    // An edit inside the ME region, which has no children and no volume of its
    // own to speak of.
    collapsingOverlapping(roots, range(0x1000, 0x1004));

    const refreshed = volumesOf(biosOf(roots));
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]).toBe(volumes[0]);
    expect(filesOf(refreshed[0] as UEFINode)).toHaveLength(1);
    expect(filesOf(refreshed[1] as UEFINode)).toHaveLength(1);
  });

  it("collapses only the volume the edit landed in", () => {
    const { roots, volumes } = opened(twoVolumeImage());

    // A byte inside the second volume's file body — not its header, where its
    // size is: an edit to a size is the volume's own to answer, because the
    // files after it may have moved.
    const body = bodyOfLastFile(volumes[1] as UEFINode);
    collapsingOverlapping(roots, range(body.start + 1, body.start + 2));

    const refreshed = volumesOf(biosOf(roots));
    // The touched volume collapsed back to expandable and empty…
    expect(collapsed(refreshed[1] as UEFINode)).toBe(true);
    // …while its sibling's files stand.
    expect(filesOf(refreshed[0] as UEFINode)).toHaveLength(1);
  });

  // The point of invalidating a tree rather than rebuilding it: the node that
  // was dropped is read again from the bytes as they are now, not as they were
  // when the tree was built.
  it("reads the bytes as they are now when a collapsed volume is opened again", () => {
    const bytes = twoVolumeImage();
    const { reader, roots, volumes } = opened(bytes);
    const first = volumes[0] as UEFINode;
    const body = (filesOf(first)[0] as UEFINode).body;

    // Overwrite the file's body without changing its recorded size — a pure
    // content change, which is what an edit in the hex pane is.
    bytes.fill(0x42, body.start, body.end);
    collapsingOverlapping(roots, body);

    expandNode(reader, first);
    const reread = (filesOf(first)[0] as UEFINode).body;
    expect(reader.bytes(reread)).toEqual(new Uint8Array(reread.end - reread.start).fill(0x42));
  });

  // Narrowing into a child is sound only while the edit is that child's alone.
  // An edit running out of one volume and into the next may have moved every
  // child after it, so the container that has to be read again is the region.
  it("collapses the container when the edit runs out of one child into the next", () => {
    const { roots, volumes } = opened(twoVolumeImage());

    const spanning = range(
      bodyOfLastFile(volumes[0] as UEFINode).end - 0x2,
      bodyOfLastFile(volumes[1] as UEFINode).start + 0x2
    );
    collapsingOverlapping(roots, spanning);

    expect(collapsed(biosOf(roots))).toBe(true);
  });
});

describe("invalidating an insert or a delete", () => {
  it("collapses from the edit point onward, and leaves what is before it", () => {
    const { roots, volumes } = opened(twoVolumeImage());

    // An insert right at the start of the second volume: everything from there
    // on is now at a different offset.
    collapsingFrom(roots, (volumes[1] as UEFINode).header.start);

    const refreshed = volumesOf(biosOf(roots));
    // The first volume, entirely before the edit point, is untouched.
    expect(refreshed[0]).toBe(volumes[0]);
    expect(filesOf(refreshed[0] as UEFINode)).toHaveLength(1);
    // The second volume, at the edit point, collapsed.
    expect(collapsed(refreshed[1] as UEFINode)).toBe(true);
  });

  // A shift takes every container it could have moved, where the same stretch's
  // overwrite would have narrowed into the one whose bytes it landed in and
  // left the other's files standing.
  it("takes every container the shift could have moved", () => {
    const { roots } = opened(twoVolumeImage());

    collapsingFrom(roots, 0x4000);

    const refreshed = volumesOf(biosOf(roots));
    expect(collapsed(refreshed[0] as UEFINode)).toBe(true);
    expect(collapsed(refreshed[1] as UEFINode)).toBe(true);
  });
});

describe("the rule the change picks", () => {
  // A same-size edit and a size-changing one are not the same question, and
  // which of the two runs is what `invalidating` decides.
  it("narrows to the one volume when the length did not move", () => {
    const { roots, volumes } = opened(twoVolumeImage());
    const body = bodyOfLastFile(volumes[1] as UEFINode);

    invalidating(roots, range(body.start + 1, body.start + 2), 0);

    const refreshed = volumesOf(biosOf(roots));
    expect(filesOf(refreshed[0] as UEFINode)).toHaveLength(1);
    expect(collapsed(refreshed[1] as UEFINode)).toBe(true);
  });

  it("takes the whole tail for a size change at the same offset", () => {
    const { roots, volumes } = opened(twoVolumeImage());
    const body = bodyOfLastFile(volumes[1] as UEFINode);

    invalidating(roots, range(body.start + 1, body.start + 2), 4);

    const refreshed = volumesOf(biosOf(roots));
    expect(collapsed(refreshed[1] as UEFINode)).toBe(true);
  });
});

/**
 * The same rules over a compressed section: opened, it is a gate point of its
 * own, so an edit over its bytes closes it and an edit elsewhere leaves it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#LazyCompressedSectionTests.testAnEditOverTheSectionClosesItAndAnEditElsewhereDoesNot
 */
describe("invalidating an opened compressed section", () => {
  /** One volume holding a file whose only section is LZMA, and a second volume. */
  function image(): Uint8Array {
    const section = Test.compressionSection(0x02, streamBytes(NAME_LZMA), nameBody().length);
    return concat(
      Test.volume({ length: 0x1000, files: [Test.sectionedFile({ sections: [section] })] }),
      Test.volume({ length: 0x1000, files: [Test.file({ body: bytes(1, 2, 3) })] })
    );
  }

  /** The compressed section: the first volume's first file's first section. */
  const sectionOf = (roots: readonly UEFINode[]): UEFINode =>
    roots[0]?.children[0]?.children[0]?.children[0] as UEFINode;

  /** The tree with the section opened, and the section itself. */
  function opened(): { reader: ImageReader; roots: UEFINode[]; section: UEFINode } {
    const tree = built(image());
    const root = tree.roots[0] as UEFINode;
    const volume = root.children[0] as UEFINode;
    expandNode(tree.reader, volume);
    const file = volume.children[0] as UEFINode;
    const section = file.children[0] as UEFINode;
    expect(section.isExpandable).toBe(true);
    expect(expandNode(tree.reader, section).map((node) => node.name)).toEqual(["InnerDriver"]);
    return { reader: tree.reader, roots: tree.roots, section };
  }

  it("leaves it open for an edit in the other volume", () => {
    const tree = opened();
    const after = invalidating(tree.roots, range(0x1100, 0x1101), 0);
    const section = sectionOf(after);

    expect(section.children.map((node) => node.name)).toEqual(["InnerDriver"]);
  });

  it("closes it for an edit over its own bytes", () => {
    const tree = opened();
    // Inside its body: an edit over a header is an edit that may have moved
    // everything after it, and then the volume around it is what went stale.
    const at = tree.section.body.start + 2;
    const after = invalidating(tree.roots, range(at, at + 1), 0);
    const section = sectionOf(after);

    expect(section.children).toEqual([]);
    // And it can be opened again.
    expect(section.isExpandable).toBe(true);
  });
});
