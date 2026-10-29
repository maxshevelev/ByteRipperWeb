import { describe, expect, it } from "vitest";
import {
  bootGuardProfileInCDMD,
  bootGuardProfileInRecordUEPArea,
  bootGuardProfileInUEPArea,
  oemPublicKeyHash,
} from "@/firmware/me/layout/bootGuard";
import { bootGuardProfileIndex } from "@/firmware/me/models/manufacturingFacts";

/** The Boot Guard profile out of the CDMD configuration's JSON, and the OEM public key hash out of the UEP area. */

const text = (value: string): Uint8Array => Uint8Array.from(value, (one) => one.charCodeAt(0));
const little = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

describe("the profile in the CDMD record", () => {
  // The record the Z Flow dump and the Legion dump carry: MFIT's index 3, which is profile 5.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheProfileIsMFITsIndexNotTheLevel
  it("is MFIT's index, not the level", () => {
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 3}'))).toBe("5");
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 0}'))).toBe("0");
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 1}'))).toBe("3");
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 2}'))).toBe("4");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testProfileFour
  it("reads profile four", () => {
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 2}'))).toBe("4");
    expect(bootGuardProfileIndex("4")).toBe(2);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheRecordIsFoundAmongOthers
  it("is found among other records", () => {
    const area = text(
      '{"length": 0}{"StrapsProject": "adp_p_straps.xml"}{"BtGuardProfileConfig": 2, "FpfSvnEnabled": 1}{"ResizeNftpForFtpr": "Enabled"}'
    );
    expect(bootGuardProfileInCDMD(area)).toBe("4");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAnIndexOutsideTheListIsNoAnswer
  it("answers nothing for an index outside the list", () => {
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 4}'))).toBeUndefined();
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": 9}'))).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testNoRecordIsNoAnswer
  it("answers nothing without a record", () => {
    expect(bootGuardProfileInCDMD(text('{"length": 0}'))).toBeUndefined();
    expect(bootGuardProfileInCDMD(new Uint8Array())).toBeUndefined();
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig"}'))).toBeUndefined();
    expect(bootGuardProfileInCDMD(text('{"BtGuardProfileConfig": }'))).toBeUndefined();
  });
});

/**
 * A UEP container as the images carry it: the signature, a checksum that is not zero,
 * and the four Boot Guard bits of the first bit array — the byte at +0x6E — with the
 * array's own header word beside them.
 */
function uepArea(flags: number): Uint8Array {
  const area = new Uint8Array(0x200);
  const at = 0x20;
  area.set(text("$UEP"), at);
  area[at + 4] = 0x1d;
  area[at + 5] = 0x8b;
  area[at + 0x6c - 4] = 0x72;
  area[at + 0x6e] = flags;
  return area;
}

describe("the profile in the UEP area's bits", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheProfileIsTheCombinationOfFourBits
  it("is the combination of four bits", () => {
    expect(bootGuardProfileInUEPArea(uepArea(0x40))).toBe("0");
    expect(bootGuardProfileInUEPArea(uepArea(0x42))).toBe("0");
    expect(bootGuardProfileInUEPArea(uepArea(0x7a))).toBe("3");
    expect(bootGuardProfileInUEPArea(uepArea(0x6b))).toBe("4");
    expect(bootGuardProfileInUEPArea(uepArea(0x7b))).toBe("5");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testASliceReadsTheSameAsACopy
  it("reads a slice as it reads a copy", () => {
    const buffer = new Uint8Array(0x300 + 0x200).fill(0xa5);
    buffer.set(uepArea(0x7a), 0x300);
    expect(bootGuardProfileInUEPArea(buffer.subarray(0x300))).toBe("3");
  });

  // An area never written is not profile 0 or 5. What says an area is written is its
  // body, not its signature.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAnErasedAreaAnswersNothing
  it("answers nothing for an erased area", () => {
    expect(bootGuardProfileInUEPArea(new Uint8Array(0x200).fill(0xff))).toBeUndefined();
    const blank = uepArea(0x00);
    blank.fill(0, 0x20 + 4, 0x20 + 0x80);
    expect(bootGuardProfileInUEPArea(blank)).toBeUndefined();
    expect(bootGuardProfileInUEPArea(new Uint8Array(0x200))).toBeUndefined();
  });

  // A CSME 12 image's UEP partition has its own bytes where its own layout puts them,
  // and nothing at all where the Boot Guard flags are.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAnotherStructureBehindTheSameSignature
  it("answers nothing for another structure behind the same signature", () => {
    const area = new Uint8Array(0x200);
    const at = 0x20;
    area.set(text("$UEP"), at);
    area[at + 4] = 0x16;
    area[at + 5] = 0xe2;
    area.set([0xff, 0xff, 0xcf, 0xcc, 0x00, 0xf0, 0xfc, 0xcc, 0xc0, 0x00, 0x00, 0x00], at + 0x28);
    area[at + 0x48] = 0x80;
    expect(bootGuardProfileInUEPArea(area)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testWhatTheTableDoesNotNameIsNoAnswer
  it("answers nothing for what the table does not name", () => {
    expect(bootGuardProfileInUEPArea(uepArea(0x01))).toBeUndefined();
    expect(bootGuardProfileInUEPArea(uepArea(0x0b))).toBeUndefined();
    expect(bootGuardProfileInUEPArea(new Uint8Array())).toBeUndefined();
    expect(bootGuardProfileInUEPArea(text("nothing here"))).toBeUndefined();
    expect(bootGuardProfileInUEPArea(text("$UEP"))).toBeUndefined();
  });
});

/**
 * A CSME 12 to 14 container: the signature, the record's source pointer, the mask at
 * +0x34 (0xCC where the ACM is off, 0xFF where it is on, unless a test overrides it) and
 * the flags byte in each of the record's three copies.
 */
function earlierUEPArea(
  flags: number,
  { mask, source = 0x5a_c080, copies }: { mask?: number; source?: number; copies?: number[] } = {}
): Uint8Array {
  const area = new Uint8Array(0x200);
  const at = 0x20;
  area.set(text("$UEP"), at);
  area[at + 4] = 0x55;
  area[at + 5] = 0x09;
  area.set([0xff, 0xff, 0xcf, 0x0c, 0xcc, 0xcc, 0xcc, 0x00, 0xc0, 0x00, 0x00, 0x00], at + 0x28);
  area.set(little(mask ?? ((flags & 0x01) !== 0 ? 0xff : 0xcc)), at + 0x34);
  area.set(little(source), at + 0x48);
  [0x4c, 0xe8, 0x178].forEach((offset, index) => {
    area[at + offset] = copies?.[index] ?? flags;
  });
  return area;
}

/**
 * An Ice Lake container: the mask at +0x40 (0xC0CC with the ACM off, 0xC0FF with it on),
 * the record's source pointer at +0x60 and the flags byte at +0x64, +0x150 and +0x22C.
 */
function iceLakeUEPArea(
  flags: number,
  { mask, source = 0x5a_e080, copies }: { mask?: number; source?: number; copies?: number[] } = {}
): Uint8Array {
  const area = new Uint8Array(0x300);
  const at = 0x20;
  area.set(text("$UEP"), at);
  area[at + 4] = 0xf7;
  area[at + 5] = 0x2d;
  area.set([0xff, 0xff, 0xcf, 0x0c, 0xff, 0xc0, 0x0c, 0x00, 0xc0, 0x00, 0x00, 0x00], at + 0x34);
  area.set(little(mask ?? ((flags & 0x01) !== 0 ? 0xc0ff : 0xc0cc)), at + 0x40);
  area.set(little(source), at + 0x60);
  [0x64, 0x150, 0x22c].forEach((offset, index) => {
    area[at + offset] = copies?.[index] ?? flags;
  });
  return area;
}

describe("the profile in the CSME 12 to 14 record", () => {
  // The four FIT 14.0 builds of one CSME 14 image: the image's own bits are 0x46, and the
  // three profiles set 0x38, 0x29 and 0x39 of them.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheEarlierContainerNamesTheSameFourProfiles
  it("names the same four profiles", () => {
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x46), 14)).toBe("0");
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7e), 14)).toBe("3");
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x6f), 14)).toBe("4");
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f), 14)).toBe("5");
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0xf9), 14)).toBe("5");
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x46), 12)).toBe("0");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheEarlierContainerIsNotGuessedAt
  it("is not guessed at", () => {
    const erased = new Uint8Array(0x200).fill(0xff);
    erased.set(text("$UEP"), 0x20);
    expect(bootGuardProfileInRecordUEPArea(erased, 14)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(uepArea(0x7b), 14)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79), 14)).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { mask: 0xcc }), 14)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x46, { mask: 0xff }), 14)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { mask: 0x0f }), 14)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { mask: 0xffff_ffff }), 14)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { source: 0 }), 14)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { source: 0xffff_ffff }), 14)
    ).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(new Uint8Array(0x200), 14)).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f, { copies: [0x7f, 0x7f, 0x7e] }), 14)
    ).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x31), 14)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(new Uint8Array(), 14)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(text("nothing here"), 14)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheIceLakeContainerNamesTheSameFourProfiles
  it("names the same four profiles on Ice Lake's container", () => {
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x40), 13)).toBe("0");
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x78), 13)).toBe("3");
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x69), 13)).toBe("4");
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79), 13)).toBe("5");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheIceLakeContainerIsNotGuessedAt
  it("does not guess at Ice Lake's container", () => {
    const erased = new Uint8Array(0x300).fill(0xff);
    erased.set(text("$UEP"), 0x20);
    expect(bootGuardProfileInRecordUEPArea(erased, 13)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(earlierUEPArea(0x7f), 13)).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(uepArea(0x7b), 13)).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79, { mask: 0xc0cc }), 13)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x40, { mask: 0xc0ff }), 13)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79, { mask: 0xcc }), 13)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79, { source: 0 }), 13)
    ).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79, { source: 0xffff_ffff }), 13)
    ).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(new Uint8Array(0x300), 13)).toBeUndefined();
    expect(
      bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x79, { copies: [0x79, 0x79, 0x78] }), 13)
    ).toBeUndefined();
    expect(bootGuardProfileInRecordUEPArea(iceLakeUEPArea(0x31), 13)).toBeUndefined();
  });
});

