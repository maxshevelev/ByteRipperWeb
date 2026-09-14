import { describe, expect, it } from "vitest";
import {
  downgradeBlacklist,
  preCseProductionReady,
  preCseSummary,
  scanSkuAttributes,
} from "@/firmware/me/identify/preCseMe";

/**
 * The classic ME `$SKU` decode. Ported from upstream's `PreCSEDecodeTests`; the
 * byte semantics are pinned to a real Lenovo T450 ME 10 image, whose attributes
 * `cf fa ff ff 0a 43 00 00` read as 5MB on WPT-LP.
 */

const T450_ATTRIB = [0xcf, 0xfa, 0xff, 0xff, 0x0a, 0x43, 0x00, 0x00];

const ascii = (text: string) => Uint8Array.from(text, (one) => one.charCodeAt(0));

/** A `$SKU` attributes block at `blockOffset`, erased filler before and after. */
function skuRegion(blockOffset: number, attrib: readonly number[], sizeByte = 4): Uint8Array {
  const bytes = new Uint8Array(blockOffset + 16 + 32).fill(0xff);
  bytes.set(ascii("$SKU"), blockOffset);
  bytes.set([sizeByte, 0, 0, 0], blockOffset + 4);
  bytes.set(attrib, blockOffset + 8);
  return bytes;
}

const summary = (
  bytes: Uint8Array,
  manifestBase: number,
  major: number,
  minor: number,
  hotfix = 0,
  build = 0
) => preCseSummary({ bytes, manifestBase, major, minor, hotfix, build });

describe("ME 7's own rows", () => {
  it("says Patsburg support, and the platform says so too", () => {
    const patsburg = skuRegion(0x40, [0, 0, 0, 0, 0x83, 0, 0, 0]);
    expect(summary(patsburg, 0, 7, 1)).toMatchObject({
      patsburgSupport: true,
      platform: "CPT/PBG",
    });

    const plain = skuRegion(0x40, [0, 0, 0, 0, 0x03, 0, 0, 0]);
    expect(summary(plain, 0, 7, 1)).toMatchObject({ patsburgSupport: false, platform: "CPT" });

    expect(summary(patsburg, 0, 10, 0)?.patsburgSupport).toBeUndefined();
  });

  it("reads both downgrade blacklist lines", () => {
    const bytes = new Uint8Array(0x2000);
    const write = (words: readonly number[], at: number) =>
      words.forEach((word, index) => {
        bytes[at + index * 2] = word & 0xff;
        bytes[at + index * 2 + 1] = (word >>> 8) & 0xff;
      });
    const base = 0x100;
    const tag = base + 0x1b;
    write([1, 2, 1000], tag + 0x6df);
    write([0, 0, 0], tag + 0x6eb);

    const entries = downgradeBlacklist(bytes, base);
    expect(entries.sevenZero).toEqual({ minor: 1, hotfix: 2, build: 1000 });
    expect(entries.sevenOne).toBeUndefined();

    const short = downgradeBlacklist(new Uint8Array(0x100), 0);
    expect(short.sevenZero).toBeUndefined();
    expect(short.sevenOne).toBeUndefined();
  });
});

describe("the production-ready bit", () => {
  function region(bit: number | undefined, trailing = "IFRP"): Uint8Array {
    const bytes = new Uint8Array(0x200).fill(0xff);
    if (bit === undefined) return bytes;
    const marker = 0x100;
    bytes.set(ascii("$DAT"), marker);
    bytes.fill(0, marker + 4, marker + 24);
    bytes[marker + 0x10] = bit;
    bytes.set(ascii(trailing), marker + 24);
    return bytes;
  }

  it("rides in the $DAT marker past the manifest", () => {
    expect(preCseProductionReady(region(1), 0)).toBe(true);
    expect(preCseProductionReady(region(0), 0)).toBe(false);
    expect(preCseProductionReady(region(undefined), 0)).toBeUndefined();
    expect(preCseProductionReady(region(1, "XXXX"), 0)).toBeUndefined();
    // A marker before the manifest is not this manifest's.
    expect(preCseProductionReady(region(1), 0x180)).toBeUndefined();
  });
});

