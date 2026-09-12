import { describe, expect, it } from "vitest";
import {
  type CPDExtension,
  decodeExtensionChain,
  decodeMetadataChain,
  type ExtensionFamily,
  extensionFacts,
  extensionFamily,
  isRevisedHeader,
} from "@/firmware/me/partition/extensions";
import {
  extBlock,
  extClientSystemInfo,
  extConcat,
  extFeaturePermissions,
  extModuleAttributes,
  extPartitionInfo,
  extRows,
  extSignedPackage,
  extSystemInfo,
} from "@/firmware/me/testing/testExtensions";
import { putU32 } from "@/firmware/me/testing/testMe";

/** The CSE extension chain — upstream's `ExtensionTests`. */

const chainOf = (blocks: readonly Uint8Array[], family: ExtensionFamily): CPDExtension[] => {
  const bytes = extConcat(blocks);
  return decodeExtensionChain({
    bytes,
    moduleContentBase: 0,
    moduleSize: bytes.length,
    chainStart: 0,
    family,
  });
};

describe("extensionFamily", () => {
  it("chooses the revision from the manifest alone", () => {
    const family = (options: Parameters<typeof extensionFamily>[0]) => extensionFamily(options);

    // A 3072-bit key settles it whatever the version says.
    expect(
      family({ major: 12, minor: 3, hotfix: 0, build: 100, year: 2018, month: 1, keyLength: 0x180 })
    ).toBe("csme15");
    expect(
      family({ major: 15, minor: 0, hotfix: 0, build: 0, year: 2021, month: 3, keyLength: 0x100 })
    ).toBe("csme15");
    expect(
      family({
        major: 16,
        minor: 0,
        hotfix: 0,
        build: 0,
        year: 2021,
        month: 3,
        keyLength: undefined,
      })
    ).toBe("csme15");
    expect(
      family({ major: 12, minor: 0, hotfix: 0, build: 100, year: 2019, month: 1, keyLength: 0x100 })
    ).toBe("csme12");
    expect(
      family({ major: 13, minor: 0, hotfix: 0, build: 0, year: 2021, month: 3, keyLength: 0x100 })
    ).toBe("csme12");
    expect(
      family({ major: 14, minor: 0, hotfix: 0, build: 0, year: 2021, month: 3, keyLength: 0x100 })
    ).toBe("csme12");
    // The earliest builds of 12 still use the older structs, and only their own
    // date tells them apart from the rest of 12.
    expect(
      family({
        major: 12,
        minor: 0,
        hotfix: 0,
        build: 7000,
        year: 2017,
        month: 3,
        keyLength: 0x100,
      })
    ).toBe("base");
    expect(
      family({ major: 11, minor: 0, hotfix: 0, build: 0, year: 2014, month: 1, keyLength: 0x100 })
    ).toBe("base");
  });
});

describe("isRevisedHeader", () => {
  it("revises the right tags for each family", () => {
    for (const tag of [0x00, 0x03, 0x0a, 0x0f, 0x16]) {
      expect(isRevisedHeader(tag, "csme15"), `${tag} on csme15`).toBe(true);
    }
    expect(isRevisedHeader(0x02, "csme15")).toBe(false);
    expect(isRevisedHeader(0x0c, "csme15")).toBe(false);
    // The middle family revises exactly one tag, and its metadata headers stay
    // as they were.
    expect(isRevisedHeader(0x0f, "csme12")).toBe(true);
    expect(isRevisedHeader(0x00, "csme12")).toBe(false);
    expect(isRevisedHeader(0x0a, "csme12")).toBe(false);
    expect(isRevisedHeader(0x16, "csme12")).toBe(false);
    expect(isRevisedHeader(0x0f, "base")).toBe(false);
  });
});

