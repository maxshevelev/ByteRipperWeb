import { describe, expect, it } from "vitest";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import {
  csmeDatabaseText,
  FIXTURE_KEY_HASH,
  FIXTURE_SIGNATURE_HASH,
  unrelatedDatabaseText,
} from "@/firmware/me/testing/testDatabase";

/** The firmware database — the lookups upstream's `IdentificationTests` drive. */

const rowDatabase = (row: string) =>
  MEADatabase.parse(
    `*** ME Analyzer Engine Firmware Repository Database ***\n*** Revision r378 ***\n\n${row}`
  );

describe("MEADatabase.parse", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#MEADatabaseTests.testParsesRevisionMarker
  it("reads the revision and the corpus", () => {
    const database = MEADatabase.parse(csmeDatabaseText());

    expect(database.revision).toBe(378);
    expect(database.lines.some((line) => line.startsWith("RSAPKEY_CSME_"))).toBe(true);
    // Blank lines are not part of the corpus, which is what keeps the line
    // index a line index rather than a line-or-gap index.
    expect(database.lines.every((line) => line.length > 0)).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#MEADatabaseTests.testNoRevisionYieldsNil
  it("reads no revision from text without the marker", () => {
    expect(MEADatabase.parse("just some firmware lines").revision).toBeUndefined();
  });

  it("finds a variant by its key line", () => {
    expect(MEADatabase.parse(csmeDatabaseText()).variantForKeyHash(FIXTURE_KEY_HASH)).toBe("CSME");
  });

  it("finds nothing for a key it does not list", () => {
    expect(
      MEADatabase.parse(unrelatedDatabaseText()).variantForKeyHash(FIXTURE_KEY_HASH)
    ).toBeUndefined();
  });

  it("finds a firmware row by its signature", () => {
    expect(
      MEADatabase.parse(csmeDatabaseText()).firmwareRowForSignatureHash(FIXTURE_SIGNATURE_HASH)
    ).toBe(`15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_${FIXTURE_SIGNATURE_HASH}`);
  });

  it("reads the list of pre-production keys", () => {
    const database = MEADatabase.parse(csmeDatabaseText({ preKeys: [FIXTURE_KEY_HASH] }));

    expect(database.isPreProductionKey(FIXTURE_KEY_HASH)).toBe(true);
    expect(database.isPreProductionKey("something else")).toBe(false);
  });

  it("reads no pre-production keys when the list is absent", () => {
    expect(MEADatabase.parse(unrelatedDatabaseText()).preProductionKeyHashes.size).toBe(0);
  });
});

// @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#IdentificationTests.testDatabaseCellsPerFamily
describe("the manual cells of a firmware row", () => {
  // Which cell holds the stepping and the power-down token depends on the
  // family, and a placeholder means "not recorded".
  const cells = (row: string, family: Parameters<MEADatabase["cseCellsIn"]>[1]) =>
    rowDatabase(row).cseCellsForSignatureHash("ABCD", family);

  it("reads a CSME row's SKU, stepping and mitigation token", () => {
    expect(cells("11.8.92.4222_COR_LP_C_NPDM_PRD_RGN_ABCD", "csme")).toEqual({
      sku: "LP",
      stepping: "C",
      pdm: "NPDM",
    });
  });

  it("claims nothing about mitigation when that cell is a release", () => {
    const found = cells("12.0.3.1091_CON_H_BA_PRD_RGN_ABCD", "csme");

    expect(found?.stepping).toBe("BA");
    expect(found?.pdm).toBeUndefined();
  });

  it("treats a placeholder stepping as not recorded", () => {
    expect(cells("12.0.3.1091_CON_H_X_PRD_RGN_ABCD", "csme")?.stepping).toBeUndefined();
    expect(cells("12.0.3.1091_CON_H_XX_PRD_RGN_ABCD", "csme")?.stepping).toBeUndefined();
  });

  it("reads a CSTXE stepping from its own cell", () => {
    expect(cells("3.1.55.2333_B_PRD_EXTR_ABCD", "cstxe")?.stepping).toBe("B");
  });

  it("never takes an SPS stepping from the database", () => {
    // Upstream gates it on the row's *last* cell being `EXTR` — and that cell
    // is always the signature hash, so the branch never fires. Reproduced as
    // it is: upstream's own output is what this is checked against, and a
    // "fix" here would be a disagreement.
    expect(cells("05.01.05.216_ME_SVR_BA_PRD_EXTR_ABCD", "cssps")?.stepping).toBeUndefined();
    expect(cells("05.01.05.216_ME_SVR_BA_PRD_RGN_ABCD", "cssps")?.stepping).toBeUndefined();
  });

  it("reads no cells for a firmware with no row at all", () => {
    expect(
      MEADatabase.parse(unrelatedDatabaseText()).cseCellsForSignatureHash("ABCD", "csme")
    ).toBeUndefined();
  });
});
