import { describe, expect, it } from "vitest";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import {
  analysisWith,
  bootFixture,
  codePartitionFixture,
  manifestFixture,
  mfsBackupFixture,
  mfsVolumeFixture,
  versionWith,
} from "@/tools/meaTesting";
import {
  CHECKSUMS_TITLE,
  checksumsPath,
  type MEANode,
  meaZones,
  PENDING_VALUE,
  presentMEA,
} from "@/tools/meaTree";

/** Ported from upstream's `MEACuratorTests` — the curated tree and its one zone. */

const field = (label: string, node: MEANode | undefined) =>
  node?.fields.find((one) => one.label === label)?.value;
const tone = (label: string, node: MEANode | undefined) =>
  node?.fields.find((one) => one.label === label)?.tone;
const find = (title: string, nodes: readonly MEANode[] | undefined) =>
  nodes?.find((one) => one.title === title);
const region = (name: string, offset: number, size: number) => ({
  index: 0,
  name,
  offset,
  size,
  flags: 0x8000,
});
const titles = (nodes: readonly MEANode[]) => nodes.map((one) => one.title);

describe("group presence and order", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testPresentSkipsAbsentGroupsAndOrdersTheRest
  it("skips absent groups and orders the rest", () => {
    const roots = presentMEA(
      analysisWith({ regions: [region("FTPR", 0x1000, 0x12_5000)] }),
      undefined
    );
    // Checksums is the exception: it is the row selected to ask for the digests.
    expect(titles(roots)).toEqual(["Firmware", "Regions (FPT)", "Checksums"]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testStructuralGroupsAppearInFixedOrder
  it("puts the structural groups in a fixed order", () => {
    const roots = presentMEA(
      analysisWith({
        regions: [region("rbe", 0x100, 0x1000)],
        cseLayoutTable: {
          offset: 0,
          version: 0x17,
          redundancy: true,
          checksumValid: true,
          partitions: [{ name: "Data", offset: 0, size: 0x400, empty: false }],
        },
        bootPartitions: [bootFixture(true)],
      }),
      undefined
    );
    expect(titles(roots)).toEqual([
      "Firmware",
      "Regions (FPT)",
      "CSE Layout Table",
      "Boot Partitions (BPDT)",
      "Checksums",
    ]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testCodeAndManifestThenMFSThenFactGroupsOrder
  it("puts the code partition and manifest, then the MFS, before the fact groups", () => {
    const roots = presentMEA(
      analysisWith({
        codePartition: codePartitionFixture(),
        manifest: manifestFixture(),
        mfsVolume: mfsVolumeFixture(),
        issues: [{ id: 1, severity: "warning", message: "odd" }],
      }),
      { sha256: "ABCDEF", sha384: undefined, crc32: undefined }
    );
    expect(titles(roots)).toEqual([
      "Firmware",
      "Code Partition ($CPD)",
      "Manifest",
      "File System (MFS)",
      "Checksums",
      "Issues",
    ]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testPathsAreStablePerRootAndChild
  it("keeps paths stable per root and child", () => {
    const roots = presentMEA(
      analysisWith({ regions: [region("FTPR", 0x1000, 0x1000), region("FTUE", 0x2000, 0x800)] }),
      undefined
    );
    expect(roots[0]?.path).toEqual([0]);
    expect(roots[1]?.path).toEqual([1]);
    expect(roots[1]?.children[0]?.path).toEqual([1, 0]);
    expect(roots[1]?.children[1]?.path).toEqual([1, 1]);
  });
});

describe("the identity", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testIdentityFieldsAndSubtitle
  it("says what the firmware is, and leaves out what is empty", () => {
    const firmware = presentMEA(
      analysisWith({
        securityVersion: "3",
        platform: "CNL",
        version: versionWith(15, 40, 37, 3121, [15, 40, 37, 3121]),
      }),
      undefined
    )[0];
    expect(firmware?.title).toBe("Firmware");
    expect(firmware?.subtitle).toBe("CSME · 15.40.37.3121");
    expect(field("Family", firmware)).toBe("CSME");
    expect(field("Version", firmware)).toBe("15.40.37.3121");
    expect(field("MEU Version", firmware)).toBe("15.40.37.3121");
    expect(field("Release", firmware)).toBe("Production");
    expect(field("Size", firmware)).toBe("0x200000 (2097152 bytes)");
    expect(field("SKU", firmware)).toBeUndefined();
    expect(field("RSA Signature Valid", firmware)).toBeUndefined();
  });

  // The one row of this group that is a verdict, and the detail draws it as
  // one: the same tone the Summary tab's row carries, so a reader comparing the
  // two panels cannot find two colours for one fact.
  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEACurator.swift#MEACurator.firmware
  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.fileSystemState
  it("carries the File System State's status on the field", () => {
    const state = (mfsState: FirmwareAnalysis["mfsState"]) =>
      presentMEA(analysisWith({ mfsState }), undefined)[0];

    expect(field("File System State", state("configured"))).toBe("Configured");
    expect(tone("File System State", state("configured"))).toBe("good");
    expect(tone("File System State", state("unconfigured"))).toBe("good");
    expect(tone("File System State", state("initialized"))).toBe("caution");
    expect(tone("File System State", state("error"))).toBe("bad");
    // And every other row of the group is an ordinary value.
    expect(tone("Family", state("configured"))).toBeUndefined();
  });
});

describe("the layout", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testRegionRowSubtitleRangeAndDetail
  it("gives a region its range, second line and detail", () => {
    const regions = presentMEA(
      analysisWith({ regions: [region("FTPR", 0x1000, 0x12_5000)] }),
      undefined
    )[1];
    expect(regions?.subtitle).toBe("1 region");
    const ftpr = find("FTPR", regions?.children);
    expect(ftpr?.subtitle).toBe("0x1000 · 0x125000");
    expect(ftpr?.range).toEqual({ start: 0x1000, end: 0x12_6000 });
    expect(field("Offset", ftpr)).toBe("0x1000");
    expect(field("Size", ftpr)).toBe("0x125000 (1200128 bytes)");
    expect(field("Flags", ftpr)).toBe("0x00008000");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testAnEmptySectionSaysEmptyAndIsMarkedAsOne
  it("says Empty for a section that holds nothing, and marks it", () => {
    const roots = presentMEA(
      analysisWith({
        regions: [region("FTPR", 0x1000, 0x12_5000), region("FTUP", 0x5000, 0)],
        cseLayoutTable: {
          offset: 0,
          version: 0x17,
          redundancy: false,
          checksumValid: true,
          partitions: [{ name: "Boot 2", offset: 0x1000, size: 0x400, empty: true }],
        },
      }),
      undefined
    );
    const regions = find("Regions (FPT)", roots);
    const empty = find("FTUP", regions?.children);
    expect(empty?.subtitle).toBe("0x5000 · Empty");
    expect(field("Size", empty)).toBe("Empty");
    expect(empty?.isEmptySection).toBe(true);
    expect(empty?.range).toBeUndefined();
    const real = find("FTPR", regions?.children);
    expect(real?.subtitle).toBe("0x1000 · 0x125000");
    expect(real?.isEmptySection).toBe(false);

    const slot = find("Boot 2", find("CSE Layout Table", roots)?.children);
    expect(slot?.isEmptySection).toBe(true);
    expect(field("Size", slot)).toBe("0x400 (1024 bytes)");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testCseLayoutRowsAndBootPartitionNesting
  it("nests boot partitions under their tables", () => {
    const roots = presentMEA(
      analysisWith({
        cseLayoutTable: {
          offset: 0,
          version: 0x17,
          redundancy: true,
          checksumValid: true,
          partitions: [{ name: "Data", offset: 0x1000, size: 0x400, empty: false }],
        },
        bootPartitions: [bootFixture(true)],
      }),
      undefined
    );
    const cse = roots[1];
    expect(field("Checksum Valid", cse)).toBe("Yes");
    const data = find("Data", cse?.children);
    expect(data?.range).toEqual({ start: 0x1000, end: 0x1400 });
    expect(field("Empty", data)).toBe("No");

    const bp1 = find("Boot 1", find("Boot Partitions (BPDT)", roots)?.children);
    expect(field("Version", bp1)).toBe("IFWI 1.7");
    const ftpr = find("FTPR", bp1?.children);
    expect(field("Type", ftpr)).toBe("0x0002");
    expect(ftpr?.range).toEqual({ start: 0x5_9000, end: 0x17_e000 });
  });
});

describe("the code partition and manifest", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testCodePartitionModulesAndExtensions
  it("lists modules and extensions at their absolute bytes", () => {
    const cpd = presentMEA(analysisWith({ codePartition: codePartitionFixture() }), undefined)[1];
    expect(cpd?.subtitle).toBe("FTPR · R1");
    expect(field("Header", cpd)).toBe("R1");
    expect(field("Header Length", cpd)).toBe("0x10");
    const modules = find("Modules", cpd?.children);
    expect(modules?.subtitle).toBe("1 module");
    const man = find("$MN2", modules?.children);
    expect(man?.subtitle).toBe("0x1010 · 0x284");
    expect(man?.range).toEqual({ start: 0x1010, end: 0x1294 });
    const init = find("Init Script", find("Extensions", cpd?.children)?.children);
    expect(field("Tag", init)).toBe("0x01");
    expect(init?.range).toEqual({ start: 0x1040, end: 0x1048 });
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testExtensionPayloadIsDumpedFieldByField
  it("dumps an extension's payload field by field", () => {
    const cpd = presentMEA(
      analysisWith({
        codePartition: codePartitionFixture([
          {
            tag: 0x0f,
            size: 0x34,
            offset: 0x1048,
            signedPackage: {
              partitionName: "NVM0",
              vcn: 3,
              usageBitmap: "",
              arbSvn: 6,
              fwType: undefined,
              fwSku: undefined,
              nvmCompatibility: undefined,
            },
          },
        ]),
      }),
      undefined
    )[1];
    const signed = find("Signed Package", find("Extensions", cpd?.children)?.children);
    expect(field("Tag", signed)).toBe("0x0F");
    expect(field("partitionName", signed)).toBe("NVM0");
    expect(field("arbSvn", signed)).toBe("6");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testHuffmanModuleGetsNoRange
  it("gives a Huffman module no range", () => {
    const fixture = codePartitionFixture();
    const cpd = presentMEA(
      analysisWith({
        codePartition: {
          ...fixture,
          modules: fixture.modules.map((one) => ({ ...one, isHuffman: true })),
        },
      }),
      undefined
    )[1];
    const man = find("$MN2", find("Modules", cpd?.children)?.children);
    expect(man?.range).toBeUndefined();
    expect(man?.subtitle).toBe("0x284 (644 bytes)");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testManifestFields
  it("says what the manifest carries", () => {
    const m = presentMEA(analysisWith({ manifest: manifestFixture() }), undefined)[1];
    expect(m?.title).toBe("Manifest");
    expect(m?.subtitle).toBe("$MN2 · R1");
    expect(field("Format", m)).toBe("R1");
    expect(field("Version", m)).toBe("15.40.37.3121");
    expect(field("Date", m)).toBe("2021-03-24");
    expect(field("Production Ready", m)).toBe("Yes");
    expect(m?.range).toBeUndefined();
  });
});

describe("the MFS volume", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testMFSFilesAreListedWithoutRange
  it("lists its files without a range", () => {
    const mfs = presentMEA(analysisWith({ mfsVolume: mfsVolumeFixture() }), undefined)[1];
    expect(mfs?.title).toBe("File System (MFS)");
    expect(field("Page Size", mfs)).toBe("0x1000 (4096 bytes)");
    expect(field("Signature Valid", mfs)).toBe("Yes");
    const files = find("Files", mfs?.children);
    const f0 = find("File 0", files?.children);
    expect(field("Index", f0)).toBe("0");
    expect(f0?.range).toBeUndefined();
    expect(find("File 2", files?.children)).toBeUndefined();
  });
});

describe("the checksums group", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheChecksumsRowWaitsWithPlaceholdersUntilItIsAskedFor
  it("waits with placeholders until it is asked for", () => {
    const roots = presentMEA(analysisWith(), undefined);
    const group = find(CHECKSUMS_TITLE, roots);
    expect(group?.fields.map((one) => one.label)).toEqual(["SHA-256", "SHA-384", "CRC-32"]);
    expect(new Set(group?.fields.map((one) => one.value))).toEqual(new Set([PENDING_VALUE]));
    expect(checksumsPath(roots)).toEqual(group?.path);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheChecksumsRowShowsTheNumbersOnceTheyArrive
  it("shows the numbers once they arrive", () => {
    const group = find(
      CHECKSUMS_TITLE,
      presentMEA(analysisWith(), { sha256: "AA", sha384: "BB", crc32: 0x1234_5678 })
    );
    expect(group?.fields).toEqual([
      { label: "SHA-256", value: "AA" },
      { label: "SHA-384", value: "BB" },
      { label: "CRC-32", value: "0x12345678" },
    ]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testAnAnsweredButEmptyChecksumsDropsTheRow
  it("goes when it was asked for and nothing came back", () => {
    const roots = presentMEA(analysisWith(), {
      sha256: undefined,
      sha384: undefined,
      crc32: undefined,
    });
    expect(find(CHECKSUMS_TITLE, roots)).toBeUndefined();
    expect(checksumsPath(roots)).toBeUndefined();
  });
});

describe("the fact groups", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testIssuesAndMFSBackupAppearWhenPresent
  it("show issues and an MFS backup when present", () => {
    const roots = presentMEA(
      analysisWith({
        issues: [{ id: 1, severity: "error", message: "checksum mismatch" }],
        mfsBackup: mfsBackupFixture(),
      }),
      undefined
    );
    expect(titles(roots)).toEqual(["Firmware", "MFS Backup", "Checksums", "Issues"]);

    const issue = find("Issues", roots)?.children[0];
    expect(issue?.title).toBe("Error");
    expect(issue?.subtitle).toBe("checksum mismatch");

    const backup = find("MFS Backup", roots);
    expect(backup?.subtitle).toBe("R1");
    expect(field("File", find("Entry 6", backup?.children))).toBe("Intel Configuration");
  });
});

describe("the zone a row publishes", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testZoneForByteRangeAndEmptyOtherwise
  it("is one focused zone for a row's bytes, and nothing otherwise", () => {
    const roots = presentMEA(
      analysisWith({ regions: [region("FTPR", 0x1000, 0x1000)] }),
      undefined
    );
    const map = meaZones(roots[1]?.children[0]);
    expect(map.zones).toHaveLength(1);
    expect(map.focus).toBe("1/0");
    expect(map.zones[0]).toEqual({ id: "1/0", name: "FTPR", start: 0x1000, end: 0x2000 });
    expect(meaZones(undefined).zones).toEqual([]);
    expect(meaZones(roots[0]).zones).toEqual([]);
  });
});

describe("the RBE/PM metadata table", () => {
  const metadataRow = {
    variant: "r4" as const,
    unknown0: 0,
    deviceID: 0,
    vendorID: 0x8086,
    sizeUncompressed: 0x1000,
    sizeCompressed: 0x800,
    bssSize: undefined,
    codeSizeUncompressed: undefined,
    codeBaseAddress: undefined,
    mainThreadEntry: undefined,
    unknown1: undefined,
    unknown2: undefined,
    hash: "00",
  };

  // The hashes no module accounts for are listed under the metadata table, with
  // its count in the table's detail; with every hash accounted for the detail
  // says so, with the done mark, and there is nothing to list.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEATreeMarksTests.swift#MEATreeMarksTests.testTheUnmatchedHashesAreListedUnderTheMetadataTable
  it("lists the unmatched hashes under it", () => {
    const left = presentMEA(
      analysisWith({
        rbePmMetadata: [metadataRow],
        unmatchedMetadataHashes: ["ABCDEF0123456789ABCDEF"],
      }),
      undefined
    );
    const group = find("RBE/PM Metadata", left);
    const count = group?.fields.find((one) => one.label === "Unmatched Hashes");
    expect(count?.value).toBe("1");
    // A hash left over is no done mark.
    expect(count?.tone ?? "standard").toBe("standard");
    const list = find("Unmatched Hashes", group?.children);
    expect(list?.children.map((one) => one.title)).toEqual(["Hash 1"]);
    expect(list?.children[0]?.fields).toEqual([{ label: "Hash", value: "ABCDEF0123456789ABCDEF" }]);

    const none = presentMEA(
      analysisWith({ rbePmMetadata: [metadataRow], unmatchedMetadataHashes: [] }),
      undefined
    );
    const accounted = find("RBE/PM Metadata", none);
    const verdict = accounted?.fields.find((one) => one.label === "Unmatched Hashes");
    expect(verdict?.value).toBe("None");
    // Every hash accounted for wears the done mark.
    expect(verdict?.tone).toBe("good");
    expect(find("Unmatched Hashes", accounted?.children)).toBeUndefined();
  });
});

describe("the unlock token", () => {
  const RESERVED_FF = "FF".repeat(0x1b);

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheUnlockTokenNodeCarriesItsFactsAndItsBytes
  it("carries its facts and its bytes on one node", () => {
    const roots = presentMEA(
      analysisWith({
        unlockTokenFlags: [
          { partition: "UTOK", offset: 0x461_fe0, delayedAuthMode: 0, reservedHex: RESERVED_FF },
        ],
      }),
      undefined
    );
    const node = find("Unlock Token", roots);
    expect(node?.subtitle).toBe("0x461FE0");
    expect(node?.range).toEqual({ start: 0x461_fe0, end: 0x462_000 });
    expect(node === undefined ? undefined : field("Partition", node)).toBe("UTOK");
    expect(node === undefined ? undefined : field("Offset", node)).toBe("0x461FE0");
    expect(node === undefined ? undefined : field("Delayed Authentication Mode", node)).toBe("No");
    expect(node === undefined ? undefined : field("Reserved", node)).toBe(`0x${RESERVED_FF}`);
    expect(node?.children).toEqual([]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheDelayedAuthenticationModeIsWordedNotRounded
  it("words the delayed authentication mode rather than rounding it", () => {
    const mode = (raw: number) => {
      const roots = presentMEA(
        analysisWith({
          unlockTokenFlags: [
            { partition: "UTOK", offset: 0x1000, delayedAuthMode: raw, reservedHex: "00" },
          ],
        }),
        undefined
      );
      const node = find("Unlock Token", roots);
      return node === undefined ? undefined : field("Delayed Authentication Mode", node);
    };
    expect(mode(0)).toBe("No");
    expect(mode(1)).toBe("Yes");
    expect(mode(3)).toBe("Unknown (3)");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTwoTokensAreNamedByTheirPartitions
  it("names two tokens by their partitions", () => {
    const roots = presentMEA(
      analysisWith({
        unlockTokenFlags: [
          { partition: "UTOK", offset: 0x1000, delayedAuthMode: 0, reservedHex: "00" },
          { partition: "STKN", offset: 0x9000, delayedAuthMode: 1, reservedHex: "00" },
        ],
      }),
      undefined
    );
    expect(find("Unlock Token", roots)).toBeUndefined();
    expect(find("Unlock Token (UTOK)", roots)).toBeDefined();
    const stkn = find("Unlock Token (STKN)", roots);
    expect(stkn === undefined ? undefined : field("Delayed Authentication Mode", stkn)).toBe("Yes");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testAnImageWithoutTheFlagsHasNoNode
  it("has no node for an image without the flags", () => {
    expect(find("Unlock Token", presentMEA(analysisWith(), undefined))).toBeUndefined();
  });
});
