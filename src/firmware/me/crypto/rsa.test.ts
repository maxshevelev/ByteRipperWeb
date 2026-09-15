import { describe, expect, it } from "vitest";
import { hex } from "@/firmware/me/crypto/digest";
import {
  bigEndianBytes,
  littleEndianValue,
  powerMod,
  type RSAOutcome,
  validateSignature,
} from "@/firmware/me/crypto/rsa";
import {
  CSME12_KEY,
  CSME12_PROTECTED,
  CSME12_SIG,
  CSME15_KEY,
  CSME15_PROTECTED,
  CSME15_SIG,
  CSME16_KEY,
  CSME16_PROTECTED,
  CSME16_SIG,
  MANIFEST_EXPONENT,
} from "@/firmware/me/testing/realManifests";

/** RSA manifest signature validation — upstream's `RSATests`. */

const MANIFESTS = [
  { name: "CSME 12", key: CSME12_KEY, sig: CSME12_SIG, protected: CSME12_PROTECTED, digits: 64 },
  { name: "CSME 15", key: CSME15_KEY, sig: CSME15_SIG, protected: CSME15_PROTECTED, digits: 96 },
  { name: "CSME 16", key: CSME16_KEY, sig: CSME16_SIG, protected: CSME16_PROTECTED, digits: 96 },
] as const;

function checked(one: (typeof MANIFESTS)[number], data = one.protected): RSAOutcome {
  const outcome = validateSignature({
    tag: "$MN2",
    publicKey: one.key,
    exponent: MANIFEST_EXPONENT,
    signature: one.sig,
    protectedData: data,
  });
  if (outcome === undefined) throw new Error(`${one.name} should have been checkable`);
  return outcome;
}

