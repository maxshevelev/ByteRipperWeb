import { describe, expect, it } from "vitest";
import { guidText } from "@/firmware/uefi/efiGuid";
import { AMI_HASH_FILE, PHOENIX_HASH_FILE } from "@/firmware/uefi/knownGuids";
import { rowMarkChannel, type ToolRowMarks } from "@/tools/toolRowMarks";
import {
  checksumProblems,
  holdsChecks,
  UEFI_TREE_MARKS,
  uefiTreeMarks,
} from "@/tools/uefi/uefiTreeMarks";
import type { WireDiagnostic, WireNode, WireProtectedRange } from "@/workers/protocol";

/**
 * The UEFI tree's row marks (`Design/ROW_MARKS.md` §5.1), decided without a
 * window — upstream's `UEFITreeMarksTests`.
 *
 * Upstream hands `marks(for:in:)` a `UEFINode` and its image; this port hands
 * `uefiTreeMarks` the node the panel holds, as the worker wired it, plus the
 * parse's diagnostics — so a test builds that pair and states what the panel
 * gets. The one gap this port has and upstream has not is checked here too: the
 * Boot Guard background is never drawn (G3).
 */

const LZMA = { algorithm: "LZMA", decodes: true };

/**
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.section
 */
const section = (options: { isExpandable?: boolean; children?: WireNode[] } = {}): WireNode =>
  wire({
    kind: "section",
    subtype: 0x01,
    name: "LZMA compressed section",
    header: [0x60, 0x69],
    body: [0x69, 0x100],
    tail: [0x100, 0x100],
    compression: LZMA,
    ...(options.isExpandable === undefined ? {} : { isExpandable: options.isExpandable }),
    ...(options.children === undefined ? {} : { children: options.children }),
  });

/**
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.inner
 */
const inner = (): WireNode =>
  wire({ kind: "file", name: "Driver", header: [0, 0x18], body: [0x18, 0x40], space: [0x60] });

const hasRail = (marks: ToolRowMarks) =>
  marks.decompressedFrom !== undefined || marks.opensDecompressed === true;
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
    space: options.space ?? [],
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
    const opened = uefiTreeMarks({ node: section({ children: [inner()] }), diagnostics: [] });
    expect(opened.roles).toEqual([{ kind: "compressed", algorithm: "LZMA", decoded: true }]);

    const closed = uefiTreeMarks({ node: section({ isExpandable: true }), diagnostics: [] });
    expect(closed.roles).toEqual([{ kind: "compressed", algorithm: "LZMA", decoded: true }]);
    // Not opened yet is not a failure.
    expect(closed.problem).toBeUndefined();
  });

  /**
   * A node inside a compressed section wears the rail, and its tooltip says
   * which section the bytes came out of.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testANodeInsideWearsTheRailAndSaysWhereFrom
   */
  it("gives a node inside the rail, and says where from", () => {
    const roots = [section({ children: [inner()] })];
    const marks = uefiTreeMarks({ node: inner(), diagnostics: [], roots });

    expect(marks.decompressedFrom).toBe("Decompressed from LZMA compressed section at 0x60");
    expect(marks.problem).toBeUndefined();
    expect(marks.roles).toEqual([]);
  });

  /**
   * A section whose row is open on what came out of it starts the rail its
   * subtree wears, so the two read as one bracket; its bytes are still the
   * file's, so it says no "decompressed from". Shut, it has nothing to tie the
   * rail to — even with the branch read.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testASectionStartsTheRailOnlyWhileItsRowIsOpen
   */
  it("starts the rail at a section only while its row is open", () => {
    const opened = section({ children: [inner()] });
    const open = uefiTreeMarks({ node: opened, diagnostics: [], isOpen: true });
    expect(open.opensDecompressed).toBe(true);
    expect(hasRail(open)).toBe(true);
    expect(open.decompressedFrom).toBeUndefined();

    // Read, but shut.
    expect(hasRail(uefiTreeMarks({ node: opened, diagnostics: [], isOpen: false }))).toBe(false);
    // Nothing under it yet.
    const closed = section({ isExpandable: true });
    expect(hasRail(uefiTreeMarks({ node: closed, diagnostics: [], isOpen: true }))).toBe(false);
  });

  /**
   * A section that did not decompress is a caution, in the parse's own words.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeMarksTests.swift#UEFITreeMarksTests.testASectionThatDidNotDecompressIsACaution
   */
  it("makes a section that did not decompress a caution", () => {
    const failed = section();
    const marks = uefiTreeMarks({
      node: failed,
      diagnostics: [diagnostic("LZMA data does not decompress", 0x60)],
    });

    expect(marks.roles).toEqual([{ kind: "compressed", algorithm: "LZMA", decoded: false }]);
    expect(marks.problem?.lines).toEqual(["LZMA data does not decompress"]);
    expect(marks.problem?.isError).toBe(false);
    // Nothing came out of it to bracket.
    expect(hasRail(marks)).toBe(false);
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

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ProtectionMarksTests.swift#ProtectionMarksTests.testRangesNotReadYetMarkNothing
  it("marks nothing while the ranges have not been read", () => {
    const marks = uefiTreeMarks({
      node: wire({ kind: "file", name: "Driver", compression: undefined }),
      diagnostics: [],
    });

    expect(marks.protection).toBeUndefined();
    expect(marks.roles).toEqual([]);
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
      "protectedIBB",
      "protectedFirmware",
      "decompressed",
      "error",
      "caution",
      "compressed",
      "compressedUndecoded",
      "holdsChecks",
      "partlyProtected",
    ]);
    for (const mark of UEFI_TREE_MARKS.legendMarks) {
      expect(["background", "problem", "role", "rail"]).toContain(rowMarkChannel(mark));
    }
  });
});

