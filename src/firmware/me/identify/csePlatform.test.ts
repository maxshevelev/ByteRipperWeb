import { describe, expect, it } from "vitest";
import { type ChipsetInitTable, csePlatformName } from "@/firmware/me/identify/csePlatform";
import { variantByModule } from "@/firmware/me/identify/variantByModule";
import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/** Upstream's `CSEPlatformTests` and `VariantByModuleTests`. */

const name = (
  family: FirmwareFamily,
  major: number,
  minor: number,
  chipsetInitTable: ChipsetInitTable = "absent"
) => csePlatformName({ family, major, minor, chipsetInitTable });

describe("csePlatformName", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#CSEPlatformTests.testCSMEPlatformsByVersion
  it("names the CSME platforms by version", () => {
    expect(name("csme", 11, 0)).toBe("SPT");
    expect(name("csme", 11, 8)).toBe("SPT/KBP");
    expect(name("csme", 11, 12)).toBe("BSF/GCF");
    expect(name("csme", 11, 22)).toBe("LBG");
    expect(name("csme", 12, 0)).toBe("CNP");
    expect(name("csme", 13, 30)).toBe("LKF");
    expect(name("csme", 14, 5)).toBe("CMP-V");
    expect(name("csme", 15, 0)).toBe("TGP");
    expect(name("csme", 15, 40)).toBe("MCC");
    expect(name("csme", 16, 1)).toBe("ADP/RPP");
    // A version with no name says nothing rather than the nearest one.
    expect(name("csme", 11, 3)).toBeUndefined();
    expect(name("csme", 16, 5)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#CSEPlatformTests.testTheInitialisationTableTakesTheRowInstead
  it("leaves the row to a chipset initialisation table where there is one", () => {
    expect(name("csme", 16, 1, "present")).toBeUndefined();
    expect(name("csme", 16, 1, "absent")).toBe("ADP/RPP");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#CSEPlatformTests.testCSTXEPlatformsIgnoreTheTable
  it("names the CSTXE platforms whatever the file system holds", () => {
    expect(name("cstxe", 3, 0, "present")).toBe("APL");
    expect(name("cstxe", 3, 2, "present")).toBe("BXT");
    expect(name("cstxe", 4, 0, "present")).toBe("GLK");
    expect(name("cstxe", 5, 0)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#CSEPlatformTests.testUnportedFamiliesNameNothing
  it("names nothing for the families whose tables are not ported", () => {
    expect(name("cssps", 5, 0)).toBeUndefined();
    expect(name("gsc", 1, 0)).toBeUndefined();
    expect(name("me", 7, 1)).toBeUndefined();
  });
});

describe("variantByModule", () => {
  const variant = (
    moduleNames: readonly string[],
    options: {
      readonly major: number;
      readonly minor?: number;
      readonly year?: number;
      readonly meuMajor?: number | undefined;
      readonly meuMinor?: number | undefined;
    }
  ) =>
    variantByModule({
      moduleNames,
      major: options.major,
      minor: options.minor ?? 0,
      year: options.year ?? 2021,
      meuMajor: "meuMajor" in options ? options.meuMajor : 15,
      meuMinor: "meuMinor" in options ? options.meuMinor : 0,
    });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#VariantByModuleTests.testPMCPlatformsByMajor
  it("tells one platform's PMC from another by its major", () => {
    // Every PMC carries a module called `PMCC000`, so the name alone says
    // nothing — it is the version beside it that decides.
    expect(variant(["PMCC000"], { major: 300 })).toBe("PMCCNP");
    expect(variant(["PMCC000"], { major: 150 })).toBe("PMCTGP");
    expect(variant(["PMCC000"], { major: 160 })).toBe("PMCADP");
    expect(variant(["PMCC000"], { major: 140 })).toBe("PMCCMP");
    // Two of them take the MEU minor as the tie-breaker.
    expect(variant(["PMCC000"], { major: 140, meuMinor: 5 })).toBe("PMCCMPV");
    expect(variant(["PMCC000"], { major: 130, meuMinor: 50 })).toBe("PMCJSP");
    expect(variant(["PMCC000"], { major: 130 })).toBe("PMCICP");
    // An early low-major PMC is named by its date.
    expect(variant(["PMCC000"], { major: 3, year: 2017 })).toBe("PMCCNP");
    // Later than that the date rule does not apply, and 3.0 falls through to
    // the version-only tail below — as upstream's does.
    expect(variant(["PMCC000"], { major: 3, year: 2019 })).toBe("CSTXE");
    expect(variant(["PMCC000"], { major: 3, minor: 7, year: 2019 })).toBeUndefined();
    // A pre-MEU PMC, whose manifest carries no MEU block at all.
    expect(variant(["PMCC000"], { major: 1, meuMajor: undefined, meuMinor: undefined })).toBe(
      "PMCWTL"
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#VariantByModuleTests.testPCHCAndPHYByModuleAndVersion
  it("names the PCHC and PHY firmware by module and version", () => {
    expect(variant(["IntelRec"], { major: 16 })).toBe("PCHCADP");
    expect(variant(["IntelRec"], { major: 15, meuMinor: 0 })).toBe("PCHCTGP");
    expect(variant(["IntelRec"], { major: 15, meuMinor: 40 })).toBe("PCHCMCC");
    expect(variant(["IntelRec"], { major: 13, minor: 0 })).toBe("PCHCICP");
    expect(variant(["nphy"], { major: 15, meuMajor: 15 })).toBe("PHYNTGP");
    expect(variant(["gen4_i"], { major: 13, meuMajor: 16 })).toBe("PHYNADP");
    expect(variant(["SNPMULTI"], { major: 13, meuMajor: 16 })).toBe("PHYSADP");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#VariantByModuleTests.testEngineFamiliesAndTheCSTXETail
  it("names the engine families, and closes with the version-only rules", () => {
    expect(variant(["kernel", "fwupdate", "bup"], { major: 15 })).toBe("CSME");
    expect(variant(["bup_rcv"], { major: 5 })).toBe("CSSPS");
    expect(variant(["gfx_srv"], { major: 1 })).toBe("GSC");
    expect(variant(["VBT"], { major: 20 })).toBe("OROMDG2");
    // Nothing recognised, but these two versions are a CSTXE.
    expect(variant(["whatever"], { major: 4, minor: 0 })).toBe("CSTXE");
    expect(variant(["whatever"], { major: 5, minor: 0 })).toBeUndefined();
    // No modules at all: this step has nothing to read.
    expect(variant([], { major: 4, minor: 0 })).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CSEPlatformTests.swift#VariantByModuleTests.testTheLastMatchingModuleDecides
  it("lets the last matching module decide", () => {
    // The loop assigns rather than returns, so the order of the directory is
    // what settles a firmware two rules both match.
    expect(variant(["fwupdate", "PMCC000"], { major: 300 })).toBe("PMCCNP");
    expect(variant(["PMCC000", "fwupdate"], { major: 300 })).toBe("CSME");
  });
});