describe("the attribute scan", () => {
  it("splits the T450's bytes exactly", () => {
    const a = scanSkuAttributes(skuRegion(0x100, T450_ATTRIB), 0x100);
    expect(a).toEqual({
      offset: 0x100,
      sizeDwords: 4,
      skuMe: 0xcffa_ffff,
      value1: 0xcffaff,
      slim: true,
      patsburg: false,
      skuType: 0,
      skuSize: 10,
      value10: 0x430000,
    });
  });

  it("allows a size of 3 and a small SKU size", () => {
    const a = scanSkuAttributes(skuRegion(0, [0, 0, 0, 0, 0x01, 0, 0, 0], 3), 0);
    expect(a?.sizeDwords).toBe(3);
    expect(a?.skuSize).toBe(1);
    expect(a?.slim).toBe(false);
  });

  it("skips a malformed header to reach the real block", () => {
    const bad = new Uint8Array(0x80 + 4 + 13).fill(0xff);
    bad.set(ascii("$SKU"), 0x80);
    bad[0x84] = 0x05;
    bad.fill(0, 0x85);
    const real = skuRegion(0, T450_ATTRIB);
    const bytes = new Uint8Array(bad.length + real.length);
    bytes.set(bad);
    bytes.set(real, bad.length);
    expect(scanSkuAttributes(bytes, 0x80)?.offset).toBe(bad.length);
  });

  it("finds nothing without a $SKU", () => {
    const bytes = new Uint8Array(0x200).fill(0xff);
    expect(scanSkuAttributes(bytes, 0)).toBeUndefined();
    expect(summary(bytes, 0, 10, 0)).toBeUndefined();
  });
});

describe("ME 7–10", () => {
  it("maps the T450 to 5MB on WPT-LP", () => {
    expect(summary(skuRegion(0x100, T450_ATTRIB), 0x100, 10, 0)).toMatchObject({
      sku: "5MB",
      platform: "WPT-LP",
    });
  });

  it("reads SKU Type 2 as Slim and 1 as 1.5MB", () => {
    expect(summary(skuRegion(0, [0, 0, 0, 0, 0x20, 0, 0, 0]), 0, 10, 0)).toMatchObject({
      sku: "Slim",
      platform: "WPT-LP",
    });
    expect(summary(skuRegion(0, [0, 0, 0, 0, 0x10, 0, 0, 0]), 0, 10, 0)?.sku).toBe("1.5MB");
  });

  it("names WPT-LP only at minor 0", () => {
    const one = summary(skuRegion(0, T450_ATTRIB), 0, 10, 1);
    expect(one?.sku).toBe("5MB");
    expect(one?.platform).toBeUndefined();
  });

  it("names ME 9's platform by the minor", () => {
    const bytes = skuRegion(0, [0, 0, 0, 0, 0x10, 0, 0, 0]);
    expect(summary(bytes, 0, 9, 0)?.platform).toBe("LPT");
    expect(summary(bytes, 0, 9, 1)?.platform).toBe("LPT/WPT");
    expect(summary(bytes, 0, 9, 5)?.platform).toBe("LPT-LP");
    expect(summary(bytes, 0, 9, 6)?.platform).toBe("LPT-LP");
    expect(summary(bytes, 0, 9, 7)?.platform).toBeUndefined();
    expect(summary(bytes, 0, 9, 0)?.sku).toBe("1.5MB");
  });

  it("reads ME 8's SKU size in half megabytes", () => {
    const small = skuRegion(0, [0, 0, 0, 0, 0x03, 0, 0, 0]);
    expect(summary(small, 0, 8, 0)).toMatchObject({ sku: "1.5MB", platform: "CPT/PBG/PPT" });
    expect(summary(skuRegion(0, [0, 0, 0, 0, 0x0a, 0, 0, 0]), 0, 8, 0)?.sku).toBe("5MB");
  });

  it("reads ME 7's slim and Patsburg bits", () => {
    const plain = skuRegion(0, [0, 0, 0, 0, 0x0a, 0, 0, 0]);
    expect(summary(plain, 0, 7, 0)).toMatchObject({ sku: "5MB", platform: "CPT" });
    expect(summary(skuRegion(0, [0, 0, 0, 0x80, 0x0a, 0, 0, 0]), 0, 7, 0)?.sku).toBe("Slim");
    expect(summary(skuRegion(0, [0, 0, 0, 0, 0x8a, 0, 0, 0]), 0, 7, 0)?.platform).toBe("CPT/PBG");
    const both = skuRegion(0, [0, 0, 0, 0x80, 0x8a, 0, 0, 0]);
    expect(summary(both, 0, 7, 0)).toMatchObject({ sku: "Slim", platform: "CPT/PBG" });
    expect(summary(skuRegion(0, [0, 0, 0, 0, 0x03, 0, 0, 0]), 0, 7, 0)?.sku).toBe("1.5MB");
  });

  it("keeps ME 7's odd 5MB build", () => {
    const edge = skuRegion(0, [0, 0, 0, 0, 0x01, 0, 0, 0]);
    expect(summary(edge, 0, 7, 0, 0, 1040)?.sku).toBeUndefined();
    expect(summary(edge, 0, 7, 0, 0, 1041)?.sku).toBe("5MB");
  });
});

