import { describe, expect, it } from "vitest";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import type { MFSStateEFS } from "@/firmware/me/models/firmwareFacts";
import {
  analysisWith,
  bootFixture,
  chipsetInitFixture,
  codePartitionFixture,
  efsVolumeFixture,
  manifestFixture,
  mfsBackupFixture,
  mfsVolumeFixture,
  versionWith,
} from "@/tools/meaTesting";
import {
  CHECKSUMS_TITLE,
  checksumsPath,
  type MEANode,
  meaFieldText,
  meaZones,
  pendingValue,
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
const stateField = (node: MEANode | undefined) =>
  node?.fields.find((one) => one.label === "File System State");

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

  // The image's final Chipset Initialization tables get a root of their own
  // only when the MFS volume's node is not already showing them — which is the
  // CSME 15/16 shape, where the FTPR `intl.cfg` is the only copy.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testChipsetInitIsARootOnlyWhenTheVolumeDoesNotShowIt
  it("gives the chipset tables a root only when the volume does not show them", () => {
    const tables = chipsetInitFixture([{ name: "ADP-LP", steppings: "A" }]);

    // No volume copy: the root carries it.
    const fromFTPR = presentMEA(analysisWith({ chipsetInit: tables }), undefined);
    const root = find("Chipset Initialization", fromFTPR);
    expect(root?.children?.map((one) => one.title)).toEqual(["ADP-LP"]);
    expect(field("Chipsets", root)).toBe("1");

    // The volume holds the same tables: one node, under the volume.
    const fromVolume = presentMEA(
      analysisWith({
        mfsVolume: mfsVolumeFixture({ name: "ADP-LP", steppings: "A" }),
        chipsetInit: tables,
      }),
      undefined
    );
    expect(find("Chipset Initialization", fromVolume)).toBeUndefined();
    expect(
      find("Chipset Initialization", find("File System (MFS)", fromVolume)?.children)
    ).toBeDefined();

    // The two disagree — the FTPR copy replaced the volume's — so each is shown
    // where it came from.
    const disagreeing = presentMEA(
      analysisWith({
        mfsVolume: mfsVolumeFixture({ name: "TGP-LP", steppings: "B" }),
        chipsetInit: tables,
      }),
      undefined
    );
    expect(find("Chipset Initialization", disagreeing)?.children?.map((one) => one.title)).toEqual([
      "ADP-LP",
    ]);
    expect(
      find(
        "Chipset Initialization",
        find("File System (MFS)", disagreeing)?.children
      )?.children?.map((one) => one.title)
    ).toEqual(["TGP-LP"]);
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

describe("the state's basis", () => {
  // The state's own field carries what it rests on in brackets, as the Manufacturing row does: a
  // caution when the EFS step could not be taken, green and plainly worded when it could.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheStateFieldCarriesWhatItRestsOn
  it("is carried in brackets on the state's own field", () => {
    const firmware = (efs: MFSStateEFS) =>
      find(
        "Firmware",
        presentMEA(
          analysisWith({
            mfsState: "configured",
            mfsStateBasis: {
              reservedFiles: { kind: "notRead" },
              efs,
              configuration: ["FITC"],
              decidedBy: "configuration",
            },
          }),
          undefined
        )
      );

    const unread = firmware({ kind: "unreadable", offset: 0x267000 });
    const state = stateField(unread);
    // A state the unread EFS left standing is not drawn as settled.
    expect(state?.tone).toBe("caution");
    expect(state?.value).toBe("Configured");
    // The evidence is kept apart, so it is not drawn in the state's tone.
    expect(state?.evidence).toBe("configuration: FITC; EFS: unreadable");
    expect(state === undefined ? undefined : meaFieldText(state)).toBe(
      "Configured (configuration: FITC; EFS: unreadable)"
    );
    expect(unread?.fields.find((one) => one.label === "State basis")).toBeUndefined();

    const settled = stateField(firmware({ kind: "noFileContent" }));
    expect(settled?.tone).toBe("good");
    expect(settled === undefined ? undefined : meaFieldText(settled)).toBe(
      "Configured (configuration: FITC)"
    );
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

  // A present file has no one range: its chunks are wherever the chain put them,
  // so the row carries them as its extents, and a file from an analysis made
  // before the model kept them carries none.
  // @upstream Packages/MEPresentation/Sources/MEPresentation/MEACurator.swift#MEACurator.addresses
  it("carries a file's extents where the file has them", () => {
    const volume = mfsVolumeFixture();
    const extents = [
      { start: 0x7_2000, end: 0x7_2040 },
      { start: 0x7_1000, end: 0x7_1005 },
    ];
    const withExtents = presentMEA(
      analysisWith({ mfsVolume: { ...volume, files: [{ index: 0, size: 0x45, extents }] } }),
      undefined
    )[1];
    const placed = find("File 0", find("Files", withExtents?.children)?.children);
    expect(placed?.extents).toEqual(extents);
    expect(placed?.range).toBeUndefined();

    const without = presentMEA(analysisWith({ mfsVolume: volume }), undefined)[1];
    expect(find("File 0", find("Files", without?.children)?.children)?.extents).toBeUndefined();
  });
});

describe("the checksums group", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheChecksumsRowWaitsWithPlaceholdersUntilItIsAskedFor
  it("waits with placeholders until it is asked for", () => {
    const roots = presentMEA(analysisWith(), undefined);
    const group = find(CHECKSUMS_TITLE, roots);
    expect(group?.fields.map((one) => one.label)).toEqual(["SHA-256", "SHA-384", "CRC-32"]);
    expect(new Set(group?.fields.map((one) => one.value))).toEqual(new Set([pendingValue()]));
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

describe("what is not known yet", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testFileSystemStateWaitsForTheFileTableOnlyWithAnEFSVolume
  it("makes the File System State of an EFS image wait for the file table, and no other", () => {
    const withEfs = analysisWith({ mfsState: "configured", efsVolume: efsVolumeFixture() });
    const waiting = presentMEA(withEfs, undefined, undefined, undefined, undefined, {
      fileTable: true,
      huffman: false,
    })[0];
    expect(field("File System State", waiting)).toBe(pendingValue());
    expect(field("File System State", presentMEA(withEfs, undefined)[0])).toBe("Configured");

    const without = analysisWith({ mfsState: "configured" });
    const kept = presentMEA(without, undefined, undefined, undefined, undefined, {
      fileTable: true,
      huffman: false,
    })[0];
    expect(field("File System State", kept)).toBe("Configured");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testIssuesSayTheModuleChecksAreToCome
  it("ends the Issues group with the module checks while the dictionaries are on the way", () => {
    const quiet = analysisWith();
    const issues = find(
      "Issues",
      presentMEA(quiet, undefined, undefined, undefined, undefined, {
        fileTable: false,
        huffman: true,
      })
    );
    expect(issues?.children.map((one) => one.title)).toEqual(["Module checks"]);
    expect(issues?.children[0]?.subtitle).toBe(pendingValue());
    expect(find("Issues", presentMEA(quiet, undefined))).toBeUndefined();
  });
});

describe("the bench's own facts on the Firmware row", () => {
  const fileTablePending = { fileTable: true, huffman: false } as const;
  const presentPending = (a: FirmwareAnalysis) =>
    presentMEA(a, undefined, undefined, undefined, undefined, fileTablePending);

  // RPMC's file is found through `FileTable.dat`, so a reading taken without it says it is
  // still loading rather than that the image does not record one; a binding the image did show
  // is a value already.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheRPMCBindingWaitsForTheFileTable
  it("makes the RPMC binding wait for the file table", () => {
    const absent = analysisWith({ hardwareBinding: { kind: "notInImage" } });
    const waiting = presentPending(absent)[0];
    expect(field("RPMC Hardware Binding", waiting)).toBe("Loading…");

    const read = presentMEA(absent, undefined)[0];
    expect(field("RPMC Hardware Binding", read)).toBe("Not recorded in this image");

    const carried = presentPending({ ...absent, hardwareBinding: { kind: "enabled" } })[0];
    expect(field("RPMC Hardware Binding", carried)).toBe("Enabled");
    // The two settled states read as a bench needs them, the same tone the Summary row carries:
    // Disabled green, Enabled the Initialized caution. A byte the tool does not name and the
    // absence stay ordinary.
    expect(tone("RPMC Hardware Binding", carried)).toBe("caution");
    const unbound = presentMEA({ ...absent, hardwareBinding: { kind: "disabled" } }, undefined)[0];
    expect(tone("RPMC Hardware Binding", unbound)).toBe("good");
    expect(tone("RPMC Hardware Binding", read)).toBeUndefined();
  });

  // Manufacturing Lock: the board's own `manuf_lock`, beside the image's verdict — Locked the
  // committed state, Not locked the board that has not been through End of Manufacturing; shown
  // only on a file system whose files carry File IDs, and loading while their table is on the
  // way.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheManufacturingLockIsTheBoardsOwnRecord
  it("reads the Manufacturing Lock from the board's own record", () => {
    const volume = (ftbl: boolean) => ({ ...mfsVolumeFixture(), usesFTBL: ftbl });
    const a = analysisWith({
      mfsVolume: volume(true),
      manifest: manifestFixture(),
      manufacturingBasis: {
        flag: undefined,
        flexible: undefined,
        page: undefined,
        descriptorOpen: undefined,
        liveFilesResolved: true,
      },
    });
    const locked = presentMEA({ ...a, manufacturingLock: { kind: "locked" } }, undefined)[0];
    expect(field("Manufacturing Lock", locked)).toBe("Locked");
    expect(tone("Manufacturing Lock", locked)).toBe("caution");

    const open = presentMEA({ ...a, manufacturingLock: { kind: "open" } }, undefined)[0];
    expect(field("Manufacturing Lock", open)).toBe("Not locked");
    expect(tone("Manufacturing Lock", open)).toBe("good");

    const waiting = presentPending(a)[0];
    expect(field("Manufacturing Lock", waiting)).toBe("Loading…");
    // A board that has made no mark is a dash.
    expect(field("Manufacturing Lock", presentMEA(a, undefined)[0])).toBe("—");

    const legacy = analysisWith({
      mfsVolume: volume(false),
      manifest: manifestFixture(),
      manufacturingLock: { kind: "locked" },
    });
    expect(field("Manufacturing Lock", presentMEA(legacy, undefined)[0])).toBeUndefined();
  });

  // The Boot Guard profile is a number the image holds: profile 0 — nothing verified or
  // measured — is green, every other profile the caution the File System State draws for
  // Initialized.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheBootGuardProfileToneFollowsTheProfile
  it("tones the Boot Guard profile by the profile", () => {
    const none = presentMEA(analysisWith({ bootGuardProfile: "0" }), undefined)[0];
    expect(field("Boot Guard", none)).toBe("0 - No_FVME");
    expect(tone("Boot Guard", none)).toBe("good");

    const fvme = presentMEA(analysisWith({ bootGuardProfile: "5" }), undefined)[0];
    expect(field("Boot Guard", fvme)).toBe("5 - FVME");
    expect(tone("Boot Guard", fvme)).toBe("caution");
  });
});

describe("the tool's own settings", () => {
  // The FPF settings the area records are a group of the full tree, under the tool's own
  // sections: `RPMC Supported` sits in `RpmcConfiguration` with the value the image holds, and
  // the tool's identifiers stand in for the bits it gives no label.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheFPFSettingsAreAGroupOfTheirOwn
  it("makes the FPF settings a group of their own", () => {
    const roots = presentMEA(
      analysisWith({
        version: versionWith(16, 1, 25, 1991),
        uepSettings: [
          { name: "RpmcSupported", value: 0 },
          { name: "RpmcRebindEn", value: 1 },
          { name: "comp_eom", value: 1 },
        ],
      }),
      undefined
    );
    const group = find("FPF Settings", roots);
    // The tool's sections first, and the bits it does not file.
    expect(titles(group?.children ?? [])).toEqual(["RpmcConfiguration", "Other"]);
    const rpmc = group?.children[0]?.children[0];
    expect(rpmc?.title).toBe("RPMC Supported");
    expect(rpmc?.subtitle).toBe("0");
    const rebind = group?.children[0]?.children.at(-1);
    expect(rebind?.title).toBe("RPMC Rebinding Enabled");
    expect(rebind?.subtitle).toBe("1");
    // A bit the tool names by its identifier alone.
    expect(group?.children[1]?.children[0]?.title).toBe("comp_eom");
  });

  // CSME 18's map carries the tool's words for an enumerated value: the profile's 5 is what MFIT
  // calls "Verified and Measured Boot", while a number its documents do not enumerate stays the
  // number.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testAnEnumeratedFPFSettingShowsTheToolsWord
  it("shows the tool's word for an enumerated FPF setting", () => {
    const group = find(
      "FPF Settings",
      presentMEA(
        analysisWith({
          version: versionWith(18, 0, 10, 2288),
          uepSettings: [
            { name: "BTG_PROFILE", value: 5 },
            { name: "OEM_ID", value: 0x103c },
          ],
        }),
        undefined
      )
    );
    expect(titles(group?.children ?? [])).toEqual([
      "BootGuardConfiguration",
      "IntelUniquePlatformIdConfiguration",
    ]);
    const profile = group?.children[0]?.children[0];
    expect(profile?.title).toBe("Boot Guard Profile");
    expect(profile?.subtitle).toBe("Verified and Measured Boot (5)");
    expect(group?.children[1]?.children[0]?.subtitle).toBe("4156");
  });

  // CSME 18's CPU straps are a group of their own, with the tool's words and the message's
  // length and CRC-16 beside them.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheCPUStrapsAreAGroupWithTheToolsWords
  it("makes the CPU straps a group with the tool's words", () => {
    const group = find(
      "CPU straps",
      presentMEA(
        analysisWith({
          version: versionWith(18, 0, 10, 2288),
          cpuStraps: {
            messageLengthWords: 3,
            crcStored: 0xd6ce,
            crcValid: true,
            readings: [
              { name: "CPU_smip_Strap_CPU_SMT_Disable", value: 0 },
              { name: "CPU_smip_Strap_CPU_NUM_OF_SOC_ATOM_CORES", value: 2 },
            ],
          },
        }),
        undefined
      )
    );
    expect(group?.fields.map((one) => one.value)).toEqual(["3 words", "0xD6CE", "Yes"]);
    expect(titles(group?.children ?? [])).toEqual([
      "Disable Hyperthreading",
      "Number of Active Small Cores",
    ]);
    expect(group?.children.map((one) => one.subtitle)).toEqual(["No (0)", "2 Cores Active (2)"]);
  });

  // The MIP table's other containers — CSME and IOE — are groups of their own, with the tool's
  // words for their values.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheMIPStrapContainersAreGroupsOfTheirOwn
  it("makes the MIP strap containers groups of their own", () => {
    const roots = presentMEA(
      analysisWith({
        version: versionWith(18, 0, 10, 2288),
        mipStraps: [
          {
            name: "CSME",
            blockType: 0,
            length: 8,
            readings: [
              { name: "CSME_smip_Strap_CSME_Early_USB_DbC_ME_Boot_Stall_Enable", value: 1 },
            ],
          },
          {
            name: "IOE",
            blockType: 4,
            length: 208,
            readings: [{ name: "IOE_smip_Strap_IOEP_PCIED_LNREV", value: 1 }],
          },
          {
            name: "PMC SoC",
            blockType: 1,
            length: 72,
            readings: [{ name: "PMC_SoC_smip_Strap_T573_TIMING", value: 3 }],
          },
          {
            name: "CPU 2",
            blockType: 3,
            length: 24,
            readings: [{ name: "CPU_2_smip_Strap_CPU2_SMT_Disable", value: 1 }],
          },
          {
            name: "PMC SOC 2",
            blockType: 3,
            length: 72,
            readings: [{ name: "PMC_SOC_2_smip_Strap_pmc_soc_smip2_CPWRG_STCH_WTDIS", value: 1 }],
          },
        ],
      }),
      undefined
    );
    const soc = find("PMC SoC straps", roots);
    expect(titles(soc?.children ?? [])).toEqual([
      "PCH clock output stable to PROCPWRGD high (tPCH45)",
    ]);
    expect(soc?.children[0]?.subtitle).toBe("1ms (3)");
    const cpu2 = find("CPU 2 straps", roots);
    expect(titles(cpu2?.children ?? [])).toEqual(["Disable Hyperthreading"]);
    expect(cpu2?.children[0]?.subtitle).toBe("Yes (1)");
    expect(find("PMC SOC 2 straps", roots)).toBeDefined();
    const csme = find("CSME straps", roots);
    expect(csme?.fields.map((one) => one.value)).toEqual(["0", "8 bytes"]);
    expect(titles(csme?.children ?? [])).toEqual(["Enable early USB2 DbC connection"]);
    expect(csme?.children[0]?.subtitle).toBe("Yes (1)");
    const ioe = find("IOE straps", roots);
    expect(titles(ioe?.children ?? [])).toEqual(["PCIe Controller 4 (Port 13-16)"]);
    expect(ioe?.children[0]?.subtitle).toBe("1x4 Lane Reversed (1)");
  });

  // The SPHY OEM configuration is a group of its own: the tool's field names with the image's
  // values, shown flat.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheSphyNvarIsAGroup
  it("makes the SPHY OEM configuration a group", () => {
    const group = find(
      "SPHY OEM configuration",
      presentMEA(
        analysisWith({
          version: versionWith(18, 0, 10, 2288),
          sphyNvar: [
            { name: "SPHY_OEM_NVAR_Common_Header_1", value: 3 },
            { name: "Sub_Section_Entry0_Header_1", value: 5 },
          ],
        }),
        undefined
      )
    );
    expect(group?.fields.map((one) => one.value)).toEqual(["2"]);
    expect(titles(group?.children ?? [])).toEqual([
      "SPHY_OEM_NVAR_Common_Header_1",
      "Sub_Section_Entry0_Header_1",
    ]);
    expect(group?.children.map((one) => one.subtitle)).toEqual(["3", "5"]);
  });

  // The feature pins the image configures are a group of their own: one row per pin, named by
  // what the pin is for (its usage) and located by group and pad, with the file and the copy the
  // bytes came from beside them.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEACuratorTests.swift#MEACuratorTests.testTheGPIOPinsAreAGroup
  it("makes the GPIO pins a group", () => {
    const pin = (
      usage: string,
      usageID: number,
      group: string,
      groupID: number,
      pad: number,
      ownership: string,
      ownershipID: number,
      padMode: string,
      padModeID: number
    ) => ({
      feature: undefined,
      featureID: undefined,
      usage,
      usageID,
      group,
      groupID,
      pad,
      ownership,
      ownershipID,
      padMode,
      padModeID,
    });
    const group = find(
      "GPIO Pins",
      presentMEA(
        analysisWith({
          version: versionWith(11, 8, 92, 4222),
          gpioPins: {
            path: "/home/gpio/csme_pins",
            fromImage: false,
            pins: [
              pin("NFC_RST", 0, "GPP_E", 4, 4, "HOST_MODE", 0, "DEFAULT_MODE", 4),
              pin("FWUPDATE", 8, "GPP_B", 1, 15, "CSME_MODE", 1, "GPIO_MODE", 0),
            ],
          },
        }),
        undefined
      )
    );
    expect(group?.fields.map((one) => one.value)).toEqual([
      "/home/gpio/csme_pins",
      "ME file system",
    ]);
    expect(titles(group?.children ?? [])).toEqual(["NFC_RST", "FWUPDATE"]);
    expect(group?.children.map((one) => one.subtitle)).toEqual(["GPP_E_4", "GPP_B_15"]);
    expect(group?.children[1]?.fields.map((one) => one.value)).toEqual([
      "GPP_B_15",
      "FWUPDATE",
      "CSME_MODE",
      "GPIO_MODE",
    ]);
  });
});