describe("validateSignature", () => {
  for (const manifest of MANIFESTS) {
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testCSME12ManifestSignatureValid
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testCSME15ManifestSignatureValid
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testCSME16ManifestSignatureValid
    it(`validates the real ${manifest.name} manifest`, () => {
      // CSME 12 is 2048-bit PKCS #1 v1.5 over SHA-256; the other two are
      // 3072-bit SSA-PSS over SHA-384, which has to go through parse, unmask,
      // salt and re-hash before it can agree with anything.
      const outcome = checked(manifest);

      expect(outcome.valid).toBe(true);
      expect(outcome.embeddedHash?.length).toBe(manifest.digits);
      expect(outcome.embeddedHash).toBe(outcome.dataHash);
    });

    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testTamperedProtectedDataInvalidatesBothPaths
    it(`rejects ${manifest.name} when one byte of the protected window changes`, () => {
      const tampered = Uint8Array.from(manifest.protected);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;

      expect(checked(manifest, tampered).valid).toBe(false);
    });
  }

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testEmptyRSABlockIsValid
  it("calls an empty RSA block valid", () => {
    // A manifest with no signature in it is not a manifest with a bad one.
    const zero = new Uint8Array(0x100);
    expect(
      validateSignature({
        tag: "$MN2",
        publicKey: zero,
        exponent: 0,
        signature: zero,
        protectedData: new Uint8Array(0x80).fill(0xaa),
      })?.valid
    ).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testEvenModulusIsNotCheckable
  it("says an even modulus is not checkable rather than invalid", () => {
    // It cannot be exponentiated into at all. Upstream would crash here; this
    // reports "no answer", which is a different thing from "wrong".
    const even = new Uint8Array(0x100).fill(0xff);
    even[0] = 0x00;

    expect(
      validateSignature({
        tag: "$MN2",
        publicKey: even,
        exponent: 65537,
        signature: CSME12_SIG,
        protectedData: CSME12_PROTECTED,
      })
    ).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testMissingKeyMaterialIsNotCheckable
  it("says missing key material is not checkable", () => {
    expect(
      validateSignature({
        tag: "$MN2",
        publicKey: new Uint8Array(0),
        exponent: 0,
        signature: new Uint8Array(0),
        protectedData: new Uint8Array(0),
      })
    ).toBeUndefined();
  });
});

describe("powerMod", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testPowerModMatchesReference
  it("matches an independent reference on the real moduli", () => {
    // `pow(2, 65537, n)` for two of the real keys, computed with a bignum
    // independent of the implementation under test.
    const cases = [
      {
        key: CSME12_KEY,
        width: 0x100,
        expected:
          "A1232A3002629754CB38C489590D6091F88C18B2589A2690437ADD72BDAF69CE00021203B53227441" +
          "92B651736C0C7EB150A903A2D7C439082FB894F7F43BD2F612AC4192A496F6B2E281B85374F303C19" +
          "B5FC005F48AAAA8B9F6C7AC8C51263FCF4E730F4085F1751070A43851EDA537E93CF3314C5614FB40" +
          "6FE4CD14CCF6EAE7B7FD904F956356832802BD6998EAD86E961A900B03223A0A6F9A4247EDF4EEFFA" +
          "CA1615BA015174C0646F9C88B7B8B1B1C4E3226AEBC332CB274EEC19EB0D83577B97D3A351318F9F0" +
          "29E96F94000DAEAC76118CD8C63E9F1068D3DFD66B3ED67E7D139664FB0ACBE2709DC6EC7A56E2CFE" +
          "4489F7B92D6367B2F5A794F19A",
      },
      {
        key: CSME15_KEY,
        width: 0x180,
        expected:
          "403AA550B420A4003CEB48248D5032BEC70B1D22EDD88F79B5BE61DA1A2159D23EEF57BCE072E9DA3" +
          "CBE39B5B80115246AF02FD3F3CD47D7F7A352C0375635DAA8F90FB17D64C067CC446357451D438620" +
          "EC1C9993688B1412172A7EAAA8DD408C3083E225D0C81B8B34D9D433266B1BBD5DDA5BD9C68764BFB" +
          "CCB13B37251712E189D6F761F8F689534B8158FFDFDAFC4B8B4A8333D56DD88682CAA9EAE37778018" +
          "A831B0E4ED11769EB0A0089202E75E5C422738BF32A6B514A7577E6650D7099CC76771AEF43866A45" +
          "B7E8D101B6CEFF3FA315F9A4696AFE220C58FBDAFD8D156042F32DB82A033864444B07EA0F9A942FD" +
          "535DA4101E338E79B68794D1A495085169716AD4F5F6DF0AE2656D8B8CF4097156153FDC009E761B0" +
          "2AE2FAA01DC72A65B893E02ADBF5B10937A0168719AE43E99E6DC428D68FA56F9C4064C89274E906C" +
          "65DB1B0FE4255B0D0F4029279A2849C4256C2BEE500479619AEB2D894BC8E57DF4231E4FF404848F5" +
          "281FCF921F98E97DB47291BDF3A7658256501C2",
      },
    ];
    for (const one of cases) {
      const result = powerMod(2n, 65537n, littleEndianValue(one.key));
      expect(hex(bigEndianBytes(result, one.width))).toBe(one.expected);
    }
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testPowerModHandlesTheExponentsEdges
  it("handles the exponent's edges", () => {
    expect(powerMod(7n, 0n, 17n)).toBe(1n); // anything to the zero
    expect(powerMod(20n, 1n, 17n)).toBe(3n); // and reduced on the way
    expect(powerMod(0n, 5n, 17n)).toBe(0n);
    // 2 has order 8 mod 17 (2^8 = 256 = 15·17 + 1), and 2^31 is a multiple of
    // 8, so a walk that started at the wrong bit would not give one.
    expect(powerMod(2n, 0x8000_0000n, 17n)).toBe(1n);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/RSATests.swift#RSATests.testPowerModSmallNumbers
  it("agrees with hand-computed small cases", () => {
    expect(powerMod(3n, 4n, 17n)).toBe(13n); // 81 mod 17
    expect(powerMod(2n, 10n, 999n)).toBe(25n);
  });
});

describe("reading and writing the numbers", () => {
  it("reads bytes little-endian, as the format stores them", () => {
    expect(littleEndianValue(Uint8Array.of(0x01, 0x02))).toBe(0x0201n);
    expect(littleEndianValue(new Uint8Array(0))).toBe(0n);
  });

  it("writes bytes big-endian, padded to the modulus width", () => {
    expect([...bigEndianBytes(0x0201n, 4)]).toEqual([0, 0, 0x02, 0x01]);
    expect([...bigEndianBytes(0n, 2)]).toEqual([0, 0]);
  });
});
