import { describe, expect, it } from "vitest";
import { csmeSku, type SKUFacts } from "@/firmware/me/identify/sku";

/**
 * The CSME SKU composition. Ported from upstream's `SKUTests`; the expected
 * strings are the rows MEA prints for the real CSME 12.0.3.1091 and
 * 15.0.30.1716 dumps.
 */

/** CSME 12.0.3.1091-style facts: 0x0C Consumer, capability bit 8 (H), no 0x0F. */
const facts = (overrides: Partial<SKUFacts> = {}): SKUFacts => ({
  variant: "CSME",
  major: 12,
  minor: 0,
  hotfix: 0,
  build: 1091,
  year: 2018,
  month: 5,
  skuType: 1,
  skuCaps: 1 << 8,
  skuPlatform: undefined,
  fwSku: undefined,
  databaseRow: undefined,
  ...overrides,
});

const CSME12_ROW =
  "12.0.3.1091_CON_H_BA_PRD_RGN_94D786E6367B58B74A96DE80FB20EA7EE8D79367D78021CA2968D9B717439466";

describe("csmeSku", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testConsumerFromDBCell
  it("takes the platform from the database row", () => {
    expect(csmeSku(facts({ databaseRow: CSME12_ROW }))).toBe("Consumer H");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCapsFallbackWhenNotInDB
  it("falls back to the capabilities with no row", () => {
    expect(csmeSku(facts())).toBe("Consumer H");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testDBOverridesCaps
  it("lets the database override the capabilities", () => {
    const lpRow =
      "12.0.3.1091_CON_LP_B_PRD_RGN_C00085833191A5E8CDBC0EA5FE07AC62CC41C98CC6FD62476B7BC136CF852391";
    expect(csmeSku(facts({ databaseRow: lpRow }))).toBe("Consumer LP");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testExt15PlaceholderCorporateIgnored
  it("ignores the revised block's Corporate placeholder", () => {
    const row =
      "15.0.30.1716_CON_H_A_PRD_RGN_CFE06D28C1385119BC38C360A8535D8C1FF7865E7FE5CB8B965BD056FA1B6DD8";
    expect(
      csmeSku(facts({ major: 15, minor: 0, build: 1716, year: 2019, fwSku: 1, databaseRow: row }))
    ).toBe("Consumer H");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testExt15UsedWhenNo0x0C
  it("uses the revised block when there is no 0x0C", () => {
    expect(
      csmeSku(
        facts({
          skuType: undefined,
          skuCaps: undefined,
          fwSku: 5,
          databaseRow: "15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_AABB",
        })
      )
    ).toBe("Server LP");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testUnknownSKUTypeFromDB
  it("names an unlisted SKU type Unknown and keeps the row's platform", () => {
    expect(csmeSku(facts({ skuType: 7, databaseRow: CSME12_ROW }))).toBe("Unknown H");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCapsLPWinsOverH
  it("prefers LP when both capability bits are set", () => {
    expect(csmeSku(facts({ skuCaps: (1 << 8) | (1 << 9) }))).toBe("Consumer LP");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCSME145HAdjustsToV
  it("corrects CSME 14.5 H to V", () => {
    expect(csmeSku(facts({ major: 14, minor: 5, build: 5000, year: 2019 }))).toBe("Consumer V");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCSME13SlimLPAdjustsToN
  it("corrects CSME 13 Slim LP to N", () => {
    expect(
      csmeSku(facts({ major: 13, minor: 0, build: 100, year: 2019, skuType: 2, skuCaps: 1 << 9 }))
    ).toBe("Slim N");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testNilOutsideCSMEScope
  it("says nothing outside its scope", () => {
    expect(csmeSku(facts({ variant: "CSTXE" }))).toBeUndefined();
    expect(csmeSku(facts({ major: 10 }))).toBeUndefined();
    expect(
      csmeSku(facts({ skuType: undefined, skuCaps: undefined, fwSku: undefined }))
    ).toBeUndefined();
  });
});

describe("CSME 11", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCSME11ReadsItsPlatformFromTheExtension
  it("reads its platform from the extension", () => {
    const eleven = facts({
      major: 11,
      minor: 8,
      hotfix: 92,
      build: 4222,
      year: 2022,
      month: 2,
      skuType: 0,
      skuCaps: 0xffff_ffdf,
      skuPlatform: 1,
    });
    expect(csmeSku(eleven)).toBe("Corporate LP");
    expect(csmeSku({ ...eleven, skuPlatform: 0 })).toBe("Corporate H");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCSME11FallsBackToTheDatabaseRowOnOlderBuilds
  it("falls back to the database row on older builds", () => {
    const row = "11.0.0.1180_COR_LP_C_NPDM_PRD_RGN_ABCD";
    const old = facts({
      major: 11,
      minor: 0,
      hotfix: 0,
      build: 1180,
      skuType: 0,
      skuPlatform: 1,
      databaseRow: row,
    });
    expect(csmeSku(old)).toBe("Corporate LP");
    expect(csmeSku({ ...old, databaseRow: undefined })).toBeUndefined();

    // 11.0.0.1205 is where the extension starts being read; 7101 is excluded.
    const atTheCut = { ...old, build: 1205, databaseRow: undefined };
    expect(csmeSku(atTheCut)).toBe("Corporate LP");
    expect(csmeSku({ ...atTheCut, build: 7101 })).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SKUTests.swift#SKUTests.testCSME11WithAnUnreadablePlatformSaysNothing
  it("does not guess an unreadable platform", () => {
    expect(
      csmeSku(facts({ major: 11, minor: 8, hotfix: 92, build: 4222, skuType: 0, skuPlatform: 3 }))
    ).toBeUndefined();
  });
});
