import { describe, expect, it } from "vitest";
import { fwUpdateSupport, iupPresence } from "@/firmware/me/engine/fwUpdateSupport";
import type { FirmwareEndLayout } from "@/firmware/me/layout/firmwareEnd";
import type { FPTPartition } from "@/firmware/me/layout/fpt";
import type { FirmwareFamily, FirmwareType } from "@/firmware/me/models/firmwareFacts";

/**
 * Row 15: whether FWUpdate can rewrite the image in place. Ported from
 * upstream's `FWUpdateSupportTests`.
 */

const layout = (
  options: { uncharted?: boolean; probeHit?: boolean; alignment?: number } = {}
): FirmwareEndLayout => ({
  firmwareSize: 0x1000,
  hasUnchartedPartition: options.uncharted ?? true,
  unchartedProbeHit: options.probeHit ?? false,
  alignmentPresent: options.alignment ?? 0,
});

function result(
  major: number,
  minor: number,
  options: {
    sku?: string;
    type?: FirmwareType;
    pmc?: boolean;
    pchc?: boolean;
    phy?: boolean;
    family?: FirmwareFamily;
    layout?: FirmwareEndLayout;
    fptStart?: number;
  } = {}
) {
  return fwUpdateSupport({
    family: options.family ?? "csme",
    major,
    minor,
    type: options.type ?? "extracted",
    sku: options.sku ?? "Consumer H",
    iup: { pmc: options.pmc ?? false, pchc: options.pchc ?? false, phy: options.phy ?? false },
    layout: options.layout ?? layout(),
    fptStart: options.fptStart ?? 0x1000,
  });
}

describe("fwUpdateSupport", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testOnlyCSME12AndNewerGetAnAnswer
  it("answers CSME 12 and newer, and no one else", () => {
    expect(result(11, 8)).toBeUndefined();
    expect(result(12, 0, { family: "cssps" })).toBeUndefined();
    expect(result(7, 1, { family: "me" })).toBeUndefined();
    expect(result(12, 0)).toBeDefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testCSME12NeedsThePMCOnly
  it("asks CSME 12 for the PMC alone", () => {
    expect(result(12, 0, { pmc: true })).toBe("yes");
    expect(result(12, 0)).toBe("no");
    expect(result(12, 0, { pmc: true, pchc: true, phy: true })).toBe("yes");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testThePerPlatformRequirements
  it("follows the per-platform requirements", () => {
    for (const [major, minor] of [
      [13, 0],
      [13, 50],
      [14, 0],
      [14, 5],
      [15, 40],
      [16, 0],
    ] as const) {
      expect(result(major, minor, { pmc: true, pchc: true })).toBe("yes");
      expect(result(major, minor, { pmc: true })).toBe("no");
    }
    for (const [major, minor] of [
      [13, 30],
      [14, 1],
    ] as const) {
      expect(result(major, minor, { pmc: true, pchc: true, phy: true })).toBe("yes");
      expect(result(major, minor, { pmc: true, pchc: true })).toBe("no");
    }
    // A version outside the table asks for all three.
    expect(result(16, 1, { pmc: true, pchc: true })).toBe("no");
    expect(result(16, 1, { pmc: true, pchc: true, phy: true })).toBe("yes");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testTheTigerPointSplitOnTheSKU
  it("splits Tiger Point on the SKU", () => {
    expect(result(15, 0, { sku: "Consumer LP", pmc: true, pchc: true })).toBe("yes");
    expect(result(15, 0, { sku: "Consumer H", pmc: true, pchc: true })).toBe("no");
    expect(result(15, 0, { sku: "Consumer H", pmc: true, pchc: true, phy: true })).toBe("yes");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testImpossibleForACorporateExtractedImageWithNothingUncharted
  it("calls a Corporate extracted image with nothing uncharted impossible", () => {
    expect(
      result(12, 0, { sku: "Corporate H", pmc: true, layout: layout({ uncharted: false }) })
    ).toBe("impossible");
    expect(
      result(12, 0, {
        sku: "Corporate H",
        pmc: true,
        layout: layout({ uncharted: true, probeHit: true }),
      })
    ).toBe("impossible");
    expect(
      result(12, 0, { sku: "Consumer H", pmc: true, layout: layout({ uncharted: false }) })
    ).toBe("yes");
    expect(
      result(12, 0, {
        sku: "Corporate H",
        type: "stock",
        pmc: true,
        layout: layout({ uncharted: false }),
      })
    ).toBe("yes");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testImpossibleForAPaddedCSME16AtOffsetZero
  it("calls a padded CSME 16 at offset zero impossible", () => {
    expect(
      result(16, 0, { pmc: true, pchc: true, layout: layout({ alignment: 0x800 }), fptStart: 0 })
    ).toBe("impossible");
    expect(
      result(16, 0, {
        pmc: true,
        pchc: true,
        layout: layout({ alignment: 0x800 }),
        fptStart: 0x1000,
      })
    ).toBe("yes");
    expect(
      result(16, 0, { pmc: true, pchc: true, layout: layout({ alignment: 0 }), fptStart: 0 })
    ).toBe("yes");
  });
});

describe("iupPresence", () => {
  const part = (name: string, empty = false): FPTPartition => ({
    name,
    offset: 0x1000,
    size: 0x1000,
    flags: 0,
    empty,
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FWUpdateSupportTests.swift#FWUpdateSupportTests.testThePresenceFlagsReadTheFPTInventory
  it("reads every name each kind goes by, and never an empty one", () => {
    expect(iupPresence([part("FTPR"), part("PCOD"), part("PCHC"), part("SPHY")])).toEqual({
      pmc: true,
      pchc: true,
      phy: true,
    });
    expect(iupPresence([part("PMCP", true), part("PCHC", true)])).toEqual({
      pmc: false,
      pchc: false,
      phy: false,
    });
  });
});