describe("decodeExtensionChain", () => {
  it("decodes the revised headers of the newest family", () => {
    const chain = chainOf(
      [
        extSystemInfo(true),
        extPartitionInfo(0x03, true),
        extSignedPackage(true),
        extClientSystemInfo(),
        extFeaturePermissions(9, 3),
      ],
      "csme15"
    );

    expect(chain.map((one) => one.tag)).toEqual([0x00, 0x03, 0x0f, 0x0c, 0x02]);
    expect(chain[0]?.systemInfo).toMatchObject({
      minUMASize: 0x1122_3344,
      chipsetVersion: 0x0c0d_0e0f,
      pageableUMASize: 0x5566_7788,
    });
    // The longer digest, which is the whole point of the revision.
    expect(chain[0]?.systemInfo?.imageHash.length).toBe(96);
    expect(chain[1]?.partitionInfo).toMatchObject({
      partitionName: "FTPR",
      vcn: 7,
      versionMajor: 15,
      versionMinor: 40,
    });
    expect(chain[2]?.signedPackage).toMatchObject({
      partitionName: "NVM0",
      vcn: 3,
      arbSvn: 5,
      fwType: 3,
      fwSku: 5,
      nvmCompatibility: 1,
    });
    expect(chain[3]?.clientSystemInfo).toMatchObject({
      cseSize: 7,
      skuType: 3,
      workstation: true,
      m3: false,
      m0: true,
      skuPlatform: 2,
      siClass: 5,
    });
    expect(chain[4]?.featurePermissions?.moduleCount).toBe(9);
  });

  it("decodes the original headers of the oldest family", () => {
    const chain = chainOf([extSystemInfo(false), extSignedPackage(false)], "base");

    // The shorter digest, and no revised fields at all.
    expect(chain[0]?.systemInfo?.imageHash.length).toBe(64);
    expect(chain[1]?.signedPackage?.fwType).toBeUndefined();
    expect(chain[1]?.signedPackage?.nvmCompatibility).toBeUndefined();
    expect(chain[1]?.signedPackage?.arbSvn).toBe(5);
  });

  it("revises only the signed package on the middle family", () => {
    const chain = chainOf([extSystemInfo(false), extSignedPackage(true)], "csme12");

    expect(chain[0]?.systemInfo?.imageHash.length).toBe(64);
    expect(chain[1]?.signedPackage?.nvmCompatibility).toBe(1);
  });

  it("decodes the row-bearing blocks", () => {
    const threads = extRows(0x06, 0x08, 0x10, 2, (bytes, row, index) => {
      putU32(bytes, row, 0x1000 * (index + 1));
      putU32(bytes, row + 0x04, index);
    });
    const devices = extRows(0x07, 0x08, 0x08, 3, (bytes, row, index) => {
      putU32(bytes, row, 0xd0 + index);
    });
    const mmio = extRows(0x08, 0x08, 0x0c, 2, (bytes, row, index) => {
      putU32(bytes, row, 0xfe00_0000 + index * 0x1000);
      putU32(bytes, row + 0x04, 0x1000);
    });
    const locked = extRows(0x0b, 0x08, 0x08, 1, (bytes, row) => {
      putU32(bytes, row, 0x2000);
      putU32(bytes, row + 0x04, 0x400);
    });

    const chain = chainOf([threads, devices, mmio, locked], "base");

    expect(chain[0]?.threadRows).toEqual([
      { stackSize: 0x1000, flags: 0, schedulingPolicy: 0, reserved: 0 },
      { stackSize: 0x2000, flags: 1, schedulingPolicy: 0, reserved: 0 },
    ]);
    expect(chain[1]?.deviceRows?.map((one) => one.deviceID)).toEqual([0xd0, 0xd1, 0xd2]);
    expect(chain[2]?.mmioRows?.[0]).toMatchObject({ baseAddress: 0xfe00_0000, sizeLimit: 0x1000 });
    expect(chain[3]?.lockedRanges).toEqual([{ rangeBase: 0x2000, rangeSize: 0x400 }]);
  });

  it("gives user-information rows the layout its family writes", () => {
    // The newer families write a shorter row with no working directory in it,
    // so reading the older layout would take four rows for two.
    const block = extRows(0x0d, 0x08, 0x10, 2, (bytes, row, index) => {
      bytes[row] = 0x10 + index;
      putU32(bytes, row + 0x04, 0x1000);
    });

    const newer = chainOf([block], "csme15")[0]?.userInfoRows;
    expect(newer).toHaveLength(2);
    expect(newer?.[0]).toMatchObject({ userID: 0x10, nvStorageQuota: 0x1000 });
    expect(newer?.[0]?.workingDirectory).toBeUndefined();

    // Read as the older layout, the same bytes are not even one whole row.
    expect(chainOf([block], "base")[0]?.userInfoRows).toHaveLength(0);
  });

  it("leaves a tag it does not know as an envelope", () => {
    // An init script, and something nobody has documented: both are still part
    // of the chain, and a panel that hid them would say the chain was shorter
    // than it is.
    const chain = chainOf(
      [extBlock(0x01, 0x20), extBlock(0x7f, 0x18), extSystemInfo(true)],
      "csme15"
    );

    expect(chain.map((one) => one.tag)).toEqual([0x01, 0x7f, 0x00]);
    expect(chain[0]?.size).toBe(0x20);
    expect(chain[1]?.size).toBe(0x18);
    expect(chain[2]?.systemInfo).toBeDefined();
  });

  it("stops at a block that claims no size", () => {
    // Zero is a false positive rather than a block: continuing would step
    // nowhere, forever.
    const one = extSystemInfo(true);
    const bytes = new Uint8Array(one.length + 8);
    bytes.set(one);

    expect(
      decodeExtensionChain({
        bytes,
        moduleContentBase: 0,
        moduleSize: bytes.length,
        chainStart: 0,
        family: "csme15",
      }).map((block) => block.tag)
    ).toEqual([0x00]);

    expect(
      decodeExtensionChain({
        bytes: new Uint8Array(16),
        moduleContentBase: 0,
        moduleSize: 16,
        chainStart: 0,
        family: "csme15",
      })
    ).toEqual([]);
  });

  it("keeps a block that overruns its module as an envelope", () => {
    // It cannot be trusted to hold a header, but the fact that it is there and
    // how big it claims to be is exactly what a reader needs to see.
    const block = extSystemInfo(true);
    const chain = decodeExtensionChain({
      bytes: block,
      moduleContentBase: 0,
      moduleSize: 0x40,
      chainStart: 0,
      family: "csme15",
    });

    expect(chain).toHaveLength(1);
    expect(chain[0]?.tag).toBe(0x00);
    expect(chain[0]?.systemInfo).toBeUndefined();
  });

  it("is bounded by the module and not by the region", () => {
    // What follows the module is the next partition, and walking into it would
    // read its bytes as blocks.
    const chain = extConcat([extSystemInfo(true), extSignedPackage(true)]);
    const bytes = new Uint8Array(chain.length + 0x100).fill(0xee);
    bytes.set(chain);

    const found = decodeExtensionChain({
      bytes,
      moduleContentBase: 0,
      moduleSize: chain.length,
      chainStart: 0,
      family: "csme15",
      baseOffset: 0x100,
    });

    expect(found).toHaveLength(2);
    expect(found[0]?.offset).toBe(0x100);
    expect(found[1]?.offset).toBe(0x100 + extSystemInfo(true).length);
    expect(found[1]?.signedPackage?.fwType).toBe(3);
  });
});