describe("ME 2–6", () => {
  it("maps ICH8 by the constant", () => {
    const amt = skuRegion(0, [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(summary(amt, 0, 2, 0)).toMatchObject({ sku: "AMT", platform: "ICH8" });
    expect(summary(skuRegion(0, [0x02, 0, 0, 0, 0, 0, 0, 0]), 0, 2, 0)?.sku).toBe("QST");
    expect(summary(amt, 0, 2, 5)?.platform).toBe("ICH8M");
  });

  it("maps ME 3 and ME 4", () => {
    const asf = skuRegion(0, [0x06, 0, 0, 0, 0, 0, 0, 0]);
    expect(summary(asf, 0, 3, 0)).toMatchObject({ sku: "ASF", platform: "ICH9" });
    const amtTpm = skuRegion(0, [0xac, 0x20, 0, 0, 0, 0, 0, 0]);
    expect(summary(amtTpm, 0, 4, 0)).toMatchObject({ sku: "AMT + TPM", platform: "ICH9M" });
  });

  it("maps ME 5's Digital Office", () => {
    expect(summary(skuRegion(0, [0x3e, 0x08, 0, 0, 0, 0, 0, 0]), 0, 5, 0)).toMatchObject({
      sku: "Digital Office",
      platform: "ICH10",
    });
  });

  it("maps ME 6's Ignition and sizes", () => {
    const ignition = skuRegion(0, [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(summary(ignition, 0, 6, 0, 50)).toMatchObject({ sku: "Ignition CCK", platform: "CCK" });
    expect(summary(ignition, 0, 6, 0, 49)).toMatchObject({ sku: "Ignition IBX", platform: "IBX" });
    expect(summary(skuRegion(0, [0x70, 0x1c, 0, 0, 0, 0, 0, 0]), 0, 6, 0)?.sku).toBe("1.5MB");
    expect(summary(skuRegion(0, [0x77, 0xfc, 0x6e, 0, 0, 0, 0, 0]), 0, 6, 0)?.sku).toBe("5MB DT");
    expect(summary(skuRegion(0, [0x77, 0xdc, 0xee, 0, 0, 0, 0, 0]), 0, 6, 0)?.sku).toBe("5MB MB");
  });
});

describe("a major outside the decode", () => {
  it("yields no rows", () => {
    expect(summary(skuRegion(0, T450_ATTRIB), 0, 11, 0)).toEqual({
      sku: undefined,
      platform: undefined,
      patsburgSupport: undefined,
    });
  });
});
