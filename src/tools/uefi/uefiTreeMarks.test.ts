import { describe, expect, it } from "vitest";
import { guidText } from "@/firmware/uefi/efiGuid";
import { AMI_HASH_FILE, PHOENIX_HASH_FILE } from "@/firmware/uefi/knownGuids";
import { rowMarkChannel } from "@/tools/toolRowMarks";
import {
  checksumProblems,
  holdsChecks,
  UEFI_TREE_MARKS,
  uefiTreeMarks,
} from "@/tools/uefi/uefiTreeMarks";
import type { WireDiagnostic, WireNode } from "@/workers/protocol";

/**
 * The UEFI tree's row marks (`Design/ROW_MARKS.md` §5.1), decided without a
 * window — upstream's `UEFITreeMarksTests`.
 *
 * Upstream hands `marks(for:in:)` a `UEFINode` and its image; this port hands
 * `uefiTreeMarks` the node the panel holds, as the worker wired it, plus the
 * parse's diagnostics — so a test builds that pair and states what the panel
 * gets. The two gaps this port has and upstream has not are checked here too:
 * the rail is never drawn (G1) and neither is the background (G3).
 */

const LZMA = { algorithm: "LZMA", decodes: true };
/** A node's GUID as the wire carries it: text, not the value. */
const AMI_HASH_TEXT = guidText(AMI_HASH_FILE);
const PHOENIX_HASH_TEXT = guidText(PHOENIX_HASH_FILE);

function wire(options: Partial<WireNode> = {}): WireNode {
  const header: readonly [number, number] = options.header ?? [0, 0x18];
  return {
    id: options.id ?? [0],
    kind: options.kind ?? "file",
    subtype: options.subtype,
    name: options.name ?? "Driver",
    guid: options.guid,
    header,
    body: options.body ?? [0x18, 0x40],
    tail: options.tail ?? [0x40, 0x40],
    isFixed: options.isFixed ?? false,
    isCompressed: options.isCompressed ?? false,
    compression: options.compression,
    isErased: options.isErased ?? false,
    isExpandable: options.isExpandable ?? false,
    childDepth: options.childDepth ?? 0,
    typeText: options.typeText ?? "",
    subtypeText: options.subtypeText ?? "",
    children: options.children ?? [],
  };
}

const diagnostic = (message: string, offset: number): WireDiagnostic => ({
  message,
  severity: "error",
  offset,
});

