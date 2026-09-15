import { describe, expect, it } from "vitest";
import { fixtureBytes, LZMA_MODULE_BODY_STREAM } from "@/firmware/compression/testing/lzmaFixtures";
import { crc32 } from "@/firmware/me/crypto/checksum";
import { hex, sha256, sha384 } from "@/firmware/me/crypto/digest";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import { analyzeMeRegion, checksums } from "@/firmware/me/engine/analyzer";
import { CSME12_KEY, CSME12_PROTECTED, CSME12_SIG } from "@/firmware/me/testing/realManifests";
import {
  csmeDatabaseText,
  FIXTURE_KEY_HASH,
  FIXTURE_SIGNATURE_HASH,
  UNKNOWN_SIGNATURE_HASH,
  unrelatedDatabaseText,
} from "@/firmware/me/testing/testDatabase";
import {
  extBlock,
  extConcat,
  extFeaturePermissions,
  extModuleAttributes,
  extPartitionInfo,
  extSignedPackage,
  extSystemInfo,
} from "@/firmware/me/testing/testExtensions";
import {
  cpdDirectory,
  fptRegion,
  manifest,
  putU32,
  type TestManifest,
} from "@/firmware/me/testing/testMe";

/**
 * The analysis end to end — upstream's `IdentificationTests`, which drive the
 * whole pipeline rather than the identifier alone.
 */

/** A region carrying a `$FPT` and the manifest after it. */
function region(
  options: { readonly romBypass?: boolean; readonly manifest?: TestManifest } = {}
): Uint8Array {
  const table = fptRegion({
    entries:
      options.romBypass === true
        ? [{ name: "ROMB", offset: 0x10, size: 0x100, flags: 0x01 }]
        : [{ name: "FTPR", offset: 0x100, size: 0x400, flags: 0x01 }],
  });
  const one = manifest(options.manifest ?? {});
  const bytes = new Uint8Array(table.length + one.length);
  bytes.set(table);
  bytes.set(one, table.length);
  return bytes;
}

const analyze = (databaseText: string, bytes: Uint8Array, baseOffset = 0) =>
  analyzeMeRegion({ bytes, baseOffset, database: MEADatabase.parse(databaseText) });