/** The Z Flow dump's own hash: a SHA-384 0xA0 bytes into the UEP area's entry. */
const OEM_HASH =
  "05C697663A75E912B7C4B553E885E1E4EF9AA04276C26A6630320A755AC90B1E0981C11D051A8C90D202D2E6FD3E8452";

const hashBytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  );

/** An area with one entry: a container at 0x20, the key field of each half at 0xA0 in. */
function uep(first: Uint8Array | undefined, second: Uint8Array | undefined, container = "$UEPC") {
  const area = new Uint8Array(0x2000).fill(0xff);
  area.set(text(container), 0x20);
  if (first !== undefined) area.set(first, 0x20 + 0xa0);
  if (second !== undefined) area.set(second, 0x20 + 0xa0 + 0x1000);
  return area;
}

/** A CSME 12 to 14 area: the container, the family's policy bytes, a 32-byte hash 0x90 in. */
function olderUEP(hash: Uint8Array | undefined, assigned = 0x00): Uint8Array {
  const area = new Uint8Array(0x2000).fill(0xff);
  area.set(text("$UEP"), 0x20);
  area.set([0xff, 0xff, 0xcf, 0x0c, 0xff, 0xcc, 0xcc, 0x00], 0x28);
  if (hash !== undefined) area.set(hash, 0x20 + 0x90);
  if (assigned !== 0x00) area.fill(assigned, 0x20 + 0xb0, 0x20 + 0xc0);
  return area;
}

