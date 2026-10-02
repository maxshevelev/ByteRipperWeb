import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  type DescriptorGeneration,
  densityBits,
  generationClock,
  hasWideMasks,
  readDescriptorGeneration,
  regionCount,
} from "@/firmware/uefi/descriptorGeneration";
import { Descriptor } from "@/firmware/uefi/descriptorParser";

/**
 * The chipset generation a descriptor's layout is (§2.5), checked on the map
 * words of the dumps at hand, whose ME region names its own chipset.
 */

/** A descriptor's first `0x1000` bytes with only the words the rules read. */
function generation(map1: number, map2: number, mipBase: number) {
  const bytes = new Uint8Array(0x1000).fill(0xff);
  const put = (value: number, at: number) => {
    for (let index = 0; index < 4; index++) bytes[at + index] = (value >>> (8 * index)) & 0xff;
  };
  put(Descriptor.signature, 0x10);
  put(map1, Descriptor.map1Offset);
  put(map2, Descriptor.map2Offset);
  bytes[0x0eff] = mipBase;
  return readDescriptorGeneration(0, new ImageReader(sourceOver(bytes)));
}

describe("the generation a descriptor is", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorGenerationTests.swift#DescriptorGenerationTests.testTheDumpsAtHandAreToldApart
  it("tells the dumps at hand apart", () => {
    const cases: [string, number, number, number, DescriptorGeneration][] = [
      ["ME 7 (Cougar Point)", 0x1210_0206, 0x0021_0120, 0x00, "cougarPoint"],
      ["CSME 11 (Sunrise Point LP)", 0x4210_0208, 0x0031_0330, 0x00, "sunrisePoint"],
      ["CSME 12 (Cannon Point H)", 0x5a10_0208, 0x0034_0330, 0xc0, "cannonPoint"],
      ["CSME 15 (Tiger Point LP)", 0x4610_0208, 0x0011_01a0, 0xc0, "tigerPoint"],
      ["1.bin (Tiger Point H)", 0x6510_0208, 0x0011_01b0, 0xc0, "tigerPoint"],
      ["CSME 16 (Alder Point)", 0x7310_0208, 0x0014_0170, 0xc0, "alderPoint"],
      ["clean_me (Alder Point LP)", 0x4610_0208, 0x0014_01b0, 0xc0, "alderPoint"],
    ];
    for (const [name, map1, map2, mip, expected] of cases) {
      const read = generation(map1, map2, mip);
      expect(read?.generation, name).toBe(expected);
      expect(read?.isCertain, name).toBe(true);
    }
  });

  // A layout no rule names is read as the newest family the rules end on, and
  // says it is assumed.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorGenerationTests.swift#DescriptorGenerationTests.testAnUnknownLayoutIsAssumed
  it("reads an unknown layout as the nearest, and says so", () => {
    const read = generation(0x4610_0208, 0x0077_01b0, 0xc0);
    expect(read?.generation).toBe("tigerPoint");
    expect(read?.isCertain).toBe(false);
  });

  // What the generation changes in the reading.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorGenerationTests.swift#DescriptorGenerationTests.testTheGenerationDecidesTheLayout
  it("decides the layout of the rest", () => {
    expect(regionCount("cougarPoint")).toBe(5);
    expect(regionCount("sunrisePoint")).toBe(10);
    expect(regionCount("alderPoint")).toBe(16);
    expect(hasWideMasks("cougarPoint")).toBe(false);
    expect(hasWideMasks("sunrisePoint")).toBe(true);
    expect(densityBits("cougarPoint")).toBe(3);
    expect(densityBits("lynxPoint")).toBe(4);
    // One code, three clocks, by generation.
    expect(generationClock("cougarPoint", 4)).toEqual([50]);
    expect(generationClock("sunrisePoint", 4)).toEqual([30]);
    expect(generationClock("alderPoint", 4)).toEqual([25]);
    expect(generationClock("alderPoint", 2)).toBeUndefined();
  });
});