describe("what a row wears", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testAPlainNodeWearsNothing
  it("gives a plain node nothing", () => {
    const marks = uefiTreeMarks({
      node: wire({ kind: "padding", name: "Padding", header: [0, 0x10], body: [0x10, 0x10] }),
      diagnostics: [],
    });

    expect(marks.problem).toBeUndefined();
    expect(marks.roles).toEqual([]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testAWrongChecksumIsAnError
  it("makes a wrong checksum an error, saying what the sum is", () => {
    const node = wire({ header: [0, 0x18], body: [0x18, 0x40] });
    const marks = uefiTreeMarks({
      node,
      diagnostics: [
        diagnostic("Invalid file header checksum: 0x12345678, should be 0x9ABCDEF0", 0x04),
        diagnostic("Invalid file body checksum: 0x11111111, should be 0x22222222", 0x20),
      ],
    });

    expect(marks.problem?.isError).toBe(true);
    expect(marks.problem?.lines).toEqual([
      "Invalid file header checksum: 0x12345678, should be 0x9ABCDEF0",
      "Invalid file body checksum: 0x11111111, should be 0x22222222",
    ]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testAnOpenedOrOpenableSectionWearsTheCompressedBadge
  it("gives a compressed section the badge, and no problem for not being opened yet", () => {
    const open = uefiTreeMarks({
      node: wire({ kind: "section", name: "LZMA compressed section", compression: LZMA }),
      diagnostics: [],
    });
    expect(open.roles).toEqual([{ kind: "compressed", algorithm: "LZMA", decoded: false }]);
    expect(open.problem).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testAnUndecodedAlgorithmIsGreyAndNotAProblem
  it("marks an algorithm this port does not decode as such, and not as a problem", () => {
    const marks = uefiTreeMarks({
      node: wire({
        kind: "section",
        name: "Brotli compressed section",
        compression: { algorithm: "Brotli", decodes: false },
      }),
      diagnostics: [],
    });

    expect(marks.roles).toEqual([{ kind: "compressed", algorithm: "Brotli", decoded: false }]);
    expect(marks.problem).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testANodeInsideWearsTheRailAndSaysWhereFrom
  // @upstream-differs G1 is not ported, so no node's bytes came out of anywhere
  // and neither `decompressedFrom` nor `opensDecompressed` is ever set
  it("draws no rail and no background, because G1 and G3 are not ported", () => {
    const marks = uefiTreeMarks({
      node: wire({ kind: "file", name: "Driver", compression: undefined }),
      diagnostics: [],
    });

    expect(marks.decompressedFrom).toBeUndefined();
    expect(marks.opensDecompressed).toBeUndefined();
    expect(marks.protection).toBeUndefined();
    // And so the legend says nothing it cannot draw.
    expect(UEFI_TREE_MARKS.legendMarks).not.toContain("decompressed");
    expect(UEFI_TREE_MARKS.legendMarks).not.toContain("protectedIBB");
    expect(UEFI_TREE_MARKS.legendMarks).not.toContain("protectedFirmware");
    expect(UEFI_TREE_MARKS.legendMarks).not.toContain("partlyProtected");
  });
});

describe("the checksums a node is reported for", () => {
  // @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.checksumText
  it("takes only the sums reported inside the node's own range", () => {
    const node = wire({ header: [0x100, 0x118], body: [0x118, 0x140] });

    expect(
      checksumProblems(node, [
        diagnostic("Invalid file header checksum", 0x100),
        diagnostic("Invalid file body checksum", 0x118),
        diagnostic("Invalid file body checksum", 0x13f),
        // The node before it ends where this one begins.
        diagnostic("Invalid file body checksum", 0xff),
        // And the next one's header starts where this one's range does not reach.
        diagnostic("Invalid file body checksum", 0x140),
      ])
    ).toEqual([
      "Invalid file header checksum",
      "Invalid file body checksum",
      "Invalid file body checksum",
    ]);
  });

  it("ignores a diagnostic that is not about a checksum", () => {
    const node = wire({ header: [0, 0x18], body: [0x18, 0x40] });

    expect(
      checksumProblems(node, [diagnostic("The volume's block map is not in ascending order", 0x20)])
    ).toEqual([]);
  });
});

describe("what holds a list of protected ranges", () => {
  // @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.holdsChecks
  it("names the vendor hash table a file withholds, and only those", () => {
    expect(holdsChecks(wire({ kind: "file", guid: AMI_HASH_TEXT }))).toContain(
      "AMI vendor hash table"
    );
    expect(holdsChecks(wire({ kind: "file", guid: PHOENIX_HASH_TEXT }))).toContain(
      "Phoenix vendor hash table"
    );
    expect(holdsChecks(wire({ kind: "file", guid: PHOENIX_HASH_TEXT }))).toContain(
      "ranges the firmware checks at boot"
    );
  });

  it("says nothing about a file that holds none, or about a node that is not a file", () => {
    expect(holdsChecks(wire({ kind: "file" }))).toBeUndefined();
    expect(holdsChecks(wire({ kind: "volume", guid: AMI_HASH_TEXT }))).toBeUndefined();
    expect(holdsChecks(wire({ kind: "file", guid: "not a guid" }))).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.holdsChecks
  it("wears the badge for it", () => {
    const marks = uefiTreeMarks({
      node: wire({ kind: "file", guid: AMI_HASH_TEXT }),
      diagnostics: [],
    });

    expect(marks.roles).toHaveLength(1);
    expect(marks.roles?.[0]?.kind).toBe("holdsChecks");
  });

  // @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.holdsChecks
  it("recognises a hash table by GUID and nothing else, since the Insyde arm is unported (G6)", () => {
    // Upstream's third arm keys on the `flashDeviceMapStore` *kind*, which this
    // port has not typed, so nothing here can wear that badge.
    expect(
      holdsChecks(wire({ kind: "file", guid: "1B45CC0A-156A-428A-AF62-49864DA0E6E6" }))
    ).toBeUndefined();
    expect(
      holdsChecks(wire({ kind: "file", guid: "00000000-0000-0000-0000-000000000000" }))
    ).toBeUndefined();
  });
});

describe("the legend", () => {
  // @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.legendMarks
  it("lists exactly the marks this tree draws", () => {
    expect(UEFI_TREE_MARKS.legendMarks).toEqual([
      "error",
      "caution",
      "compressed",
      "compressedUndecoded",
      "holdsChecks",
    ]);
    for (const mark of UEFI_TREE_MARKS.legendMarks) {
      expect(["problem", "role"]).toContain(rowMarkChannel(mark));
    }
  });
});
