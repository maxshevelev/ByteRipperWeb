/**
 * Fixture database text.
 *
 * The hashes below are the SHA-256 digests of the manifest fixture's own key and
 * signature byte patterns, which is what lets a fixture database claim a fixture
 * manifest. They are upstream's own constants, and they agree byte for byte —
 * the two fixtures build the same bytes.
 */

/**
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureHashes
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureHashes.key
 */
export const FIXTURE_KEY_HASH = "40AFF2E9D2D8922E47AFD4648E6967497158785FBD1DA870E7110266BF944880";
/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureHashes.sig */
export const FIXTURE_SIGNATURE_HASH =
  "CD6816B77F68D70001FC3EAA4D42BDD67CB5973B3151CC5292ECC02A3DAAC6AB";
/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureHashes.unknownKey */
export const UNKNOWN_KEY_HASH = "CD1E95071E2F5A071154694AC11838B51731501608CCC6B8F8DC38D94CBC5872";
/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureHashes.unknownSig */
export const UNKNOWN_SIGNATURE_HASH =
  "FDE27382A8C549406680FAF2B36D51520301B7C0816B783EF8C6E3F5D7E0B34D";

/**
 * A database carrying a production CSME entry for the fixture manifest.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureDB
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureDB.csme
 */
export function csmeDatabaseText(
  options: { readonly signature?: string; readonly preKeys?: readonly string[] } = {}
): string {
  const signature = options.signature ?? FIXTURE_SIGNATURE_HASH;
  const preKeys = (options.preKeys ?? []).map((one) => `"${one}"`).join(",\n");
  return `*** ME Analyzer Engine Firmware Repository Database ***
*** Revision r378 (2026-09-06 , 14:48) ***

*** Converged Security Management Engine (CSME) ***
15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_${signature}

*** RSA Public Keys ***
RSAPKEY_CSME_${FIXTURE_KEY_HASH} (15.40 PRD)

*** Structures ***
rsa_pre_keys*BGN
[
${preKeys}
]
rsa_pre_keys*END`;
}

/**
 * A database carrying no line for the fixture key at all.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IdentificationTests.swift#FixtureDB.unrelated
 */
export const unrelatedDatabaseText = (): string =>
  `*** ME Analyzer Engine Firmware Repository Database ***
*** Revision r378 (2026-09-06 , 14:48) ***

*** Management Engine (ME) ***
9.5.65.3148_0A_M_PRD_EXTR_${UNKNOWN_SIGNATURE_HASH}`;
