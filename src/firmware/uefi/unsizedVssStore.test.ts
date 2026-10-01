import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as N from "@/firmware/testing/testNvram";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `UnsizedVssStoreTests.swift`: a `$VSS` store whose size field
 * holds the "no size" marker, outside an FDC — Insyde's live variable store
 * (`UEFI_IMAGE_FORMAT.md` §9). The reference refuses it; it is read here by its
 * own structure: variables while the marker holds, then erased bytes, and the
 * store ends where they do.
 */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const unsized = (variables: readonly Uint8Array[], freeSpace: number) =>
  N.vssStore({ variables, size: 0xffff_ffff, freeSpace });

describe("a $VSS store with no size", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UnsizedVssStoreTests.swift#UnsizedVssStoreTests.testTheStoreEndsWhereItsFreeSpaceDoes
  it("ends where its free space does", () => {
    const variables = [N.vssVariable({ name: "PK" }), N.vssVariable({ name: "KEK" })];
    const store = unsized(variables, 0x100);
    const parsed = parse(N.nvramVolume({ stores: [store, N.ftwStore()] }));
    const volume = parsed.roots[0] as UEFINode;

    expect(kinds(volume.children)).toEqual(["vssStore", "ftwStore"]);
    expect(nodeRange(volume.children[0] as UEFINode)).toEqual({
      start: 0x48,
      end: 0x48 + store.length,
    });
    const entries = (volume.children[0] as UEFINode).children;
    expect(kinds(entries)).toEqual(["vssEntry", "vssEntry", "freeSpace"]);
    expect(entries.slice(0, 2).map((node) => node.name)).toEqual(["PK", "KEK"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // With nothing after it, the store reaches the end of the body.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UnsizedVssStoreTests.swift#UnsizedVssStoreTests.testWithNothingAfterItTheStoreReachesTheBodysEnd
  it("reaches the body's end with nothing after it", () => {
    const store = unsized([N.vssVariable({ name: "PK" })], 0x40);
    const volume = parse(N.nvramVolume({ stores: [store], length: 0x200 })).roots[0] as UEFINode;

    expect(kinds(volume.children)).toEqual(["vssStore"]);
    expect(nodeRange(volume.children[0] as UEFINode).end).toBe(0x200);
  });

  // A header with no variable after it is not measured, and stays padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UnsizedVssStoreTests.swift#UnsizedVssStoreTests.testAStoreWithNoVariableStaysPadding
  it("stays padding with no variable after the header", () => {
    const volume = parse(N.nvramVolume({ stores: [unsized([], 0x40)] })).roots[0] as UEFINode;
    expect(kinds(volume.children)).not.toContain("vssStore");
  });

  // Only a plain `$VSS` is measured; an Apple store with the marker is refused,
  // as the reference refuses it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UnsizedVssStoreTests.swift#UnsizedVssStoreTests.testAnAppleStoreWithTheMarkerIsRefused
  it("refuses an Apple store with the marker", () => {
    const store = N.vssStore({
      variables: [N.vssVariable({ name: "PK" })],
      signature: NVRAM.appleSvsSignature,
      size: 0xffff_ffff,
      freeSpace: 0x40,
    });
    const volume = parse(N.nvramVolume({ stores: [store] })).roots[0] as UEFINode;
    expect(kinds(volume.children)).not.toContain("vssStore");
  });
});
