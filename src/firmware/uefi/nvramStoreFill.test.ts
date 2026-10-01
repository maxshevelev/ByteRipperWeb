import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { nvarDataEntry, nvarEntry, nvarStore, nvarVolume } from "@/firmware/testing/testNvar";
import * as N from "@/firmware/testing/testNvram";
import { guid } from "@/firmware/uefi/efiGuid";
import { NVAR } from "@/firmware/uefi/nvarParser";
import {
  fillPercentUsed,
  fillUsed,
  type NvramStoreFill,
  nvramStoreFillOf,
} from "@/firmware/uefi/nvramStoreFill";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `NvramStoreFillTests.swift`: how full a store is, and what its
 * entries still count for (`UEFI_IMAGE_FORMAT.md` §9).
 */

/** A state no valid variable has: what a replaced or deleted one carries. */
const MARKED = 0x3c;
const bytes = (...values: number[]) => Uint8Array.from(values);

function fillOf(volume: Uint8Array): NvramStoreFill | undefined {
  const parsed = parseUefiImage(sourceOver(volume));
  return nvramStoreFillOf(
    (parsed.roots[0] as UEFINode).children[0] as UEFINode,
    new ImageReader(sourceOver(volume))
  );
}

describe("how full a store is", () => {
  // A marked entry whose variable has a current entry was replaced; one whose
  // variable is gone was deleted. The tree calls both `Invalid`, so the name is
  // read from the bytes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testAMarkedVSSEntryIsSupersededOrDeletedByWhetherItsVariableRemains
  it("calls a marked VSS entry superseded or deleted by whether its variable remains", () => {
    const store = N.vssStore({
      variables: [
        N.vssVariable({ name: "Setup", state: MARKED }),
        N.vssVariable({ name: "Gone", state: MARKED }),
        N.vssVariable({ name: "Setup" }),
        N.vssVariable({ name: "BootOrder" }),
      ],
      freeSpace: 0x40,
    });
    const result = fillOf(N.nvramVolume({ stores: [store] }));

    expect(result?.current).toBe(2);
    expect(result?.superseded).toBe(1);
    expect(result?.deleted).toBe(1);
  });

  // The same name under another vendor GUID is another variable.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testTheVendorGUIDIsPartOfTheVariable
  it("takes the vendor GUID to be part of the variable", () => {
    const other = guid("8BE4DF61-93CA-11D2-AA0D-00E098032B8C");
    const store = N.vssStore({
      variables: [
        N.vssVariable({ name: "Setup", vendorGuid: other, state: MARKED }),
        N.vssVariable({ name: "Setup" }),
      ],
    });
    expect(fillOf(N.nvramVolume({ stores: [store] }))?.deleted).toBe(1);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testUsedAndFreeAreTheBodyAndItsErasedRest
  it("counts used and free as the body and its erased rest", () => {
    const variables = [N.vssVariable({ name: "Setup" })];
    const store = N.vssStore({ variables, freeSpace: 0x100 });
    const result = fillOf(N.nvramVolume({ stores: [store] })) as NvramStoreFill;
    const written = (variables[0] as Uint8Array).length;

    expect(result.size).toBe(written + 0x100);
    expect(result.free).toBe(0x100);
    expect(fillUsed(result)).toBe(written);
    expect(fillPercentUsed(result)).toBe(Math.floor((written * 100) / (written + 0x100)));
  });

  // A store with room left never reads as full.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testThePercentageRoundsDown
  it("rounds the percentage down", () => {
    const fill: NvramStoreFill = { size: 1000, free: 1, current: 0, superseded: 0, deleted: 0 };
    expect(fillPercentUsed(fill)).toBe(99);
  });

  // A VSS2 variable keeps its name in its header, after the standard or the
  // authenticated fields.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testAVSS2EntryIsMatchedByTheNameInItsHeader
  it("matches a VSS2 entry by the name in its header", () => {
    const store = N.vss2Store({
      variables: [
        N.vss2Variable({ name: "Lang", state: MARKED }),
        N.authVssVariable({ name: "PK", state: MARKED }),
        N.vss2Variable({ name: "Lang" }),
        N.authVssVariable({ name: "PK" }),
        N.vss2Variable({ name: "Gone", state: MARKED }),
      ],
    });
    const result = fillOf(N.nvramVolume({ stores: [store] }));

    expect(result?.current).toBe(2);
    expect(result?.superseded).toBe(2);
    expect(result?.deleted).toBe(1);
  });

  // The earlier links of an NVAR chain are superseded; the data entry at its end
  // is current.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testAnNVARChainsEarlierLinksAreSuperseded
  it("supersedes the earlier links of an NVAR chain", () => {
    // `next` is the distance to the next link, which is the entry's own length
    // here; it changes no size, so the length is known up front.
    const head = nvarEntry({ next: nvarEntry({ data: bytes(0x01) }).length, data: bytes(0x01) });
    const middle = nvarDataEntry({
      next: nvarDataEntry({ data: bytes(0x02) }).length,
      data: bytes(0x02),
    });
    const store = nvarStore([
      head,
      middle,
      nvarDataEntry({ data: bytes(0x03) }),
      nvarEntry({ name: "Lang" }),
      nvarEntry({ attributes: NVAR.localGuid | NVAR.asciiName, name: "Gone" }),
    ]);
    const volume = nvarVolume({ body: store });
    const file = (parseUefiImage(sourceOver(volume)).roots[0] as UEFINode).children[0] as UEFINode;
    const result = nvramStoreFillOf(file, new ImageReader(sourceOver(volume)));

    expect(result?.current).toBe(2);
    expect(result?.superseded).toBe(2);
    expect(result?.deleted).toBe(1);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramStoreFillTests.swift#NvramStoreFillTests.testANodeWithoutEntriesHasNoFill
  it("has no fill for a node without entries", () => {
    const volume = N.nvramVolume({ stores: [N.vssStore()] });
    const root = parseUefiImage(sourceOver(volume)).roots[0] as UEFINode;
    expect(nvramStoreFillOf(root, new ImageReader(sourceOver(volume)))).toBeUndefined();
  });
});
