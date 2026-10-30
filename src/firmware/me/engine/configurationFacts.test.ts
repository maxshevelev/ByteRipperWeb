import { describe, expect, it } from "vitest";
import { analyzeMeRegion } from "@/firmware/me/engine/analyzer";
import { pchStrapWords } from "@/firmware/me/layout/flashDescriptor";

describe("the platform family", () => {
  // Which half of its chipset generation the board is comes from the descriptor alone:
  // the two halves lay the PCH strap section out over different lengths, and nothing in
  // the ME region says which it is. A length neither half uses, and no descriptor at
  // all, leave the question open — an extracted region carries no descriptor.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareAnalysisTests.swift#RegionChecksumsTests.testThePlatformFamilyIsReadFromTheDescriptorsStrapSection
  it("is read from the descriptor's strap section", () => {
    const descriptor = (strapWords: number) => {
      const page = new Uint8Array(0x1000);
      page.set([0x5a, 0xa5, 0xf0, 0x0f], 0x10);
      page[0x1b] = strapWords & 0xff;
      return page;
    };
    const region = new Uint8Array(64).fill(0xff);
    expect(pchStrapWords(descriptor(70))).toBe(70);

    const mobile = analyzeMeRegion({ bytes: region, descriptorBytes: descriptor(70) });
    expect(mobile.platformFamily).toBe("mobile");
    const desktop = analyzeMeRegion({ bytes: region, descriptorBytes: descriptor(101) });
    expect(desktop.platformFamily).toBe("desktop");
    const unknown = analyzeMeRegion({ bytes: region, descriptorBytes: descriptor(64) });
    expect(unknown.platformFamily).toBeUndefined();
    const none = analyzeMeRegion({ bytes: region });
    expect(none.platformFamily).toBeUndefined();
  });
});