const OLDER_HASH = OEM_HASH.slice(0, 64);

describe("the OEM public key hash", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheKeyIsReadOutOfTheEntrysField
  it("is read out of the entry's field", () => {
    const key = hashBytes(OEM_HASH);
    const hash = { kind: "hash", hex: OEM_HASH };
    expect(oemPublicKeyHash(uep(key, key), 15)).toEqual(hash);
    expect(oemPublicKeyHash(uep(key, undefined), 15)).toEqual(hash);
    expect(oemPublicKeyHash(uep(key, new Uint8Array(48).fill(0xff)), 15)).toEqual(hash);
    expect(oemPublicKeyHash(uep(new Uint8Array(48).fill(0xff), key), 15)).toEqual(hash);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAZeroedFieldSaysSigningIsDisabled
  it("says signing is disabled for a zeroed field", () => {
    expect(oemPublicKeyHash(uep(new Uint8Array(48), undefined), 15)).toEqual({ kind: "allZeros" });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAnErasedFieldIsItsOwnFinding
  it("finds an erased field", () => {
    expect(oemPublicKeyHash(uep(undefined, undefined), 15)).toEqual({ kind: "erased" });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testAFieldThatIsNotAKeyIsNotReadAsOne
  it("does not read a field that is not a key as one", () => {
    const pointer = new Uint8Array(48);
    pointer.set([0x02, 0x40, 0x3e, 0x86]);
    expect(oemPublicKeyHash(uep(pointer, undefined), 15)).toEqual({ kind: "unrecognized" });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testDisagreeingHalvesAreNotAKey
  it("takes disagreeing halves for no key", () => {
    const other = hashBytes(`${OEM_HASH.slice(2)}05`);
    expect(oemPublicKeyHash(uep(hashBytes(OEM_HASH), other), 15)).toEqual({ kind: "unrecognized" });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheOlderGenerationsKeyIsThirtyTwoBytesAtNinety
  it("reads the older generations' key as thirty-two bytes at 0x90", () => {
    for (const major of [12, 13, 14]) {
      expect(oemPublicKeyHash(olderUEP(hashBytes(OLDER_HASH)), major)).toEqual({
        kind: "hash",
        hex: OLDER_HASH,
      });
    }
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheAssignmentBitsBehindTheHashAreNotPartOfIt
  it("leaves the assignment bits behind the hash out of it", () => {
    expect(oemPublicKeyHash(olderUEP(hashBytes(OLDER_HASH), 0xff), 14)).toEqual({
      kind: "hash",
      hex: OLDER_HASH,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheOlderLayoutSaysWhatABlankFieldHolds
  it("says what a blank field holds on the older layout", () => {
    expect(oemPublicKeyHash(olderUEP(new Uint8Array(32)), 14)).toEqual({ kind: "allZeros" });
    expect(oemPublicKeyHash(olderUEP(undefined), 14)).toEqual({ kind: "erased" });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testEachGenerationIsReadWithItsOwnRecord
  it("reads each generation with its own record", () => {
    expect(oemPublicKeyHash(olderUEP(hashBytes(OLDER_HASH)), 15)).toEqual({ kind: "unrecognized" });
    expect(oemPublicKeyHash(uep(hashBytes(OEM_HASH), undefined), 14)).toEqual({
      kind: "unrecognized",
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testNoContainerIsNoLayout
  it("finds no layout without a container", () => {
    expect(oemPublicKeyHash(new Uint8Array(0x2000).fill(0xff), 15)).toEqual({
      kind: "unrecognized",
    });
    expect(oemPublicKeyHash(new Uint8Array(), 15)).toEqual({ kind: "unrecognized" });
  });
});
