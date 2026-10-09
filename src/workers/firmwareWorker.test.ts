import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { LenovoDMIFormat, smbiosKey } from "@/firmware/lenovoDmi/lenovoDmiFormat";
import { BootGuardImage, bootPolicyV1 } from "@/firmware/testing/testBootGuard";
import * as Test from "@/firmware/testing/testImage";
import { MTM, SERIAL, STANDARD_LOG, testBlock, testLog } from "@/firmware/testing/testLenovoDMI";
import type { FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { guidText } from "@/firmware/uefi/efiGuid";
import { VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { LenovoDMIFirmwareReaders } from "@/firmware/uefi/lenovoDmiFirmwareReaders";
import { NAME_LZMA, nameBody, streamBytes } from "@/firmware/uefi/testing/compressedFixtures";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import type { FirmwareWorkerRequest, FirmwareWorkerResponse, WireNode } from "@/workers/protocol";

/**
 * The bytes behind each `Blob` the test hands the worker. Node cannot read a
 * `Blob` synchronously, so the worker's reader is given the bytes it stands for.
 */
const contents = vi.hoisted(() => new WeakMap<Blob, Uint8Array>());

vi.mock("@/workers/blobByteSource", async () => {
  const { sourceOver } = await import("@/firmware/byteSource");
  return {
    BlobByteSource: class {
      constructor(blob: Blob) {
        const bytes = contents.get(blob);
        if (bytes === undefined) throw new Error("a blob the test did not make");
        // biome-ignore lint/correctness/noConstructorReturn: the stand-in is the source over the blob's bytes
        return sourceOver(bytes);
      }
    },
  };
});

/** Everything the worker has answered, in order. */
let posted: FirmwareWorkerResponse[] = [];
let job = 0;

beforeAll(async () => {
  vi.stubGlobal("self", { postMessage: (message: FirmwareWorkerResponse) => posted.push(message) });
  await import("@/workers/firmware.worker");
});

beforeEach(() => {
  posted = [];
});

/** A `Blob` over `bytes`, as the store hands the worker the pane's content. */
function blobOf(bytes: Uint8Array): Blob {
  const blob = new Blob([]);
  contents.set(blob, bytes);
  return blob;
}

/** Asks the worker, and hands back what it answered. */
function ask<Kind extends FirmwareWorkerResponse["kind"]>(
  request: FirmwareWorkerRequest,
  kind: Kind
): Extract<FirmwareWorkerResponse, { kind: Kind }> {
  posted = [];
  (self as unknown as { onmessage: (event: { data: FirmwareWorkerRequest }) => void }).onmessage({
    data: request,
  });
  const answer = posted.find((one) => one.kind === kind);
  if (answer === undefined) {
    throw new Error(`no ${kind} came back: ${posted.map((one) => one.kind).join(", ")}`);
  }
  return answer as Extract<FirmwareWorkerResponse, { kind: Kind }>;
}

/** Opens `bytes` as the pane's image: the top level, and nothing below what it gates. */
const open = (bytes: Uint8Array) =>
  ask({ kind: "openFirmware", id: ++job, content: blobOf(bytes) }, "firmwareRoots").roots;

/** One node's children, read now. */
const expand = (node: readonly number[]) =>
  ask({ kind: "firmwareChildren", id: ++job, node }, "firmwareChildren").children;

/**
 * The tree as the worker holds it, with nothing opened to answer: no node covers
 * an offset past the end, so the walk to it opens nothing.
 */
const look = (size: number) =>
  ask({ kind: "firmwareNodeAtOffset", id: ++job, offset: size }, "firmwareNodeAtOffset").roots;

/** Down through whatever covers `offset`, opening each branch on the way. */
const chain = (offset: number) =>
  ask({ kind: "firmwareNodeAtOffset", id: ++job, offset }, "firmwareNodeAtOffset");

const addresses = () =>
  ask({ kind: "firmwareAddresses", id: ++job }, "firmwareAddresses").addressDiff;

const invalidate = (bytes: Uint8Array, range: readonly [number, number], sizeDelta = 0) =>
  ask(
    { kind: "firmwareInvalidate", id: ++job, content: blobOf(bytes), range, sizeDelta },
    "firmwareInvalidated"
  ).roots;

const ranges = () => ask({ kind: "firmwareProtectedRanges", id: ++job }, "firmwareProtectedRanges");

/** A node of `nodes`, wherever it is in them. */
function all(nodes: readonly WireNode[]): WireNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children)]);
}

