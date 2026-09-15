import { describe, expect, it } from "vitest";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import {
  buildSummary,
  COMING_SOON,
  type MEASummaryRow,
  type MEASummaryValue,
  shown,
} from "@/tools/me/meaSummary";
import {
  analysisWith,
  bootFixture,
  manifestFixture,
  mfsVolumeFixture,
  versionWith,
} from "@/tools/me/meaTesting";

/** Ported from upstream's `MEASummaryTests`. */

const tableRows = (a: FirmwareAnalysis): readonly MEASummaryRow[] => buildSummary(a)[0]?.rows ?? [];
const value = (label: string, rows: readonly MEASummaryRow[]): MEASummaryValue | undefined =>
  rows.find((row) => row.label === label)?.value;
const tone = (label: string, rows: readonly MEASummaryRow[]) =>
  rows.find((row) => row.label === label)?.tone;
const identified = (overrides: Partial<FirmwareAnalysis> = {}) =>
  analysisWith({ manifest: manifestFixture(), ...overrides });
const manifestOn = (year: number, month: number, day: number, productionReady?: boolean) => ({
  ...manifestFixture(),
  year,
  month,
  day,
  productionReady,
});

describe("the primary table, filled in", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testAnIdentifiedImageReadsInLedgerOrder
  it("reads an identified image in ledger order", () => {
    const rows = tableRows(
      identified({
        manifest: manifestOn(2018, 5, 6, true),
        securityVersion: "1",
        arbSvn: 2,
        vcn: 7,
        nvmCompatibility: 2,
        sku: "Consumer H",
        mfsState: "initialized",
        mfsVolume: mfsVolumeFixture({ name: "CNP/CMP-H", steppings: "BA" }),
        bootPartitions: [bootFixture(true)],
        firmwareSizeBytes: 0x27_c000,
        fwUpdateSupport: "no",
        version: versionWith(15, 40, 37, 3121, [1, 4, 0, 14]),
      })
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Family",
      "Version",
      "Release",
      "Type",
      "SKU",
      "Chipset",
      "NVM Compatibility",
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
      "OEM Configuration",
      "FWUpdate Support",
      "Date",
      "File System State",
      "Size",
      "Flash Image Tool",
      "Manifest Extension Utility",
    ]);
    expect(value("NVM Compatibility", rows)).toEqual(shown("SPI"));
    expect(value("Manifest Extension Utility", rows)).toEqual(shown("1.4.0.0014"));
    expect(value("Family", rows)).toEqual(shown("CSME"));
    expect(value("Version", rows)).toEqual(shown("15.40.37.3121"));
    expect(value("Release", rows)).toEqual(shown("Production"));
    expect(value("Type", rows)).toEqual(COMING_SOON);
    expect(value("SKU", rows)).toEqual(shown("Consumer H"));
    expect(value("Chipset", rows)).toEqual(shown("CNP/CMP-H B,A"));
    expect(value("TCB Security Version Number", rows)).toEqual(shown("1"));
    expect(value("ARB Security Version Number", rows)).toEqual(shown("2"));
    expect(value("Version Control Number", rows)).toEqual(shown("7"));
    expect(value("Production Ready", rows)).toEqual(shown("Yes"));
    expect(value("OEM Configuration", rows)).toEqual(COMING_SOON);
    expect(value("FWUpdate Support", rows)).toEqual(shown("No"));
    expect(value("Date", rows)).toEqual(shown("2018-05-06"));
    expect(value("File System State", rows)).toEqual(shown("Initialized"));
    expect(value("Size", rows)).toEqual(shown("0x27C000 (2605056 bytes)"));
    expect(value("Flash Image Tool", rows)).toEqual(shown("12.0.3.1091"));
    expect(value("Chipset Stepping", rows)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTypeRowReflectsClassifierAxis
  it("shows the classifier's word on its axis, and a promise off it", () => {
    const typeRow = (type: FirmwareAnalysis["type"]) =>
      value("Type", tableRows(identified({ type })));
    expect(typeRow("extracted")).toEqual(shown("Extracted"));
    expect(typeRow("stock")).toEqual(shown("Stock"));
    expect(typeRow("update")).toEqual(shown("Update"));
    expect(typeRow("region")).toEqual(COMING_SOON);
    expect(typeRow("unknown")).toEqual(COMING_SOON);
    expect(value("Type", tableRows(analysisWith({ type: "extracted" })))).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testOEMConfigurationRowSaysYesOrNo
  it("says Yes or No for OEM Configuration, only for the OEM families", () => {
    expect(value("OEM Configuration", tableRows(identified({ oemCustomized: true })))).toEqual(
      shown("Yes")
    );
    expect(value("OEM Configuration", tableRows(identified({ oemCustomized: false })))).toEqual(
      shown("No")
    );
    expect(value("OEM Configuration", tableRows(identified()))).toEqual(COMING_SOON);
    expect(
      value(
        "OEM Configuration",
        tableRows(identified({ family: "me", variant: "ME", oemCustomized: true }))
      )
    ).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testFlashImageToolRowShowsNAWithoutARealFIT
  it("reads the Flash Image Tool as N/A on a boot table with no real FIT", () => {
    expect(
      value("Flash Image Tool", tableRows(identified({ bootPartitions: [bootFixture(false)] })))
    ).toEqual(shown("N/A"));
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testFlashImageToolRowReadsNonIFWIFPTHeaderFIT
  it("reads a non-IFWI image's $FPT header FIT", () => {
    expect(
      value(
        "Flash Image Tool",
        tableRows(identified({ fptHeaderFIT: { major: 11, minor: 0, hotfix: 10, build: 1002 } }))
      )
    ).toEqual(shown("11.0.10.1002"));
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testFlashImageToolRowAbsentOnNonIFWIWithoutFIT
  it("has no Flash Image Tool row on a non-IFWI image without a FIT", () => {
    expect(value("Flash Image Tool", tableRows(identified()))).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testFileSystemStateCarriesItsStatusTone
  it("colours the File System State by its status", () => {
    const state = (mfsState: FirmwareAnalysis["mfsState"]) => tableRows(identified({ mfsState }));
    expect(value("File System State", state("unconfigured"))).toEqual(shown("Unconfigured"));
    expect(tone("File System State", state("unconfigured"))).toBe("good");
    expect(value("File System State", state("configured"))).toEqual(shown("Configured"));
    expect(tone("File System State", state("configured"))).toBe("good");
    expect(value("File System State", state("initialized"))).toEqual(shown("Initialized"));
    expect(tone("File System State", state("initialized"))).toBe("caution");
    expect(value("File System State", state("error"))).toEqual(shown("Error"));
    expect(tone("File System State", state("error"))).toBe("bad");
    expect(tone("Family", state("configured"))).toBe("standard");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testChipsetRowsWhenThereAreLettersOrNot
  it("chooses the chipset row upstream's way", () => {
    const bare = identified({ mfsVolume: mfsVolumeFixture({ name: "CNP/CMP-H", steppings: "" }) });
    expect(value("Chipset", tableRows(bare))).toEqual(shown("CNP/CMP-H"));

    const stepped = tableRows(identified({ chipsetStepping: "BA" }));
    expect(value("Chipset Stepping", stepped)).toEqual(shown("B, A"));
    expect(value("Chipset", stepped)).toBeUndefined();

    const neither = tableRows(identified());
    expect(value("Chipset", neither)).toEqual(shown("Unknown"));
    expect(value("Chipset Stepping", neither)).toBeUndefined();

    const unnamed = tableRows(analysisWith({ chipsetStepping: "B" }));
    expect(value("Chipset", unnamed)).toBeUndefined();
    expect(value("Chipset Stepping", unnamed)).toBeUndefined();

    const pchc = tableRows(
      identified({
        family: "pchc",
        variant: "PCHC",
        mfsVolume: mfsVolumeFixture({ name: "CNP/CMP-H", steppings: "BA" }),
      })
    );
    expect(value("Chipset", pchc)).toBeUndefined();
    expect(value("Chipset Stepping", pchc)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testSizeRowPrefersTheFirmwaresOwnEnd
  it("prefers the firmware's own end for the Size", () => {
    expect(value("Size", tableRows(identified({ firmwareSizeBytes: 0x27_c000 })))).toEqual(
      shown("0x27C000 (2605056 bytes)")
    );
    expect(value("Size", tableRows(identified()))).toEqual(shown("0x200000 (2097152 bytes)"));
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testNVMCompatibilityRowOnlyWhenAMediumIsNamed
  it("names the storage medium only when there is one", () => {
    const nvm = (raw: number | undefined) =>
      value("NVM Compatibility", tableRows(identified({ nvmCompatibility: raw })));
    expect(nvm(1)).toEqual(shown("UFS"));
    expect(nvm(2)).toEqual(shown("SPI"));
    expect(nvm(3)).toEqual(shown("Unknown (3)"));
    expect(nvm(0)).toBeUndefined();
    expect(nvm(undefined)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testManifestExtensionUtilityRowOnlyForARealMEUStamp
  it("shows the MEU stamp only for a manifest MEU actually built", () => {
    const meu = (major: number | undefined) =>
      value(
        "Manifest Extension Utility",
        tableRows(
          identified({
            version: versionWith(
              15,
              40,
              37,
              3121,
              major === undefined ? undefined : [major, 4, 0, 14]
            ),
          })
        )
      );
    expect(meu(1)).toEqual(shown("1.4.0.0014"));
    expect(meu(0)).toBeUndefined();
    expect(meu(0xffff)).toBeUndefined();
    expect(meu(undefined)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheME7RowsAreME7s
  it("gives ME 7 its own rows", () => {
    const me7 = { family: "me", variant: "ME", version: versionWith(7, 1, 40, 1214) } as const;
    const seven = tableRows(
      identified({
        ...me7,
        patsburgSupport: true,
        downgradeBlacklist: {
          sevenZero: { minor: 0, hotfix: 10, build: 1200 },
          sevenOne: undefined,
        },
      })
    );
    expect(value("Patsburg Support", seven)).toEqual(shown("Yes"));
    expect(value("Downgrade Blacklist 7.0", seven)).toEqual(shown("<= 7.0.10.1200"));
    expect(value("Downgrade Blacklist 7.1", seven)).toEqual(shown("Empty"));

    const unread = tableRows(identified(me7));
    expect(value("Patsburg Support", unread)).toEqual(COMING_SOON);
    expect(value("Downgrade Blacklist 7.0", unread)).toEqual(shown("Empty"));

    const eight = tableRows(
      identified({
        family: "me",
        variant: "ME",
        version: versionWith(8, 1, 40, 1214),
        patsburgSupport: true,
      })
    );
    expect(value("Patsburg Support", eight)).toBeUndefined();
    expect(value("Downgrade Blacklist 7.0", eight)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testChipsetSupportRowNamesThePlatformWhenThereIsOne
  it("closes the table with the platform, when the engine named one", () => {
    const rows = tableRows(identified({ platform: "ADP/RPP" }));
    expect(value("Chipset Support", rows)).toEqual(shown("ADP/RPP"));
    expect(rows.at(-1)?.label).toBe("Chipset Support");
    expect(value("Chipset Support", tableRows(identified()))).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheSecurityRowsFollowTheFamilyAndMajor
  it("follows the family and major for the security rows", () => {
    const labels = (family: FirmwareAnalysis["family"], major: number) =>
      tableRows(
        identified({
          family,
          variant: family.toUpperCase(),
          securityVersion: "0",
          arbSvn: 0,
          vcn: 0,
          version: versionWith(major, 0, 0, 1),
        })
      ).map((row) => row.label);

    const seven = labels("me", 7);
    expect(seven).not.toContain("TCB Security Version Number");
    expect(seven).not.toContain("ARB Security Version Number");
    expect(seven).not.toContain("Version Control Number");
    expect(seven).not.toContain("Production Ready");

    const eight = labels("me", 8);
    expect(eight).toContain("TCB Security Version Number");
    expect(eight).toContain("Version Control Number");
    expect(eight).toContain("Production Ready");
    expect(eight).not.toContain("ARB Security Version Number");

    const twelve = labels("csme", 12);
    for (const label of [
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
    ]) {
      expect(twelve).toContain(label);
    }

    const eleven = labels("csme", 11);
    expect(eleven).toContain("TCB Security Version Number");
    expect(eleven).not.toContain("ARB Security Version Number");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheCSME11RowsAreCSME11sAlone
  it("gives CSME 11 alone its power-down and workstation rows", () => {
    const eleven = versionWith(11, 8, 92, 4222);
    const rows = tableRows(
      identified({ version: eleven, powerDownMitigation: "no", workstationSupport: false })
    );
    expect(value("Power Down Mitigation", rows)).toEqual(shown("No"));
    expect(value("Workstation Support", rows)).toEqual(shown("No"));
    expect(
      value(
        "Power Down Mitigation",
        tableRows(identified({ version: eleven, powerDownMitigation: "unknown2" }))
      )
    ).toEqual(shown("Unknown 2"));
    const silent = tableRows(identified({ version: eleven }));
    expect(value("Power Down Mitigation", silent)).toEqual(COMING_SOON);
    expect(value("Workstation Support", silent)).toEqual(COMING_SOON);
    const twelve = tableRows(
      identified({
        version: versionWith(12, 0, 3, 1091),
        powerDownMitigation: "no",
        workstationSupport: true,
      })
    );
    expect(value("Power Down Mitigation", twelve)).toBeUndefined();
    expect(value("Workstation Support", twelve)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testEngineeringSuffixOnRelease
  it("says Engineering on the Release row for an engineering build", () => {
    expect(
      value("Release", tableRows(analysisWith({ version: versionWith(12, 0, 3, 7000) })))
    ).toEqual(shown("Production, Engineering"));
  });
});

describe("what is promised and what is kept off the table", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testIdentifiedWithoutFactsPromisesEveryPendingRow
  it("promises every pending row on an identified image with few facts", () => {
    const rows = tableRows(
      identified({ manifest: { ...manifestFixture(), productionReady: undefined } })
    );
    const labels = rows.map((row) => row.label);
    for (const label of [
      "Type",
      "SKU",
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
      "OEM Configuration",
      "FWUpdate Support",
      "Date",
      "File System State",
    ]) {
      expect(labels).toContain(label);
    }
    for (const label of [
      "SKU",
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
      "File System State",
    ]) {
      expect(value(label, rows)).toEqual(COMING_SOON);
    }
    expect(value("Date", rows)).toEqual(shown("2021-03-24"));
    expect(value("Chipset", rows)).toEqual(shown("Unknown"));
    expect(value("Flash Image Tool", rows)).toBeUndefined();
    expect(value("Family", rows)).toEqual(shown("CSME"));
    expect(value("Size", rows)).toEqual(shown("0x200000 (2097152 bytes)"));
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testUnidentifiedImageShowsOnlyRealRows
  it("shows an unidentified file only what the engine could honestly say", () => {
    const rows = tableRows(analysisWith());
    expect(rows.map((row) => row.label)).toEqual(["Family", "Version", "Release", "Size"]);
    expect(rows.every((row) => row.value.kind === "value")).toBe(true);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testFWUpdateSupportRowReadsAllThreeAnswers
  it("reads all three FWUpdate answers", () => {
    const row = (support: FirmwareAnalysis["fwUpdateSupport"], major = 12) =>
      value(
        "FWUpdate Support",
        tableRows(identified({ version: versionWith(major, 0, 3, 1091), fwUpdateSupport: support }))
      );
    expect(row("yes")).toEqual(shown("Yes"));
    expect(row("no")).toEqual(shown("No"));
    expect(row("impossible")).toEqual(shown("Impossible"));
    expect(row(undefined)).toEqual(COMING_SOON);
    expect(row("no", 11)).toBeUndefined();
  });
});

describe("the independent firmware's own tables", () => {
  const host = (independentFirmware: readonly FirmwareAnalysis[], major = 12) =>
    identified({ version: versionWith(major, 0, 3, 1091), independentFirmware });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testThePMCBlockReadsAsTheConsolePrintsIt
  it("reads the CSME 12 dump's PMC as the console prints it", () => {
    const pmc = analysisWith({
      family: "pmc",
      variant: "PMCCNP",
      version: versionWith(300, 2, 11, 1012),
      sku: "H",
      platform: "CNP",
      chipsetStepping: "B",
      securityVersion: "1",
      arbSvn: 1,
      vcn: 0,
      manifest: manifestOn(2018, 3, 8, false),
      sizeBytes: 0x1_4000,
    });
    const blocks = buildSummary(host([pmc]));
    expect(blocks).toHaveLength(2);
    const block = blocks[1];
    expect(block?.title).toBe("Power Management Controller");
    expect(block?.rows.map((row) => row.label)).toEqual([
      "Family",
      "Version",
      "Release",
      "Type",
      "Chipset SKU",
      "Chipset Stepping",
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
      "Date",
      "Size",
      "Chipset Support",
    ]);
    expect(block?.rows.map((row) => row.value)).toEqual(
      [
        "PMC",
        "300.2.11.1012",
        "Production",
        "Independent",
        "H",
        "B",
        "1",
        "1",
        "0",
        "No",
        "2018-03-08",
        "0x14000 (81920 bytes)",
        "CNP",
      ].map(shown)
    );
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testThePCHCAndPHYBlocksKeepTheirOwnRowSets
  it("keeps the PCHC's and the PHY's own row sets", () => {
    const firmware = (
      family: FirmwareAnalysis["family"],
      variant: string,
      sku: string,
      meu: boolean
    ) =>
      analysisWith({
        family,
        variant,
        version: versionWith(15, 0, 0, 1020, meu ? [15, 0, 30, 1659] : undefined),
        sku,
        platform: "TGP",
        securityVersion: "0",
        arbSvn: 0,
        vcn: 0,
        manifest: manifestOn(2021, 3, 5, true),
        sizeBytes: 0x1000,
      });
    const blocks = buildSummary(
      identified({
        independentFirmware: [
          firmware("pchc", "PCHCTGP", "", true),
          firmware("phy", "PHYNTGP", "N", false),
        ],
      })
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[1]?.title).toBe("Platform Controller Hub Configuration");
    expect(blocks[1]?.rows.map((row) => row.label)).toEqual([
      "Family",
      "Version",
      "Release",
      "Type",
      "TCB Security Version Number",
      "ARB Security Version Number",
      "Version Control Number",
      "Production Ready",
      "Date",
      "Size",
      "Manifest Extension Utility",
      "Chipset Support",
    ]);
    expect(value("Manifest Extension Utility", blocks[1]?.rows ?? [])).toEqual(
      shown("15.0.30.1659")
    );

    const phy = blocks[2]?.rows ?? [];
    expect(blocks[2]?.title).toBe("USB Type C Physical");
    expect(value("SKU", phy)).toEqual(shown("N"));
    expect(value("Chipset SKU", phy)).toBeUndefined();
    expect(value("Chipset Stepping", phy)).toBeUndefined();
    expect(value("Manifest Extension Utility", phy)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheChipsetRowsOfAPMCFollowItsPlatform
  it("follows a PMC's platform for its chipset rows", () => {
    const rows = (platform: string, stepping: string | undefined, hostMajor = 12) =>
      buildSummary(
        host(
          [
            analysisWith({
              family: "pmc",
              variant: "PMCDG2",
              version: versionWith(4, 2, 0, 1000),
              sku: "H",
              platform,
              chipsetStepping: stepping,
              manifest: manifestOn(2021, 3, 5, true),
              sizeBytes: 0x1000,
            }),
          ],
          hostMajor
        )
      )[1]?.rows ?? [];

    const discrete = rows("DG2", "A");
    expect(value("Chipset Stepping", discrete)).toBeUndefined();
    expect(value("Chipset SKU", discrete)).toEqual(shown("H"));

    const olderHost = rows("DG2", "A", 11);
    expect(value("Chipset SKU", olderHost)).toBeUndefined();
    expect(value("Chipset Stepping", olderHost)).toBeUndefined();

    const unread = rows("TGP", undefined);
    expect(value("Chipset Stepping", unread)).toEqual(shown("Unknown"));
    expect(value("Chipset SKU", unread)).toEqual(shown("H"));
  });
});

describe("the messages block", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testIssuesBecomeAMessagesBlockAfterTheTable
  it("follows the tables", () => {
    const blocks = buildSummary(
      analysisWith({
        issues: [
          { id: 1, severity: "error", message: "checksum mismatch" },
          { id: 2, severity: "note", message: "odd padding" },
        ],
      })
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.title).toBeUndefined();
    expect(blocks[1]?.title).toBe("Messages");
    expect(blocks[1]?.rows.map((row) => row.label)).toEqual(["Error", "Note"]);
    expect(blocks[1]?.rows.map((row) => row.value)).toEqual([
      shown("checksum mismatch"),
      shown("odd padding"),
    ]);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testNoIssuesNoMessagesBlock
  it("is no block at all when there are no issues", () => {
    expect(buildSummary(analysisWith())).toHaveLength(1);
  });
});

describe("an independent firmware stored twice", () => {
  const pmc = (redundantCopies: readonly string[] | undefined) =>
    analysisWith({
      family: "pmc",
      variant: "PMCTGP",
      version: versionWith(150, 1, 10, 1048),
      release: "production",
      sku: "LP",
      platform: "TGP",
      chipsetStepping: "B",
      manifest: manifestOn(2020, 6, 1, true),
      sizeBytes: 0x4_0000,
      redundantCopies,
    });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testARedundantCopyIsARowNotASecondTable
  it("says where its copy is in a row, not a second table", () => {
    const twice = buildSummary(
      identified({ version: versionWith(15, 0, 30, 1659), independentFirmware: [pmc(["Boot 2"])] })
    );
    expect(twice).toHaveLength(2);
    const rows = twice[1]?.rows ?? [];
    expect(rows.at(-1)?.label).toBe("Redundant Copy");
    expect(JSON.stringify(value("Redundant Copy", rows))).toContain("Boot 2");

    const once = buildSummary(
      identified({ version: versionWith(15, 0, 30, 1659), independentFirmware: [pmc(undefined)] })
    );
    expect(value("Redundant Copy", once[1]?.rows ?? [])).toBeUndefined();
  });
});
