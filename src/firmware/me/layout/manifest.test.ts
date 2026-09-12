import { describe, expect, it } from "vitest";
import {
  decodeManifest,
  manifestAnchors,
  manifestProtectedData,
  parseFirstManifest,
} from "@/firmware/me/layout/manifest";
import { manifest, regionWithManifest } from "@/firmware/me/testing/testMe";

/** The `$MN2` / `$MAN` manifest — upstream's `ManifestParserTests`. */

describe("decodeManifest", () => {
  it("decodes a CSE manifest's version, MEU block and key", () => {
    const found = parseFirstManifest(manifest());

    expect(found).toMatchObject({
      base: 0,
      tag: "$MN2",
      format: "r1",
      major: 15,
      minor: 40,
      hotfix: 37,
      build: 3121,
      meMajor: 15,
      meMinor: 40,
      svn: 3,
      pvBit: true,
      debugSigned: false,
    });
    // The date is packed BCD: 0x24 / 0x03 / 0x2021 is the 24th of March 2021,
    // and a decoder that read the bytes as plain numbers would say the 36th.
    expect(found).toMatchObject({ day: 24, month: 3, year: 2021 });

    expect(found?.rsaPublicKey?.length).toBe(0x100);
    expect([...(found?.rsaPublicKey ?? [])]).toEqual([
      ...Array.from({ length: 0x100 }, (_, index) => index & 0xff),
    ]);
    expect(found?.rsaSignature?.length).toBe(0x100);
    expect(found?.rsaExponent).toBe(65537);
  });

  it("finds a manifest that is not at the region's start", () => {
    const found = parseFirstManifest(regionWithManifest(0x100));

    expect(found?.base).toBe(0x100);
    expect(found?.major).toBe(15);
  });

  it("gives a pre-CSE manifest no MEU fields", () => {
    // The same bytes are a module count and a version control number there, and
    // reading them as an MEU block would report a version nothing has.
    const found = parseFirstManifest(manifest({ format: "r0" }));

    expect(found?.format).toBe("r0");
    expect(found?.meMajor).toBeUndefined();
    expect(found?.meMinor).toBeUndefined();
    expect(found?.meHotfix).toBeUndefined();
    expect(found?.meBuild).toBeUndefined();
    expect(found?.vcn).toBe(2);
    expect(found?.numModules).toBe(4);
  });

  it("reads the whole MEU block on both CSE formats", () => {
    for (const format of ["r1", "r2"] as const) {
      const found = parseFirstManifest(manifest({ format, meHotfix: 0x001a, meBuild: 0x12b4 }));

      expect(found, format).toMatchObject({
        meMajor: 15,
        meMinor: 40,
        meHotfix: 0x001a,
        meBuild: 0x12b4,
      });
    }
  });

  it("gives a CSE manifest no version control number or module count", () => {
    const found = parseFirstManifest(manifest({ vcn: 7 }));

    expect(found?.format).toBe("r1");
    expect(found?.meMajor).toBe(15);
    expect(found?.vcn).toBeUndefined();
    expect(found?.numModules).toBeUndefined();
  });

  it("reads a pre-CSE manifest's declared module count", () => {
    const found = parseFirstManifest(manifest({ format: "r0", numModules: 8 }));

    expect(found?.format).toBe("r0");
    expect(found?.numModules).toBe(8);
  });

  it("reads both signing flags", () => {
    const found = parseFirstManifest(manifest({ flags: 0x8000_0001 }));

    expect(found?.debugSigned).toBe(true);
    expect(found?.pvBit).toBe(true);
  });

  it("decodes a `$MAN` tag as well", () => {
    expect(parseFirstManifest(manifest({ tag: "$MAN" }))?.tag).toBe("$MAN");
  });

  it("finds no manifest in an erased region", () => {
    expect(parseFirstManifest(new Uint8Array(0x300).fill(0xff))).toBeUndefined();
  });

  it("keeps a date field that is not valid BCD as it was read", () => {
    // 0x07E9 has a nibble above 9, so it is not BCD at all. Keeping the raw
    // value gives 2025; decoding it as BCD anyway would give a year that is not
    // a year.
    expect(parseFirstManifest(manifest({ year: 0x07e9 }))?.year).toBe(2025);
  });

  it("refuses an anchor too close to the region's start", () => {
    // The struct's base is sixteen bytes before the anchor, so an anchor at 8
    // describes a struct that is not there.
    expect(decodeManifest(manifest(), 8)).toBeUndefined();
  });
});

describe("manifestAnchors", () => {
  it("finds every manifest in offset order", () => {
    // A flash image carries one per partition plus the recovery copies, and the
    // first in byte order is usually a recovery copy — which is why they are all
    // needed rather than just the first.
    const one = manifest();
    const bytes = new Uint8Array(0x800);
    bytes.set(one, 0);
    bytes.set(one, 0x300);

    expect(manifestAnchors(bytes)).toEqual([0x10, 0x310]);
  });

  it("does not take a stray vendor id for an anchor", () => {
    const bytes = new Uint8Array(0x100).fill(0x86);
    expect(manifestAnchors(bytes)).toEqual([]);
  });
});

describe("manifestProtectedData", () => {
  it("joins the head to the tail the signature covers", () => {
    // Both size fields are in dwords: a header of 0x40 dwords is 0x100 bytes,
    // and the manifest itself is 0x100 dwords, so the tail is 0x300 bytes.
    const bytes = manifest({ headerLength: 0x40, manifestSize: 0x100, region: 0x400 });
    const found = decodeManifest(bytes, 0x10);
    if (found === undefined) throw new Error("the fixture should decode");

    // The struct's own size field is in dwords, so a header length of 0x40
    // dwords is 0x100 bytes, and the manifest's size follows the same rule.
    expect(found.headerLengthBytes).toBe(0x100);
    expect(found.sizeBytes).toBe(0x400);
    const window = manifestProtectedData(bytes, found);
    expect(window?.length).toBe(0x80 + 0x300);
    expect([...(window?.subarray(0, 0x80) ?? [])]).toEqual([...bytes.subarray(0, 0x80)]);
  });

  it("says nothing when the size fields describe bytes that are not there", () => {
    // A signature cannot be checked against a short read, and reporting it valid
    // over one would be worse than reporting nothing.
    const bytes = manifest({ manifestSize: 0x100 });
    const found = decodeManifest(bytes, 0x10);
    if (found === undefined) throw new Error("the fixture should decode");

    expect(manifestProtectedData(bytes.subarray(0, 0x100), found)).toBeUndefined();
  });
});