const biosOf = (roots: readonly WireNode[]) =>
  roots[0]?.children.find((child) => child.name === "BIOS region") as WireNode;

const volumeA = Test.volume({
  length: 0x1000,
  files: [Test.file({ body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })],
});
const volumeB = Test.volume({
  length: 0x1000,
  files: [Test.file({ body: new Uint8Array([9, 9, 9]) })],
});

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

/**
 * Two volumes back to back in the BIOS region, so region-level and volume-level
 * expansion can be tested independently of each other.
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

/**
 * The image the second pass is written for: a BIOS region whose last volume ends
 * at the top of the file and holds a Volume Top File.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.anchoredImage
 */
function anchoredImage(): Uint8Array {
  const volume = Test.volume({
    length: 0x1000,
    // Eight bytes, so the file ends eight-byte aligned and the pad file in
    // front of the VTF starts where the walk looks for it.
    files: [Test.file({ body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })],
    lastFile: Test.volumeTopFile({ size: 0x100 }),
  });
  return Test.intelImage({
    size: 0x8000,
    regions: [
      { type: "descriptor", start: 0, end: 0x1000 },
      { type: "me", start: 0x1000, end: 0x2000 },
      { type: "bios", start: 0x7000, end: 0x8000 },
    ],
    contents: new Map<FlashRegionType, Uint8Array>([["bios", volume]]),
  });
}

/**
 * An image whose Boot Policy names one IBB segment and the post-IBB range, with
 * the DXE Core inside an LZMA section.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.bootGuardImage
 */
function bootGuardImage(): { image: BootGuardImage; segment: { start: number; end: number } } {
  const image = new BootGuardImage({ dxeCoreCompressed: true });
  const segment = { start: image.ibb.start, end: image.ibb.start + 0x100 };
  image.install(
    bootPolicyV1({
      segments: [{ base: image.address(segment.start), size: 0x100 }],
      ibbHash: image.sha256Of(segment),
      postIbbHash: image.sha256Of(BootGuardImage.dxeVolume),
    })
  );
  return { image, segment };
}

/**
 * The shared, incrementally read parse — a region's raw-area scan and a volume's
 * file walk deferred until a row asks for them — as the worker holds it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests
 * @upstream-differs the tree is the worker's and each answer is synchronous: what upstream awaits, a request answers at once, and what is being read is the store's (`firmwareAsks.test.ts`)
 */