describe("decodeMetadataChain", () => {
  it("walks from the body's own base", () => {
    // A metadata body *is* a chain, where a manifest module's chain starts a
    // header's length into it.
    const body = extConcat([extModuleAttributes(true), extFeaturePermissions(2)]);
    const found = decodeMetadataChain({
      bytes: body,
      contentBase: 0,
      bodySize: body.length,
      family: "csme15",
    });

    expect(found.map((one) => one.tag)).toEqual([0x0a, 0x02]);
    expect(found[0]?.moduleAttributes).toMatchObject({
      compression: 1,
      encryption: 0,
      uncompressedSize: 0x4000,
      compressedSize: 0x1800,
      vendorID: 0x8086,
    });
    expect(found[0]?.moduleAttributes?.moduleHash.length).toBe(96);
  });

  it("reads the shorter hash on the older families", () => {
    const body = extModuleAttributes(false);
    const found = decodeMetadataChain({
      bytes: body,
      contentBase: 0,
      bodySize: body.length,
      family: "csme12",
    });

    expect(found[0]?.moduleAttributes?.moduleHash.length).toBe(64);
  });

  it("gives nothing for an empty or truncated body", () => {
    const empty = {
      bytes: new Uint8Array(0),
      contentBase: 0,
      bodySize: 0,
      family: "base",
    } as const;
    expect(decodeMetadataChain(empty)).toEqual([]);
    expect(
      decodeMetadataChain({ bytes: new Uint8Array(4), contentBase: 0, bodySize: 4, family: "base" })
    ).toEqual([]);
  });
});

describe("extensionFacts", () => {
  it("reads the security version and the version control number", () => {
    const chain = chainOf(
      [extPartitionInfo(0x03, true, { vcn: 11 }), extSignedPackage(true)],
      "csme15"
    );

    expect(extensionFacts(chain)).toMatchObject({
      arbSvn: 5,
      vcnFromPartitionInfo: 11,
      vcnFromSignedPackage: 3,
      nvmCompatibility: 1,
    });
  });

  it("keeps the last of each kind", () => {
    const chain = chainOf(
      [
        extSignedPackage(true, { arbSvn: 1, vcn: 1 }),
        extSignedPackage(true, { arbSvn: 9, vcn: 9 }),
      ],
      "csme15"
    );

    expect(extensionFacts(chain)).toMatchObject({ arbSvn: 9, vcnFromSignedPackage: 9 });
  });

  it("keeps an NVM compatibility a revised block found", () => {
    // Only a revised header has the field, and it is written from inside that
    // branch alone — so an unrevised block later in the chain must not clear it.
    const chain = [
      ...chainOf([extSignedPackage(true)], "csme15"),
      ...chainOf([extSignedPackage(false)], "base"),
    ];

    expect(extensionFacts(chain).nvmCompatibility).toBe(1);
  });

  it("reads the workstation bit from the client block", () => {
    expect(extensionFacts(chainOf([extClientSystemInfo()], "csme15")).workstation).toBe(true);
  });

  it("ignores the second partition-information tag, which carries no VCN", () => {
    expect(
      extensionFacts(chainOf([extPartitionInfo(0x16, true)], "csme15")).vcnFromPartitionInfo
    ).toBeUndefined();
  });

  it("finds nothing in an empty chain", () => {
    expect(extensionFacts([])).toEqual({
      arbSvn: undefined,
      vcnFromPartitionInfo: undefined,
      vcnFromSignedPackage: undefined,
      nvmCompatibility: undefined,
      workstation: undefined,
    });
  });
});