describe("analyzeMeRegion", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testIdentifiesCSMEFamilyVersionReleaseAndDBRow
  it("names the family, version, release and database row", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.family).toBe("csme");
    expect(result.variant).toBe("CSME");
    expect(result.version).toMatchObject({ major: 15, minor: 40, hotfix: 37, build: 3121 });
    expect(result.version.meMajor).toBe(15);
    expect(result.version.meMinor).toBe(40);
    expect(result.securityVersion).toBe("3");
    expect(result.release).toBe("production");
    expect(result.databaseName).toBe(
      `15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_${FIXTURE_SIGNATURE_HASH}`
    );
    expect(result.issues).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testTheDatabaseSteppingReachesTheAnalysis
  it("brings the database's stepping through to the analysis", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.chipsetStepping).toBe("C");
    expect(result.powerDownMitigation).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeReturnsFPTPartitionsAndSize
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testIdentifiesWithBaseOffset
  it("reports partitions at the caller's own offsets", () => {
    const result = analyze(csmeDatabaseText(), region(), 0x1000);

    expect(result.family).toBe("csme");
    expect(result.regions[0]?.offset).toBe(0x1000 + 0x100);
    expect(result.manifest?.offset).toBe(0x1000 + 0x40);
  });

  it("summarises the manifest it identified against", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.manifest).toMatchObject({
      tag: "$MN2",
      format: "r1",
      day: 24,
      month: 3,
      year: 2021,
      keyHash: FIXTURE_KEY_HASH,
      signatureHash: FIXTURE_SIGNATURE_HASH,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testPreProductionKeyCorrectsWrongProduction
  it("corrects a wrongly production-signed key", () => {
    expect(analyze(csmeDatabaseText({ preKeys: [FIXTURE_KEY_HASH] }), region()).release).toBe(
      "preProduction"
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testDebugSignedFlagMeansPreProduction
  it("reads the debug flag as pre-production", () => {
    expect(analyze(csmeDatabaseText(), region({ manifest: { flags: 0x8000_0001 } })).release).toBe(
      "preProduction"
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testRomBypassPartitionMeansRomBypassRelease
  it("lets a ROM-Bypass partition decide the release", () => {
    expect(analyze(csmeDatabaseText(), region({ romBypass: true })).release).toBe("romBypass");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testUnknownKeyYieldsUnknownFamilyAndNote
  it("notes a key the database does not list", () => {
    const result = analyze(
      unrelatedDatabaseText(),
      region({
        manifest: {
          key: Uint8Array.from({ length: 0x100 }, (_, index) => (0x33 + index) & 0xff),
          signature: Uint8Array.from({ length: 0x100 }, (_, index) => (0xcc - index) & 0xff),
        },
      })
    );

    expect(result.family).toBe("unknown");
    expect(result.variant).toBe("");
    // The version is still a fact read from the manifest.
    expect(result.version.major).toBe(15);
    expect(result.issues.map((one) => one.id)).toEqual([2]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testRecognisedEngineNotInDBGetsNote
  it("notes a recognised engine that is not in the database", () => {
    const result = analyze(csmeDatabaseText({ signature: UNKNOWN_SIGNATURE_HASH }), region());

    expect(result.family).toBe("csme");
    expect(result.databaseName).toBeUndefined();
    expect(result.issues.map((one) => one.id)).toEqual([3]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeWithoutFPTNotesAbsence
  it("notes a region with no partition table", () => {
    const result = analyzeMeRegion({ bytes: manifest() });

    expect(result.issues.map((one) => one.id)).toContain(1);
    expect(result.regions).toEqual([]);
  });

  it("answers a region with no manifest at all without a database", () => {
    // A structural parse needs nothing fetched, which is what keeps a plain
    // partition-table read working with no network.
    const result = analyzeMeRegion({
      bytes: fptRegion({ entries: [{ name: "FTPR", offset: 0x100, size: 0x400 }] }),
    });

    expect(result.family).toBe("unknown");
    expect(result.type).toBe("region");
    expect(result.manifest).toBeUndefined();
    expect(result.rsaSignatureValid).toBeUndefined();
    expect(result.regions).toHaveLength(1);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzePopulatesOperationalCodePartition
  it("reads the directory that owns the manifest", () => {
    // The directory sits before the manifest, and the manifest names no owner:
    // finding it is a walk backwards.
    const directory = cpdDirectory({
      name: "FTPR",
      modules: [{ name: "$MN2" }, { name: "fwupdate" }],
    });
    const one = manifest();
    const bytes = new Uint8Array(directory.length + one.length);
    bytes.set(directory);
    bytes.set(one, directory.length);

    const result = analyzeMeRegion({ bytes, database: MEADatabase.parse(csmeDatabaseText()) });

    expect(result.codePartition?.name).toBe("FTPR");
    expect(result.codePartition?.modules.map((module) => module.name)).toEqual([
      "$MN2",
      "fwupdate",
    ]);
    expect(result.codePartition?.checksumValid).toBe(true);
  });

  it("says nothing about a signature it cannot check", () => {
    // The fixture's manifest declares no size, so it describes no protected
    // window and there is nothing to check the signature against. That is a
    // different answer from "invalid", and running the two together would call
    // every synthetic image corrupt.
    expect(analyze(csmeDatabaseText(), region()).rsaSignatureValid).toBeUndefined();
  });

  it("validates a real manifest's signature, and notices a changed byte", () => {
    // The fixture manifests cannot exercise this — their keys are not moduli —
    // so the check runs against a real one: its own key, signature and
    // protected window, laid out the way a manifest lays them out, with the
    // size fields that describe that window.
    const head = CSME12_PROTECTED.subarray(0, 0x80);
    const tail = CSME12_PROTECTED.subarray(0x80);
    const headerLength = 0x80 + CSME12_KEY.length + 4 + CSME12_SIG.length;
    const bytes = new Uint8Array(headerLength + tail.length);
    bytes.set(head);
    bytes.set(CSME12_KEY, 0x80);
    putU32(bytes, 0x80 + CSME12_KEY.length, 65537);
    bytes.set(CSME12_SIG, 0x80 + CSME12_KEY.length + 4);
    bytes.set(tail, headerLength);
    // The two size fields, in dwords, describing exactly that window.
    putU32(bytes, 0x04, headerLength / 4);
    putU32(bytes, 0x18, bytes.length / 4);

    expect(analyzeMeRegion({ bytes }).rsaSignatureValid).toBe(true);

    const tampered = Uint8Array.from(bytes);
    tampered[bytes.length - 1] = (tampered[bytes.length - 1] ?? 0) ^ 0x01;
    const broken = analyzeMeRegion({ bytes: tampered });
    expect(broken.rsaSignatureValid).toBe(false);
    expect(broken.issues.map((one) => one.id)).toContain(9);
  });
});

// MARK: - Upstream's AnalyzerTests

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    bytes.set(one, at);
    at += one.length;
  }
  return bytes;
}

const ascii = (text: string, width = text.length) => {
  const bytes = new Uint8Array(width);
  bytes.set(Uint8Array.from(text.slice(0, width), (one) => one.charCodeAt(0)));
  return bytes;
};

/** An `$FPT` listing an FTPR at 0x1000, and a manifest there with `after` behind it. */
function ftprRegion(manifestOptions: TestManifest, after: readonly Uint8Array[] = []): Uint8Array {
  const table = fptRegion({
    entries: [{ name: "FTPR", offset: 0x1000, size: 0x4000 }],
    size: 0x1000,
  });
  return concat([table, manifest(manifestOptions), ...after]);
}

describe("the operational manifest's facts", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeR0ManifestFallsBackVcnToSummary
  it("falls back to a pre-CSE manifest's own VCN, with no production bit to read", () => {
    const result = analyzeMeRegion({ bytes: ftprRegion({ format: "r0" }) });

    expect(result.manifest?.format).toBe("r0");
    expect(result.manifest?.vcn).toBe(2);
    expect(result.manifest?.productionReady).toBeUndefined();
    expect(result.vcn).toBe(2);
    expect(result.arbSvn).toBeUndefined();
    expect(result.codePartition).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeSurfacesProductionReadyFromR1PVBit
  it("reads Production Ready from an R1 manifest's flags", () => {
    expect(analyzeMeRegion({ bytes: ftprRegion({ flags: 0x1 }) }).manifest?.productionReady).toBe(
      true
    );
    expect(analyzeMeRegion({ bytes: ftprRegion({ flags: 0x2 }) }).manifest?.productionReady).toBe(
      false
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeDecodesManifestModuleExtensionChain
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeDecodesMetModuleMetadata
  it("decodes a .met companion's body as a chain", () => {
    const manChain = extConcat([extSystemInfo(true), extFeaturePermissions(4, 2)]);
    const one = manifest();
    const manifestBase = 0x10 + 2 * 0x18;
    const manSpan = one.length + manChain.length;
    const metBody = extConcat([extModuleAttributes(true), extBlock(0x09, 0x0c, 0x18)]);
    const metBase = manifestBase + manSpan;
    const directory = cpdDirectory({
      name: "FTPR",
      modules: [
        { name: "$MN2", offset: manifestBase, size: manSpan },
        { name: "kernel.met", offset: metBase, size: metBody.length },
      ],
    });

    const result = analyzeMeRegion({
      bytes: concat([directory, one, manChain, metBody]),
      baseOffset: 0x1000,
    });

    const modules = result.codePartition?.modules ?? [];
    expect(modules).toHaveLength(2);
    expect(modules[0]?.extensions).toEqual(result.codePartition?.extensions);
    expect(modules[0]?.extensions?.map((block) => block.tag)).toEqual([0x00, 0x02]);

    const met = modules[1];
    expect(met?.name).toBe("kernel.met");
    const blocks = met?.extensions ?? [];
    expect(blocks.map((block) => block.tag)).toEqual([0x0a, 0x09]);
    expect(blocks[0]?.offset).toBe(0x1000 + metBase);
    expect(blocks[0]?.moduleAttributes?.moduleHash).toHaveLength(96);
    expect(blocks[1]?.moduleAttributes).toBeUndefined();
    expect(blocks[1]?.specialFiles?.rows).toHaveLength(1);
    expect(result.codePartition?.checksumValid).toBe(true);
  });
});

describe("the code partition's directory", () => {
  const database = MEADatabase.parse("*** Revision r378 ***");
  const directory = () =>
    cpdDirectory({ name: "FTPR", headerVersion: 2, modules: [{ name: "$MN2" }, { name: "rbe" }] });

  // A revision 2 directory stores a CRC-32, and a right one adds no warning.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeValidatesR2CodePartitionChecksum
  it("validates a revision 2 directory's CRC-32", () => {
    const result = analyzeMeRegion({ bytes: concat([directory(), manifest()]), database });

    expect(result.codePartition?.headerVersion).toBe(2);
    expect(result.codePartition?.checksumValid).toBe(true);
    expect(result.issues.every((issue) => issue.severity !== "warning")).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("INVALID"))).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeWarnsOnInvalidChecksumAndOverrun
  it("warns on a wrong checksum and on an empty slot after the entries", () => {
    const corrupt = directory();
    corrupt[0x0c] = (corrupt[0x0c] ?? 0) ^ 0xff; // a partition name byte: the CRC fails
    const result = analyzeMeRegion({
      bytes: concat([corrupt, new Uint8Array(0x18), manifest()]),
      database,
    });

    expect(result.codePartition?.checksumValid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "warning")).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("INVALID"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("empty trailing module"))).toBe(
      true
    );
  });

  // A manifest with no \$CPD over it is still summarised; there is just no
  // code partition to report.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeLeavesCodePartitionNilWithoutOwningCPD
  it("leaves the code partition out when no directory owns the manifest", () => {
    const table = fptRegion({
      entries: [{ name: "FTPR", offset: 0x1000, size: 0x2000, flags: 0 }],
      size: 0x1000,
    });
    const result = analyzeMeRegion({ bytes: concat([table, manifest()]), database });

    expect(result.manifest).toBeDefined();
    expect(result.codePartition).toBeUndefined();
  });

  // The security version comes from the signed package, and the VCN prefers the
  // partition information's over the signed package's; the second partition
  // information tag carries none.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#AnalyzerTests.testAnalyzeHoistsArbSvnAndVcnFromOperationalChain
  it("hoists the security version and the VCN from the manifest's chain", () => {
    const chain = extConcat([
      extSignedPackage(true),
      extPartitionInfo(0x03, true, { vcn: 3 }),
      extPartitionInfo(0x16, true),
    ]);
    const one = manifest();
    const manifestBase = 0x10 + 0x18;
    const bytes = concat([
      cpdDirectory({
        name: "FTPR",
        modules: [{ name: "$MN2", offset: manifestBase, size: one.length + chain.length }],
      }),
      one,
      chain,
    ]);

    const result = analyzeMeRegion({ bytes, baseOffset: 0x1000, database });

    expect(result.codePartition?.extensions?.map((block) => block.tag)).toEqual([0x0f, 0x03, 0x16]);
    expect(result.arbSvn).toBe(5);
    expect(result.vcn).toBe(3);
    expect(result.manifest?.productionReady).toBe(true);
  });
});

// MARK: - The LZMA module check (issue 19)

/**
 * A `$CPD` with a `kernel` module stored as `stream` and a `kernel.met` that
 * advertises LZMA, no encryption and `hash`. Upstream has no analyzer test of
 * this; the check itself follows `lzmaValidationIssues`.
 */
function lzmaModuleRegion(options: {
  readonly stream: Uint8Array;
  readonly hash: Uint8Array;
  readonly compressedSize?: number;
}): Uint8Array {
  const one = manifest();
  const manifestBase = 0x10 + 3 * 0x18;
  const moduleBase = manifestBase + one.length;
  const metBase = moduleBase + options.stream.length;
  // The revised block, with its 48-byte hash: an unidentified family's chain is
  // read that way.
  const met = extModuleAttributes(true);
  met[0x08] = 2; // compression: LZMA
  putU32(met, 0x0c, 3000);
  putU32(met, 0x10, options.compressedSize ?? options.stream.length);
  met.set(options.hash, 0x18);
  const directory = cpdDirectory({
    name: "FTPR",
    modules: [
      { name: "$MN2", offset: manifestBase, size: one.length },
      { name: "kernel", offset: moduleBase, size: 3000 },
      { name: "kernel.met", offset: metBase, size: met.length },
    ],
  });
  return concat([directory, one, options.stream, met]);
}

/** The digest in the order a `.met` stores it: read backwards from the printed form. */
const storedHash = (bytes: Uint8Array) => sha384(bytes).reverse();

const lzmaIssues = (bytes: Uint8Array) =>
  analyzeMeRegion({ bytes })
    .issues.filter((one) => one.id === 19)
    .map((one) => one.message);

describe("the LZMA module check", () => {
  const stream = fixtureBytes(LZMA_MODULE_BODY_STREAM);

  it("passes a module that decompresses and matches its hash", () => {
    const hash = storedHash(stream);
    expect(hex(hash)).not.toBe(hex(sha384(stream)));
    const bytes = lzmaModuleRegion({ stream, hash });
    // The check has something to look at: the `.met` decoded as LZMA.
    const met = analyzeMeRegion({ bytes }).codePartition?.modules.find(
      (one) => one.name === "kernel.met"
    );
    expect(met?.extensions?.[0]?.moduleAttributes?.compression).toBe(2);
    expect(lzmaIssues(bytes)).toEqual([]);
  });

  it("flags a module whose hash does not match", () => {
    const hash = storedHash(stream);
    hash[0] = (hash[0] ?? 0) ^ 0x01;
    expect(lzmaIssues(lzmaModuleRegion({ stream, hash }))).toEqual([
      'Hash of LZMA module "kernel" is invalid.',
    ]);
  });

  it("flags a module that does not decompress", () => {
    const broken = new Uint8Array(stream.length).fill(0xa5);
    expect(lzmaIssues(lzmaModuleRegion({ stream: broken, hash: storedHash(broken) }))).toEqual([
      'LZMA module "kernel" does not decompress.',
    ]);
  });

  it("flags a module that runs past the end of the region", () => {
    expect(
      lzmaIssues(lzmaModuleRegion({ stream, hash: storedHash(stream), compressedSize: 0x10_0000 }))
    ).toEqual(['LZMA module "kernel" extends past the end of the region; cannot verify it.']);
  });
});

// MARK: - Upstream's PreCSEAnalyzerTests and PreCSEModuleAnalyzerTests

/** The real T450 `$SKU` attributes. */
const T450_SKU = concat([
  ascii("$SKU"),
  Uint8Array.of(4, 0, 0, 0, 0xcf, 0xfa, 0xff, 0xff, 0x0a, 0x43, 0, 0),
]);

const databaseNaming = (family: string) =>
  MEADatabase.parse(`*** ME Analyzer Engine Firmware Repository Database ***
*** Revision r378 (2026-09-06 , 14:48) ***

*** RSA Public Keys ***
RSAPKEY_${family}_${FIXTURE_KEY_HASH}`);

const ME10: TestManifest = { format: "r0", major: 10, minor: 0, vcn: 2 };

function mmeRow(name: string, sizeUncompressed: number): Uint8Array {
  const row = new Uint8Array(0x60);
  row.set(ascii("$MME"));
  row.set(ascii(name, 16), 0x04);
  putU32(row, 0x3c, sizeUncompressed);
  return row;
}

function mcpHeader(codeSize: number, offsetPartFPT: number): Uint8Array {
  const header = new Uint8Array(0x44);
  header.set(ascii("$MCP"));
  putU32(header, 0x08, codeSize);
  putU32(header, 0x10, offsetPartFPT);
  return header;
}

describe("a classic ME image", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSETests.swift#PreCSEAnalyzerTests.testAnalyzeFillsSKUPlatformAndVCNForME10R0
  it("fills the SKU, the platform and the manifest's VCN", () => {
    const result = analyzeMeRegion({
      bytes: ftprRegion(ME10, [T450_SKU]),
      database: databaseNaming("ME"),
    });

    expect(result.family).toBe("me");
    expect(result.sku).toBe("5MB");
    expect(result.platform).toBe("WPT-LP");
    expect(result.manifest?.vcn).toBe(2);
    expect(result.manifest?.major).toBe(10);
    expect(result.codePartition).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSETests.swift#PreCSEAnalyzerTests.testAnalyzeLeavesSKUEmptyWhenFamilyIsNotME
  it("leaves the pre-CSE decode alone when the family is not ME", () => {
    const result = analyzeMeRegion({
      bytes: ftprRegion(ME10, [T450_SKU]),
      database: databaseNaming("CSME"),
    });

    expect(result.family).toBe("csme");
    expect(result.sku).toBeUndefined();
    expect(result.manifest?.vcn).toBe(2);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleAnalyzerTests.testAnalyzeSurfacesMMEDirectoryAndMCP
  it("surfaces the $MME directory and its $MCP", () => {
    const result = analyzeMeRegion({
      bytes: ftprRegion({ ...ME10, numModules: 3 }, [
        new Uint8Array(0xc),
        mmeRow("UPDATE", 0x1000),
        mmeRow("BUP", 0x1d000),
        mmeRow("KERNEL", 0x56000),
        new Uint8Array(0x60),
        mcpHeader(0xaf6f4, 0x160000),
        T450_SKU,
      ]),
      database: databaseNaming("ME"),
    });

    expect(result.sku).toBe("5MB");
    expect(result.platform).toBe("WPT-LP");
    const directory = result.mmeDirectory;
    expect(directory?.offset).toBe(0x1000 + 0x284 + 0xc);
    expect(directory?.manifestTag).toBe("$MN2");
    expect(directory?.declaredModules).toBe(3);
    expect(directory?.modules.map((one) => one.name)).toEqual(["UPDATE", "BUP", "KERNEL"]);
    expect(directory?.modules[1]?.sizeUncompressed).toBe(0x1d000);
    expect(directory?.mcp?.codeSize).toBe(0xaf6f4);
    expect(directory?.mcp?.offsetPartFPT).toBe(0x160000);
    expect(result.issues.some((one) => one.id === 11)).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleAnalyzerTests.testAnalyzeNotesTruncatedDirectory
  it("notes a directory that declares more rows than it has", () => {
    const result = analyzeMeRegion({
      bytes: ftprRegion({ ...ME10, numModules: 4 }, [
        new Uint8Array(0xc),
        mmeRow("A", 1),
        mmeRow("B", 1),
        T450_SKU,
      ]),
      database: databaseNaming("ME"),
    });

    expect(result.mmeDirectory?.declaredModules).toBe(4);
    expect(result.mmeDirectory?.modules).toHaveLength(2);
    expect(result.issues.some((one) => one.id === 11 && one.severity === "note")).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleAnalyzerTests.testAnalyzeLeavesMMEInventoryNilForCSME
  it("reads no $MME directory for a CSME", () => {
    const result = analyzeMeRegion({
      bytes: ftprRegion({ ...ME10, numModules: 1 }, [
        new Uint8Array(0xc),
        mmeRow("KERNEL", 0x56000),
        T450_SKU,
      ]),
      database: databaseNaming("CSME"),
    });

    expect(result.family).toBe("csme");
    expect(result.mmeDirectory).toBeUndefined();
  });
});

describe("independent firmware", () => {
  it("analyses each independent partition over its own bytes, once", () => {
    const table = fptRegion({
      entries: [
        { name: "FTPR", offset: 0x1000, size: 0x400 },
        { name: "PMCP", offset: 0x2000, size: 0x400 },
      ],
      size: 0x1000,
    });
    const bytes = concat([
      table,
      manifest({ region: 0x1000 }),
      manifest({ major: 150, minor: 2, hotfix: 10, build: 1015, region: 0x400 }),
    ]);

    const result = analyzeMeRegion({ bytes, baseOffset: 0x8000 });

    expect(result.manifest?.offset).toBe(0x8000 + 0x1000);
    expect(result.independentFirmware).toHaveLength(1);
    const pmc = result.independentFirmware?.[0];
    expect(pmc?.manifest?.offset).toBe(0x8000 + 0x2000);
    expect(pmc?.manifest?.major).toBe(150);
    expect(pmc?.sizeBytes).toBe(0x400);
    expect(pmc?.independentFirmware).toBeUndefined();
  });
});

describe("the region's checksums", () => {
  /** Bytes with no structure in them, every byte distinct enough that a wrong span changes a digest. */
  const checksummed = () =>
    Uint8Array.from({ length: 0x4000 }, (_, index) => (index * 31 + 7) & 0xff);

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#RegionChecksumsTests.testAnalyzeLeavesTheRegionChecksumsForTheCallerToAskFor
  it("are left for the caller to ask for", () => {
    // analyze must not read the whole region three more times.
    const analysis = analyzeMeRegion({ bytes: checksummed() });
    expect(Object.hasOwn(analysis, "checksums")).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#RegionChecksumsTests.testAskingForThemGivesTheSameNumbersTheDigestsDo
  it("give the same numbers the digests do", () => {
    const bytes = checksummed();
    const checks = checksums(bytes);
    expect(checks.sha256).toBe(hex(sha256(bytes)));
    expect(checks.sha384).toBe(hex(sha384(bytes)));
    expect(checks.crc32).toBe(crc32(bytes));
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#RegionChecksumsTests.testAnEmptyRegionHasNothingToMeasure
  it("have nothing to measure in an empty region", () => {
    expect(checksums(new Uint8Array(0))).toEqual({
      sha256: undefined,
      sha384: undefined,
      crc32: undefined,
    });
  });
});