describe("the lazy tree", () => {
  describe("roots and region-level laziness", () => {
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testRootsAreAvailableImmediatelyWithoutExpandingRegions
    it("has its roots at once, without opening a region", () => {
      const roots = open(twoVolumeImage());
      expect(roots.map((node) => node.kind)).toEqual(["intelImage"]);
      expect(roots[0]?.children.map((node) => node.kind)).toEqual([
        "flashDescriptor",
        "region",
        "padding",
        "region",
      ]);
      const bios = biosOf(roots);
      expect(bios.children).toEqual([]);
      expect(bios.isExpandable).toBe(true);
    });

    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testExpandingARegionRunsInTheBackgroundAndFillsInVolumes
    it("fills a region in with its volumes when it is opened", () => {
      const bios = biosOf(open(twoVolumeImage()));
      const children = expand(bios.id);
      expect(children.filter((node) => node.kind === "volume")).toHaveLength(2);
      // Kept: asking again answers without reading again.
      expect(expand(bios.id).filter((node) => node.kind === "volume")).toHaveLength(2);
    });

    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testAnMERegionThatIsNotReadFurtherIsNeverExpandable
    it("never offers to open an ME region it does not read further", () => {
      const me = open(twoVolumeImage())[0]?.children.find((node) => node.name === "ME region");
      expect(me?.isExpandable).toBe(false);
      expect(me?.children).toEqual([]);
    });
  });

  describe("volume-level laziness", () => {
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testExpandingAVolumeRunsInTheBackgroundAndFillsInFiles
    it("fills a volume in with its files when it is opened", () => {
      const bios = biosOf(open(twoVolumeImage()));
      const first = expand(bios.id)[0] as WireNode;
      expect(first.isExpandable).toBe(true);
      expect(first.children).toEqual([]);

      expect(expand(first.id).filter((node) => node.kind === "file")).toHaveLength(1);
    });

    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testExpandingOneVolumeDoesNotDisturbItsSibling
    it("leaves a volume's sibling closed when it is opened", () => {
      const bytes = twoVolumeImage();
      const bios = biosOf(open(bytes));
      const volumes = expand(bios.id).filter((node) => node.kind === "volume");
      expect(volumes).toHaveLength(2);

      expand((volumes[0] as WireNode).id);

      const sibling = biosOf(look(bytes.length)).children[1] as WireNode;
      expect(sibling.isExpandable).toBe(true);
      expect(sibling.children).toEqual([]);
    });
  });

  describe("addresses, from the VTF and nothing else", () => {
    // The mapping is worked out without opening the containers on the way: the
    // answer matches what a full parse of the same bytes says.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testResolvingAddressesFindsTheVtfWithoutParsingTheImage
    // @upstream-differs no reset vector crosses the wire: the mapping is what the panel asks for
    it("finds the VTF without parsing the image", () => {
      const bytes = anchoredImage();
      open(bytes);

      expect(addresses()).toBe(parseUefiImage(sourceOver(bytes)).addressDiff);
      expect(addresses()).toBeDefined();
      // Nothing was opened to learn it: the VTF ends the image.
      expect(biosOf(look(bytes.length)).children).toEqual([]);
    });

    // The anchor is marked wherever the tree reaches it — which, since the
    // mapping is worked out from the tail without opening anything, is only once
    // the volume holding the VTF has been walked.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testTheVtfIsMarkedFixedOnceItsBranchIsOpen
    it("marks the VTF fixed once its branch is open", () => {
      const bytes = anchoredImage();
      open(bytes);
      expect(addresses()).toBeDefined();
      const vtf = guidText(VOLUME_TOP_FILE);
      expect(all(look(bytes.length)).find((node) => node.guid === vtf)).toBeUndefined();

      const opened = chain(0x7f80).roots;

      expect(all(opened).find((node) => node.guid === vtf)?.isFixed).toBe(true);
    });

    // A programmer can append bytes of its own after the chip's. The VTF ends the
    // BIOS region the descriptor names, not the file, and the tail still answers.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testBytesAppendedAfterTheBiosRegionDoNotHideTheVtf
    it("finds the VTF past bytes appended after the BIOS region", () => {
      const bytes = concat(anchoredImage(), new Uint8Array(0xc00).fill(0xff));
      open(bytes);

      expect(addresses()).toBe(0x1_0000_0000 - 0x8000);
      // Found at the region's end, without a walk.
      expect(biosOf(look(bytes.length)).children).toEqual([]);
    });

    // No VTF is not a defect — a dump of one region has none — and the mapping
    // staying unknown is the whole of what that means.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testAnImageWithNoVtfResolvesToNoMapping
    it("has no mapping for an image with no VTF", () => {
      open(twoVolumeImage());
      expect(addresses()).toBeUndefined();
    });

    // An edit re-opens the question: the anchor may have moved, and the reset
    // vector may be the bytes that were just typed over.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testAnEditMakesTheMappingUnresolvedAgain
    // @upstream-differs the next ask works the mapping out again from the bytes as they now are, where upstream's says it is unresolved until asked: what is asserted is that the answer is the new bytes'
    it("works the mapping out again after an edit", () => {
      const bytes = anchoredImage();
      open(bytes);
      expect(addresses()).toBeDefined();

      // The VTF typed over.
      const edited = Uint8Array.from(bytes);
      edited.fill(0x00, 0x7f00, 0x8000);
      invalidate(edited, [0x7f00, 0x8000]);

      expect(addresses()).toBeUndefined();
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testMaterializingAnOffsetOpensOnlyItsOwnChain
  it("opens only an offset's own chain when it is reached", () => {
    const bytes = twoVolumeImage();
    const bios = biosOf(open(bytes));

    const reached = chain(bios.header[0] + 0x40);

    const path = reached.path ?? [];
    let nodes: readonly WireNode[] = reached.roots;
    const kinds = path.map((index) => {
      const node = nodes[index] as WireNode;
      nodes = node.children;
      return node.kind;
    });
    expect(kinds[0]).toBe("intelImage");
    expect(kinds).toContain("region");
    expect(kinds).toContain("volume");
    // The sibling volume, which the chain never touched, is still closed.
    const sibling = biosOf(reached.roots).children[1] as WireNode;
    expect(sibling.isExpandable).toBe(true);
    expect(sibling.children).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testFullyExpandedMatchesTheEagerParse
  it("matches the eager parse once everything is opened", () => {
    const bytes = twoVolumeImage();
    const eager = parseUefiImage(sourceOver(bytes));

    const expandEverything = (nodes: readonly WireNode[]): WireNode[] =>
      nodes.map((node) => ({
        ...node,
        children: expandEverything(node.isExpandable ? expand(node.id) : node.children),
      }));
    const lazy = expandEverything(open(bytes));

    const shape = (node: { kind: string; name: string }, header: readonly number[]) =>
      `${node.kind} ${node.name} ${header.join("-")}`;
    const eagerAll = (nodes: readonly UEFINode[]): UEFINode[] =>
      nodes.flatMap((node) => [node, ...eagerAll(node.children)]);
    expect(all(lazy).map((node) => shape(node, node.header))).toEqual(
      eagerAll(eager.roots).map((node) => shape(node, [node.header.start, node.header.end]))
    );
  });

  describe("protected ranges", () => {
    // Read over a copy of the tree: the same ranges a whole parse finds — through
    // the compressed section the DXE Core is in — while the tree the reader sees
    // has opened nothing for them.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testProtectedRangesAreReadWithoutOpeningTheTree
    it("reads them without opening the tree", () => {
      const { image } = bootGuardImage();
      const before = open(image.bytes);

      const read = ranges();

      expect(read.ranges.map((one) => one.kind)).toEqual(["ibb", "postIbb"]);
      expect(read.ranges.map((one) => one.verdict)).toEqual(["matches", "matches"]);
      expect(read.raw).toEqual(
        parseUefiImage(sourceOver(image.bytes), { readsProtectedRanges: true }).protectedRanges
      );
      // The reading opened a copy.
      expect(look(image.bytes.length)).toEqual(before);
    });

    // An edit drops what was read off the bytes it changed, and the next reading
    // sees the new bytes.
    // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LazyUEFITreeTests.swift#LazyUEFITreeTests.testAnEditForgetsTheRangesAndTheNextReadingSeesIt
    it("forgets them on an edit, and the next reading sees it", () => {
      const { image, segment } = bootGuardImage();
      open(image.bytes);
      expect(ranges().ranges[0]?.verdict).toBe("matches");

      const edited = Uint8Array.from(image.bytes);
      edited[segment.start] = 0x00;
      invalidate(edited, [segment.start, segment.start + 1]);

      expect(ranges().ranges[0]?.verdict).toBe("mismatch");
    });
  });
});

/**
 * A compressed section, reached by the walk to an offset and opened only when a
 * row asks for it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#LazyCompressedSectionTests
 */
describe("a lazy compressed section", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#LazyCompressedSectionTests.testAReachedSectionIsNotDecodedUntilItIsOpened
  it("is not decoded until it is opened", () => {
    const section = Test.compressionSection(0x02, streamBytes(NAME_LZMA), nameBody().length);
    open(
      concat(
        Test.volume({ length: 0x1000, files: [Test.sectionedFile({ sections: [section] })] }),
        Test.volume({ length: 0x1000, files: [Test.file({ body: new Uint8Array([1, 2, 3]) })] })
      )
    );

    // The section's header is at 0x60: volume header 0x48, file header 0x18.
    const reached = chain(0x70);
    let nodes: readonly WireNode[] = reached.roots;
    let last: WireNode | undefined;
    for (const index of reached.path ?? []) {
      last = nodes[index];
      nodes = last?.children ?? [];
    }
    expect(last?.kind).toBe("section");
    // Reaching it does not open it.
    expect(last?.isExpandable).toBe(true);
    expect(last?.children).toEqual([]);

    const children = expand(last?.id ?? []);
    expect(children.map((node) => node.name)).toEqual(["InnerDriver"]);
    expect(children[0]?.space).toEqual([0x60]);
  });
});

/**
 * Lenovo's DMI store, as the worker finds it for the panel's button and the details: the
 * stores wherever they lie, and which drivers name an entry's key.
 */
describe("the board's identity stores", () => {
  const STORE = Uint8Array.from([
    ...testLog(STANDARD_LOG.slice(2), 0x77),
    ...testBlock({ generation: 3, key: 0x77, entries: [SERIAL, MTM] }),
    ...testBlock({ generation: 4, key: 0x77, entries: [SERIAL] }),
  ]);
  /** A 64 KiB image: the store at `0x8000`, and a driver in a volume at `0x1000`. */
  function image(withDriver: boolean): Uint8Array {
    const bytes = new Uint8Array(0x10000).fill(0xff);
    bytes.set(STORE, 0x8000);
    if (withDriver) {
      const code = Uint8Array.from([
        ...new Array<number>(0x20).fill(0),
        ...LenovoDMIFormat.smbiosNamespace,
        0x00,
        0x04,
      ]);
      const driver = Test.sectionedFile({
        sections: [Test.section({ type: 0x10, body: code }), Test.nameSection("L05SmbiosOverride")],
      });
      bytes.set(Test.volume({ length: 0x1000, files: [driver] }), 0x1000);
    }
    return bytes;
  }

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testTheTreeFindsTheStoreWhereverItLies
  it("finds the store wherever it lies", () => {
    open(image(false));
    expect(ask({ kind: "firmwareDmiStores", id: ++job }, "firmwareDmiStores").stores).toEqual([
      { kind: "lenovoDMIStore", range: [0x8000, 0xc000] },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testAnImageWithoutAStoreHasNone
  it("finds none in an image without a store", () => {
    const bytes = image(false);
    bytes.fill(0xff, 0x8000, 0xc000);
    open(bytes);
    expect(ask({ kind: "firmwareDmiStores", id: ++job }, "firmwareDmiStores").stores).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testTheTreeNamesTheDriversThatReadAnEntry
  it("names the drivers that read an entry, by their files", () => {
    open(image(true));
    const found = ask({ kind: "firmwareLenovoReaders", id: ++job }, "firmwareLenovoReaders");
    expect(found.found).toBe(true);
    const readers = new LenovoDMIFirmwareReaders(new Map(found.readers));
    expect(readers.driversOf(smbiosKey(0x0400))).toEqual(["L05SmbiosOverride"]);
    expect(readers.driversOf(smbiosKey(0x0200))).toEqual([]);
  });

  it("has no readers to name where the image has no Lenovo store", () => {
    const bytes = image(true);
    bytes.fill(0xff, 0x8000, 0xc000);
    open(bytes);
    expect(ask({ kind: "firmwareLenovoReaders", id: ++job }, "firmwareLenovoReaders").found).toBe(
      false
    );
  });
});
