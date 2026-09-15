import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as N from "@/firmware/testing/testNvram";
import { guid, guidText } from "@/firmware/uefi/efiGuid";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `NvramOtherStoreTests.swift`: the NVRAM stores of Apple and
 * Phoenix firmware, and the Microsoft SLIC records.
 *
 * Where a VSS store is *cut* at the body's end when it claims too much, these
 * have fixed-size bodies in the reference parser — so a store that claims more
 * of the body than there is is *refused* and the bytes become padding.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const parse = (image: Uint8Array) => parseUefiImage(sourceOver(image));
const rootOf = (stores: readonly Uint8Array[]) =>
  parse(N.nvramVolume({ stores })).roots[0] as UEFINode;
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const range = (node: UEFINode | undefined) => (node === undefined ? undefined : nodeRange(node));

describe("an Apple SysF store", () => {
  // A SysF store is led by an `Fsys`/`Gaid` signature and a 16-bit size, and
  // its variables are an ASCII name, a data length and the data.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testASysfStoreExpandsToItsVariablesAndFreeSpace
  it("expands to its variables and free space", () => {
    const store = N.sysfStore({
      variables: [N.sysfVariable({ name: "BootOrder", data: bytes(0x01, 0x02) })],
    });
    const volume = rootOf([store]);

    expect(kinds(volume.children)).toEqual(["sysFStore"]);
    const sysf = volume.children[0] as UEFINode;
    expect(sysf.name).toBe("Apple SysF store");
    expect(sysf.header).toEqual({ start: 0x48, end: 0x53 });
    expect(sysf.body).toEqual({ start: 0x53, end: 0x79 });

    expect(kinds(sysf.children)).toEqual(["sysFEntry", "sysFEntry", "freeSpace"]);
    const variable = sysf.children[0] as UEFINode;
    expect(variable.subtype).toBe(Sub.normalSysFEntry);
    expect(variable.name).toBe("BootOrder");
    expect(variable.header).toEqual({ start: 0x53, end: 0x5f });
    expect(variable.body).toEqual({ start: 0x5f, end: 0x61 });

    // A chunk named "EOF" ends the store: four bytes of header and no data.
    const eof = sysf.children[1] as UEFINode;
    expect(eof.subtype).toBe(Sub.normalSysFEntry);
    expect(eof.name).toBe("EOF");
    expect(eof.header).toEqual({ start: 0x61, end: 0x65 });
    expect(eof.body).toEqual({ start: 0x65, end: 0x65 });

    // The zeroes before the CRC32 are free space the store can grow into.
    expect(range(sysf.children[2])).toEqual({ start: 0x65, end: 0x79 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testADiagStoreAndAnInvalidVariableAreRead
  it("reads a Diag store, and an invalid variable in it", () => {
    const store = N.sysfStore({
      variables: [N.sysfVariable({ name: "BootOrder", invalid: true })],
      signature: NVRAM.appleDiagSignature,
    });
    const sysf = rootOf([store]).children[0] as UEFINode;

    expect(sysf.name).toBe("Apple Diag store");
    expect(sysf.children[0]?.subtype).toBe(Sub.invalidSysFEntry);
    expect(sysf.children[0]?.name).toBe("Invalid");
  });

  // Refused, not cut: the reference parser reads the store's fixed-size body
  // whole.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testASysfStoreThatOverrunsItsBodyIsRefused
  it("is refused when it overruns its body", () => {
    const store = N.sysfStore({
      variables: [N.sysfVariable({ name: "BootOrder" })],
      size: 0x200,
    });
    expect(kinds(rootOf([store]).children)).toEqual(["padding"]);
  });
});

describe("a Phoenix SCT flash map", () => {
  const guidA = guid("11111111-2222-3333-4444-555555555555");
  const guidB = guid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
  const guidC = guid("FEDCBA98-7654-3210-AAAA-BBBBBBBBBBBB");

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAPhoenixFlashMapStoreExpandsToItsEntries
  it("expands to its entries", () => {
    const store = N.flashMapStore({
      entries: [
        N.flashMapEntry({ guid: guidA, dataType: 0x0000 }), // volume
        N.flashMapEntry({ guid: guidB, dataType: 0x0001 }), // data block
        N.flashMapEntry({ guid: guidC, dataType: 0x0002 }), // unknown
      ],
    });
    const volume = rootOf([store]);

    expect(kinds(volume.children)).toEqual(["flashMapStore"]);
    const map = volume.children[0] as UEFINode;
    expect(map.name).toBe("Phoenix SCT flash map");
    expect(map.header).toEqual({ start: 0x48, end: 0x58 });
    expect(map.body).toEqual({ start: 0x58, end: 0xc4 });

    expect(kinds(map.children)).toEqual(["flashMapEntry", "flashMapEntry", "flashMapEntry"]);
    expect(map.children.map((one) => one.subtype)).toEqual([
      Sub.volumeFlashMapEntry,
      Sub.dataFlashMapEntry,
      Sub.unknownFlashMapEntry,
    ]);

    // An entry carries its region GUID as identity.
    expect(map.children[0]?.name).toBe(guidText(guidA));
    expect(map.children[0]?.guid).toEqual(guidA);
    expect(map.children[1]?.guid).toEqual(guidB);
    expect(map.children[2]?.guid).toEqual(guidC);
    expect(map.children[0]?.header).toEqual({ start: 0x58, end: 0x7c });
    expect(map.children[1]?.header).toEqual({ start: 0x7c, end: 0xa0 });
    expect(map.children[2]?.header).toEqual({ start: 0xa0, end: 0xc4 });
    expect(map.children[0]?.body).toEqual({ start: 0x7c, end: 0x7c });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAPhoenixFlashMapStoreThatOverrunsItsBodyIsRefused
  it("is refused when its entry count reaches past the body", () => {
    const store = N.flashMapStore({
      entries: [N.flashMapEntry({ guid: guidA, dataType: 0 })],
      entryCount: 4,
    });
    expect(kinds(rootOf([store]).children)).toEqual(["padding"]);
  });
});

describe("a Phoenix EVSA store", () => {
  const g1 = guid("11111111-2222-3333-4444-555555555555");

  // An EVSA store pairs variable ids with names and GUIDs through separate
  // entries, and a data entry that resolves both ids is named by the name entry.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAnEvsaStoreResolvesItsVariableNames
  it("resolves its variable names", () => {
    const store = N.evsaStore({
      entries: [
        N.evsaGuidEntry({ guid: g1, id: 1 }),
        N.evsaNameEntry({ name: "Lang", id: 2 }),
        N.evsaDataEntry({ guidId: 1, varId: 2, data: bytes(0x01, 0x02, 0x03, 0x04) }),
      ],
      freeSpace: 0,
    });
    const volume = rootOf([store]);

    expect(kinds(volume.children)).toEqual(["evsaStore"]);
    const evsa = volume.children[0] as UEFINode;
    expect(evsa.name).toBe("Phoenix EVSA store");
    expect(evsa.header).toEqual({ start: 0x48, end: 0x5c });
    expect(evsa.body).toEqual({ start: 0x5c, end: 0x92 });

    expect(kinds(evsa.children)).toEqual(["evsaEntry", "evsaEntry", "evsaEntry"]);
    expect(evsa.children.map((one) => one.subtype)).toEqual([
      Sub.guidEvsaEntry,
      Sub.nameEvsaEntry,
      Sub.dataEvsaEntry,
    ]);

    // A GUID entry carries the GUID under its id.
    const guidEntry = evsa.children[0] as UEFINode;
    expect(guidEntry.name).toBe(guidText(g1));
    expect(guidEntry.guid).toEqual(g1);
    expect(guidEntry.header).toEqual({ start: 0x5c, end: 0x62 });
    expect(guidEntry.body).toEqual({ start: 0x62, end: 0x72 });

    // The name entry and the data variable that resolves it are both named.
    expect(evsa.children[1]?.name).toBe("Lang");
    expect(evsa.children[1]?.header).toEqual({ start: 0x72, end: 0x78 });
    expect(evsa.children[1]?.body).toEqual({ start: 0x78, end: 0x82 });
    const variable = evsa.children[2] as UEFINode;
    expect(variable.name).toBe("Lang");
    expect(variable.header).toEqual({ start: 0x82, end: 0x8e });
    expect(variable.body).toEqual({ start: 0x8e, end: 0x92 });
    expect(variable.guid).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAnEvsaStoreMarksUnresolvedDataVariablesInvalid
  it("marks unresolved data variables invalid", () => {
    const store = N.evsaStore({
      entries: [
        N.evsaGuidEntry({ guid: g1, id: 1 }),
        N.evsaNameEntry({ name: "Lang", id: 2 }),
        N.evsaDataEntry({
          type: NVRAM.evsaEntryTypeDataInvalid,
          guidId: 1,
          varId: 2,
          data: bytes(0x01),
        }),
        N.evsaDataEntry({ guidId: 9, varId: 9, data: bytes(0x02) }),
      ],
      freeSpace: 0,
    });
    const variables = rootOf([store]).children[0]?.children ?? [];

    expect(variables).toHaveLength(4);
    expect(variables[2]?.subtype).toBe(Sub.invalidEvsaEntry);
    expect(variables[2]?.name).toBe("Invalid");
    expect(variables[3]?.subtype).toBe(Sub.invalidEvsaEntry);
    expect(variables[3]?.name).toBe("Invalid");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAnEvsaStoresFreeSpaceAfterItsEntriesIsErased
  it("leaves the space after its entries erased", () => {
    const store = N.evsaStore({ entries: [N.evsaGuidEntry({ guid: g1, id: 1 })] });
    const children = rootOf([store]).children[0]?.children ?? [];

    expect(kinds(children)).toEqual(["evsaEntry", "freeSpace"]);
    expect(range(children[1])).toEqual({ start: 0x72, end: 0x82 });
    expect(children[1]?.isErased).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testAnEvsaStoreThatOverrunsItsBodyIsRefused
  it("is refused when its declared size overruns the body", () => {
    expect(kinds(rootOf([N.evsaStore({ size: 0x400 })]).children)).toEqual(["padding"]);
  });
});

describe("the leaf stores", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testACmdbStoreIsKeptWhole
  it("keeps a CMDB store whole", () => {
    const volume = rootOf([N.cmdbStore()]);

    expect(kinds(volume.children)).toEqual(["cmdbStore"]);
    const cmdb = volume.children[0] as UEFINode;
    expect(cmdb.name).toBe("Phoenix CMDB store");
    expect(cmdb.header).toEqual({ start: 0x48, end: 0x58 });
    expect(cmdb.body).toEqual({ start: 0x58, end: 0x148 });
    expect(cmdb.children).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testASlicPublicKeyIsKeptWhole
  it("keeps a SLIC public key whole", () => {
    const volume = rootOf([N.slicPubkey()]);

    expect(kinds(volume.children)).toEqual(["slicData"]);
    const pubkey = volume.children[0] as UEFINode;
    expect(pubkey.subtype).toBe(Sub.pubkeySlicData);
    expect(pubkey.name).toBe("SLIC pubkey");
    expect(range(pubkey)).toEqual({ start: 0x48, end: 0xe4 });
    expect(pubkey.body).toEqual({ start: 0xe4, end: 0xe4 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramOtherStoreTests.swift#NvramOtherStoreTests.testASlicMarkerIsKeptWhole
  it("keeps a SLIC marker whole", () => {
    const volume = rootOf([N.slicMarker()]);

    expect(kinds(volume.children)).toEqual(["slicData"]);
    const marker = volume.children[0] as UEFINode;
    expect(marker.subtype).toBe(Sub.markerSlicData);
    expect(marker.name).toBe("SLIC marker");
    expect(range(marker)).toEqual({ start: 0x48, end: 0xfe });
  });
});
