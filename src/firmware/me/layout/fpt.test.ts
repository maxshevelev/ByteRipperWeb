import { describe, expect, it } from "vitest";
import { decodeFpt, findFptAnchor, fptStart, parseFirstFpt } from "@/firmware/me/layout/fpt";
import { fptRegion } from "@/firmware/me/testing/testMe";

/** The `$FPT` spine — upstream's `FPTParserTests`. */

describe("decodeFpt", () => {
  it("decodes a v2.0 header and its entries", () => {
    const region = fptRegion({
      entries: [
        { name: "FTUE", offset: 0x1000, size: 0x800, flags: 0x01 },
        { name: "rbe", offset: 0x2000, size: 0x200 },
      ],
    });

    const result = parseFirstFpt(region);
    expect(result?.headerVersion).toBe(0x20);
    expect(result?.resolvedVersion).toBe(0x20);
    expect(result?.partitions).toHaveLength(2);
    expect(result?.partitions[0]).toMatchObject({
      name: "FTUE",
      offset: 0x1000,
      size: 0x800,
      flags: 0x01,
    });
    expect(result?.partitions[1]).toMatchObject({ name: "rbe", offset: 0x2000 });
  });

  it("sees a v2.1 header written with a v2.0 tag", () => {
    // The second checksum word is neither zero nor erased, which is the only
    // thing that tells the two apart when the tag says 2.0.
    const region = fptRegion({
      entries: [{ name: "FTPR", offset: 0x1000, size: 0x1000 }],
      secondCrcWord: 0x1234,
    });

    expect(decodeFpt(region, 0)?.headerVersion).toBe(0x20);
    expect(decodeFpt(region, 0)?.resolvedVersion).toBe(0x21);
  });

  it("finds a `$FPT` that is not at the region's start", () => {
    // A marker 0x10 in, with no descriptor and no Layout Table: partitions
    // measure from the region base, not from the marker. Measuring them from
    // the marker is what put every partition on a CSME 11 image 0x10 too high.
    const region = fptRegion({
      anchor: 0x10,
      entries: [{ name: "FTPR", offset: 0x1000, size: 0x1000 }],
    });

    expect(findFptAnchor(region)).toBe(0x10);
    const result = decodeFpt(region, 0x10);
    expect(result?.fptStart).toBe(0);
    expect(result?.partitions[0]).toMatchObject({ name: "FTPR", offset: 0x1000 });
  });

  it("marks an entry with no offset or no size as empty", () => {
    const region = fptRegion({
      entries: [
        { name: "GONE", offset: 0, size: 0x100 },
        { name: "ZERO", offset: 0x1000, size: 0 },
        { name: "REAL", offset: 0x20, size: 0x10 },
      ],
    });

    expect(parseFirstFpt(region)?.partitions.map((one) => one.empty)).toEqual([true, true, false]);
  });

  it("refuses a header whose count runs past the region", () => {
    const region = fptRegion({
      entries: [{ name: "FTPR", offset: 0x1000, size: 0x1000 }],
      entryCount: 40,
    });

    expect(decodeFpt(region, 0)).toBeUndefined();
  });

  it("finds no `$FPT` in an erased region", () => {
    expect(parseFirstFpt(new Uint8Array(64).fill(0xff))).toBeUndefined();
  });

  it("does not take four matching bytes for an anchor", () => {
    // The tag alone turns up in compressed data. What makes an anchor is a
    // small nonzero count with a zeroed high half behind it.
    const bytes = new Uint8Array(0x100).fill(0xcc);
    bytes.set(
      Uint8Array.from("$FPT", (one) => one.charCodeAt(0)),
      0x20
    );

    expect(findFptAnchor(bytes)).toBeUndefined();
  });
});

describe("fptStart", () => {
  const region = fptRegion({
    anchor: 0x10,
    entries: [{ name: "FTPR", offset: 0x1000, size: 0x1000 }],
  });
  const at = (options: Parameters<typeof fptStart>[1]) => fptStart(region, options);

  it("measures from the marker minus 0x10 by default", () => {
    expect(at({ anchor: 0x10, version: 0x20, headerLength: 0x20, hasLayoutTable: false })).toBe(0);
  });

  it("measures from the marker when it is the IFWI data table", () => {
    expect(at({ anchor: 0x10, version: 0x20, headerLength: 0x20, hasLayoutTable: true })).toBe(
      0x10
    );
  });

  it("measures a v1.0 0x20 header from the marker", () => {
    expect(at({ anchor: 0x10, version: 0x10, headerLength: 0x20, hasLayoutTable: false })).toBe(
      0x10
    );
    // But only at that length: a v1.0 header of another length stays default.
    expect(at({ anchor: 0x10, version: 0x10, headerLength: 0x30, hasLayoutTable: false })).toBe(0);
  });

  it("measures a marker at the region base from itself", () => {
    expect(at({ anchor: 0, version: 0x20, headerLength: 0x20, hasLayoutTable: false })).toBe(0);
  });

  it("measures from the marker when an erased CSE header window precedes it", () => {
    // Zeros then sixteen erased bytes, 0x1000 before the marker: that window
    // means the marker is the region's base even with no Layout Table.
    const erased = new Uint8Array(0x1200).fill(0xff);
    erased.fill(0x00, 0, 0x48);

    expect(
      fptStart(erased, { anchor: 0x1000, version: 0x20, headerLength: 0x20, hasLayoutTable: false })
    ).toBe(0x1000);
  });
});