/**
 * The Boot Guard marks of the UEFI tree. Ported from upstream's
 * `ProtectionMarksTests`, which hands `marks(for:in:)` an image; this port hands
 * the panel's own nodes and the ranges as the worker wired them.
 */
describe("what the protected ranges mark", () => {
  const driver = () =>
    wire({ id: [0, 0], kind: "file", name: "Driver", header: [0x48, 0x60], body: [0x60, 0x200] });
  const hashes = () =>
    wire({
      id: [0, 1],
      kind: "file",
      name: "Hashes",
      guid: AMI_HASH_TEXT,
      header: [0x200, 0x218],
      body: [0x218, 0x280],
    });
  const volume = () =>
    wire({
      id: [0],
      kind: "volume",
      name: "FFSv2",
      header: [0, 0x48],
      body: [0x48, 0x1000],
      children: [driver(), hashes()],
    });

  const range = (options: {
    kind: string;
    range?: readonly [number, number];
    source: readonly [number, number];
    verdict?: WireProtectedRange["verdict"];
    isIbb?: boolean;
  }): WireProtectedRange => ({
    kind: options.kind,
    range: options.range,
    source: options.source,
    algorithms: ["SHA-256"],
    verdict: options.verdict ?? "matches",
    name: options.kind === "ibb" ? "Boot Guard IBB segment" : "AMI vendor hash range (v2)",
    isIbb: options.isIbb ?? options.kind === "ibb",
  });

  const marksOf = (node: WireNode, ranges: readonly WireProtectedRange[]) =>
    uefiTreeMarks({ node, diagnostics: [], roots: [volume()], protectedRanges: ranges });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ProtectionMarksTests.swift#ProtectionMarksTests.testANodeInsideTheIBBIsTintedAndAVolumePartlyInsideWearsTheBadge
  it("tints a node inside the IBB, and badges a volume only partly inside", () => {
    const ranges = [range({ kind: "ibb", range: [0x48, 0x200], source: [0x900, 0x940] })];

    expect(marksOf(driver(), ranges).protection).toBe("ibb");
    // A volume is not tinted for bytes it mostly is not.
    expect(marksOf(volume(), ranges).protection).toBeUndefined();
    expect(marksOf(volume(), ranges).roles).toEqual([{ kind: "partlyProtected" }]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ProtectionMarksTests.swift#ProtectionMarksTests.testAFirmwareCheckedRangeIsTheOtherTint
  it("gives a firmware-checked range the other tint", () => {
    const ranges = [range({ kind: "amiV2", range: [0x48, 0x200], source: [0x218, 0x240] })];

    expect(marksOf(driver(), ranges).protection).toBe("firmware");
  });

  /**
   * The hash file wears the badge of what it holds, and the mismatch of a range
   * it names — as does the node the range starts at.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/ProtectionMarksTests.swift#ProtectionMarksTests.testTheHashFileHoldsChecksAndAMismatchIsAnError
   */
  it("badges the hash file and makes a mismatch an error", () => {
    const ranges = [
      range({ kind: "amiV2", range: [0x48, 0x200], source: [0x218, 0x240], verdict: "mismatch" }),
    ];

    const hashFile = marksOf(hashes(), ranges);
    expect(hashFile.roles?.some((role) => role.kind === "holdsChecks")).toBe(true);
    expect(hashFile.problem?.isError).toBe(true);
    expect(marksOf(driver(), ranges).problem?.isError).toBe(true);
  });

  /**
   * The reference never compares the IBB digest, so a mismatch here is a caution
   * until boards known to boot confirm it.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/ProtectionMarksTests.swift#ProtectionMarksTests.testAnIBBThatDoesNotMatchIsACaution
   */
  it("makes an IBB that does not match a caution", () => {
    const ranges = [
      range({ kind: "ibb", range: [0x48, 0x200], source: [0x900, 0x940], verdict: "mismatch" }),
    ];

    expect(marksOf(driver(), ranges).problem?.isError).toBe(false);
  });
});
