import { describe, expect, it } from "vitest";
import type { CPDModuleRow, FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import type { CPDExtension } from "@/firmware/me/partition/extensions";
import { analysisWith, manifestFixture } from "@/tools/meaTesting";
import { type MEANode, presentMEA } from "@/tools/meaTree";
import { MEA_TREE_MARKS, type MEAStorage, metadataMarks } from "@/tools/meaTreeMarks";

/**
 * What the ME Full Tree's rows wear (`ROW_MARKS.md` §5.3), read off the tree the
 * curator presents — so the marks are tested where the panel takes them, which
 * is upstream's `MEATreeMarksTests`.
 */

/** A `$CPD` at 0x1000 whose module offsets are absolute, as the analyzer reports them. */
function cpd(modules: readonly CPDModuleRow[], checksumValid: boolean | undefined = true) {
  return {
    name: "FTPR",
    offset: 0x1000,
    headerVersion: 2,
    headerLength: 0x14,
    numModules: modules.length,
    checksumValid,
    modules,
    extensions: [],
  };
}

/** A module's `Module Attributes` block, as a `.met` companion carries one. */
function attributes(compression: number, encryption: number): CPDExtension {
  return {
    tag: 0x0a,
    size: 0x60,
    offset: 0x2000,
    moduleAttributes: {
      compression,
      encryption,
      uncompressedSize: 0x1000,
      compressedSize: 0x80,
      deviceID: 0,
      vendorID: 0x8086,
      moduleHash: "AB",
    },
  };
}

function module(
  name: string,
  options: {
    readonly huffman?: boolean;
    readonly attributes?: CPDExtension;
  } = {}
): CPDModuleRow {
  return {
    name,
    offset: 0x100 * (name.length + 1),
    size: 0x80,
    isHuffman: options.huffman ?? false,
    ...(options.attributes === undefined ? {} : { extensions: [options.attributes] }),
  };
}

const metadataRow = {
  variant: "r2" as const,
  unknown0: 0,
  deviceID: 0,
  vendorID: 0x8086,
  sizeUncompressed: 0x1000,
  sizeCompressed: 0x80,
  bssSize: undefined,
  codeSizeUncompressed: undefined,
  codeBaseAddress: undefined,
  mainThreadEntry: undefined,
  unknown1: undefined,
  unknown2: undefined,
  hash: "CD",
};

function root(title: string, roots: readonly MEANode[]): MEANode {
  const found = roots.find((one) => one.title === title);
  if (found === undefined) throw new Error(`the fixture has no “${title}” group`);
  return found;
}

function modulesIn(roots: readonly MEANode[]): readonly MEANode[] {
  const partition = root("Code Partition ($CPD)", roots);
  return root("Modules", partition.children).children;
}

function rolesOf(roots: readonly MEANode[], name: string) {
  return modulesIn(roots).find((one) => one.title === name)?.marks?.roles ?? [];
}

const present = (overrides: Partial<FirmwareAnalysis>): MEANode[] =>
  presentMEA(analysisWith(overrides), undefined);

describe("the compressed badge", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testCompressedModulesWearTheBadge
  it("gives it to a compressed module, indigo only to the one the metadata table came out of", () => {
    const roots = present({
      codePartition: cpd([
        module("kernel"),
        module("kernel.met", { attributes: attributes(2, 0) }),
        module("pm", { huffman: true }),
        module("crypto"),
        module("crypto.met", { attributes: attributes(2, 1) }),
        module("plain"),
      ]),
      rbePmMetadata: [metadataRow],
    });

    // `kernel` is compressed, but nothing here opens it: the grey badge.
    expect(rolesOf(roots, "kernel")).toEqual([
      { kind: "compressed", algorithm: "LZMA", decoded: false },
    ]);
    // `pm` is what the metadata table below was read out of: the rail's colour.
    expect(rolesOf(roots, "pm")).toEqual([
      { kind: "compressed", algorithm: "Huffman", decoded: true },
    ]);
    // Encrypted, so it cannot be opened, and the words say why.
    expect(rolesOf(roots, "crypto")).toEqual([
      { kind: "compressed", algorithm: "Encrypted LZMA", decoded: false },
    ]);
    expect(rolesOf(roots, "plain")).toEqual([]);
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.module
  it("does not open a metadata module when the table was never read", () => {
    const roots = present({ codePartition: cpd([module("pm", { huffman: true })]) });

    expect(rolesOf(roots, "pm")).toEqual([
      { kind: "compressed", algorithm: "Huffman", decoded: false },
    ]);
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.storage
  it("reads the algorithm from the `.met` companion first, and the flag otherwise", () => {
    // The companion's block wins over the flag: it is what the module says about
    // itself. A module's own chain is never read — only a `<name>.met` row's.
    const roots = present({
      codePartition: cpd([
        module("rbe", { huffman: true }),
        module("rbe.met", { attributes: attributes(2, 0) }),
        module("one", { huffman: true }),
      ]),
    });

    expect(rolesOf(roots, "rbe")).toEqual([
      { kind: "compressed", algorithm: "LZMA", decoded: false },
    ]);
    expect(rolesOf(roots, "one")).toEqual([
      { kind: "compressed", algorithm: "Huffman", decoded: false },
    ]);
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.storage
  it("knows Huffman from its own name when the block is not a compression value", () => {
    // A block whose compression byte is neither 1 nor 2 is not a choice this
    // engine knows, so the module's own flag is the answer.
    const roots = present({
      codePartition: cpd([
        module("pm", { huffman: true }),
        module("pm.met", { attributes: attributes(0, 0) }),
      ]),
    });

    expect(rolesOf(roots, "pm")).toEqual([
      { kind: "compressed", algorithm: "Huffman", decoded: false },
    ]);
  });
});

describe("the issues a module row wears", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testAFailedModuleCheckIsACautionOnItsRow
  it("puts a failed module check on that module's row, beside its badge", () => {
    const roots = present({
      codePartition: cpd([
        module("kernel"),
        module("kernel.met", { attributes: attributes(2, 0) }),
        module("plain"),
      ]),
      issues: [
        {
          id: 19,
          severity: "warning",
          message: 'LZMA module "kernel" does not decompress.',
          module: "kernel",
        },
        { id: 3, severity: "note", message: "This firmware is not in the database." },
      ],
    });
    const kernel = modulesIn(roots).find((one) => one.title === "kernel");

    expect(kernel?.marks?.problem).toEqual({
      isError: false,
      lines: ['LZMA module "kernel" does not decompress.'],
    });
    expect(kernel?.marks?.roles).toEqual([
      { kind: "compressed", algorithm: "LZMA", decoded: false },
    ]);
    // A note about the image is not about any module's row.
    expect(modulesIn(roots).find((one) => one.title === "plain")?.marks?.problem).toBeUndefined();
    // And the issue is still listed where it always was.
    expect(roots.some((one) => one.title === "Issues")).toBe(true);
    expect(MEA_TREE_MARKS.legendMarks).toContain("caution");
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.module
  it("makes an erroring module check an error", () => {
    const roots = present({
      codePartition: cpd([module("kernel")]),
      issues: [
        { id: 20, severity: "error", message: "kernel is not compressed.", module: "kernel" },
      ],
    });

    expect(modulesIn(roots)[0]?.marks?.problem).toEqual({
      isError: true,
      lines: ["kernel is not compressed."],
    });
  });
});

describe("the rail on the metadata rows", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testTheMetadataRowsWearTheRailWhenTheirModuleIsCompressed
  it("draws it when their module is stored compressed, and names that module", () => {
    const compressed = present({
      codePartition: cpd([module("pm", { huffman: true })]),
      rbePmMetadata: [metadataRow],
    });
    const group = root("RBE/PM Metadata", compressed);

    expect(group.marks?.decompressedFrom).toBe(
      "Read out of the pm module, stored Huffman compressed"
    );
    expect(group.marks?.opensDecompressed).toBeUndefined();
    expect(group.children.every((one) => one.marks?.decompressedFrom !== undefined)).toBe(true);

    const plain = present({
      codePartition: cpd([module("pm")]),
      rbePmMetadata: [metadataRow],
    });
    expect(root("RBE/PM Metadata", plain).marks?.decompressedFrom).toBeUndefined();
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.metadata
  it("takes the rail from either module the table is read out of, and from none when neither is here", () => {
    const asRbe = present({
      codePartition: cpd([module("rbe", { huffman: true })]),
      rbePmMetadata: [metadataRow],
    });
    expect(root("RBE/PM Metadata", asRbe).marks?.decompressedFrom).toContain("rbe module");

    // No code partition at all: nothing to have read the table out of.
    expect(metadataMarks(analysisWith({ rbePmMetadata: [metadataRow] }))).toEqual({});
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.metadata
  it("gives the rail to the unmatched-hash rows too, which came out of the same module", () => {
    const roots = present({
      codePartition: cpd([module("pm", { huffman: true })]),
      rbePmMetadata: [metadataRow],
      unmatchedMetadataHashes: ["ABCDEF0123456789ABCDEF"],
    });
    const group = root("RBE/PM Metadata", roots);
    const list = root("Unmatched Hashes", group.children);

    expect(list.marks?.decompressedFrom).toBeDefined();
    expect(list.children[0]?.marks?.decompressedFrom).toBeDefined();
  });
});

describe("the manifest and the tables", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testTheManifestHoldsChecksAndSaysWhenItsSignatureFails
  it("makes the manifest hold the checks, and says when its own signature fails", () => {
    const good = present({ manifest: manifestFixture(), rsaSignatureValid: true });
    const row = root("Manifest", good);

    expect(row.marks?.roles?.[0]?.kind).toBe("holdsChecks");
    expect(row.marks?.roles?.[0]).toHaveProperty("words");
    expect(row.marks?.problem).toBeUndefined();

    const bad = present({ manifest: manifestFixture(), rsaSignatureValid: false });
    expect(root("Manifest", bad).marks?.problem?.isError).toBe(true);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testTablesWithAWrongChecksumAreErrors
  it("makes a wrong checksum an error on the row it belongs to, and not one the version omits", () => {
    const roots = present({
      codePartition: cpd([module("$MN2")], false),
      cseLayoutTable: {
        offset: 0,
        version: 0x17,
        redundancy: false,
        checksumValid: false,
        partitions: [],
      },
      bootPartitions: [
        {
          partitionName: "Boot 1",
          offset: 0x100,
          version: 1,
          redundancy: false,
          checksumValid: true,
          fit: undefined,
          entries: [],
        },
      ],
    });

    expect(root("Code Partition ($CPD)", roots).marks?.problem).toEqual({
      isError: true,
      lines: ["Invalid $CPD CRC-32 checksum"],
    });
    expect(root("CSE Layout Table", roots).marks?.problem).toEqual({
      isError: true,
      lines: ["Invalid CSE Layout Table CRC-32"],
    });
    // A 1.6 table has no CRC to fail.
    const boot = root("Boot Partitions (BPDT)", roots).children[0];
    expect(boot?.marks?.problem).toBeUndefined();
  });

  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.codePartition
  it("names the sum a revision 1 partition carries", () => {
    const roots = present({
      codePartition: { ...cpd([module("$MN2")], false), headerVersion: 1 },
    });

    expect(root("Code Partition ($CPD)", roots).marks?.problem?.lines).toEqual([
      "Invalid $CPD Checksum-8 checksum",
    ]);
  });
});

describe("the legend", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testTheLegendListsNoBackground
  it("lists what this tree draws, and nothing it does not", () => {
    const channels = MEA_TREE_MARKS.legendMarks.map((mark) =>
      mark === "decompressed" ? "rail" : undefined
    );

    // An ME row never sits inside a Boot Guard range, so no background is ever
    // drawn — and none is listed.
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("protectedIBB");
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("protectedFirmware");
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("partlyProtected");
    // No verdicts either: the tree has no microcode to rate.
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("newest");
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("newerListed");
    expect(MEA_TREE_MARKS.legendMarks).not.toContain("newerMaybe");
    // The rail is, because this tree really does decompress (G1 is a UEFI gap).
    expect(channels).toContain("rail");
    expect(MEA_TREE_MARKS.legendMarks).toContain("decompressed");
    expect(MEA_TREE_MARKS.legendMarks).toContain("compressed");
    expect(MEA_TREE_MARKS.legendMarks).toContain("compressedUndecoded");
    expect(MEA_TREE_MARKS.legendMarks).toContain("holdsChecks");
  });
});

describe("storage", () => {
  it("says nothing about compression for a module stored as it is", () => {
    const stored: MEAStorage = { compression: undefined, isEncrypted: false };

    expect(stored.compression).toBeUndefined();
    expect(stored.isEncrypted).toBe(false);
  });
});
