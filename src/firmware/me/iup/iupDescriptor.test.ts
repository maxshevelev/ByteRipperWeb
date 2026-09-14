import { describe, expect, it } from "vitest";
import { iupFacts } from "@/firmware/me/iup/iupDescriptor";
import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/**
 * The independent firmware's descriptor facts. Ported from upstream's
 * `IUPDescriptorTests`; the TGP rows are what MEA prints for the three IUP
 * partitions of a real CSME 15 dump.
 */

const facts = (family: FirmwareFamily, variant: string, major: number, minor = 0, hotfix = 0) =>
  iupFacts({ family, variant, major, minor, hotfix });

describe("the real dump's partitions", () => {
  it("reads PMC 150.2.10.1015 as TGP, SKU H, stepping B", () => {
    expect(facts("pmc", "PMCTGP", 150, 2, 10)).toEqual({
      platform: "TGP",
      sku: "H",
      chipsetStepping: "B",
    });
  });

  it("reads PCHC 15.0.0.1020 as TGP alone", () => {
    expect(facts("pchc", "PCHCTGP", 15)).toEqual({
      platform: "TGP",
      sku: undefined,
      chipsetStepping: undefined,
    });
  });

  it("reads PHY 15.105.135.5012 as TGP, SKU N", () => {
    expect(facts("phy", "PHYNTGP", 15)).toEqual({
      platform: "TGP",
      sku: "N",
      chipsetStepping: undefined,
    });
  });
});

describe("the PMC branches", () => {
  it("takes the SKU from the minor", () => {
    expect(facts("pmc", "PMCICP", 130, 1)?.sku).toBe("LP");
    expect(facts("pmc", "PMCLKF", 140, 2)?.sku).toBe("H");
    expect(facts("pmc", "PMCJSP", 130, 3)?.sku).toBe("N");
    expect(facts("pmc", "PMCTGP", 150, 9)?.sku).toBeUndefined();
  });

  it("takes the platform from the token's suffix", () => {
    expect(facts("pmc", "PMCICP", 130)?.platform).toBe("ICP");
    expect(facts("pmc", "PMCLKF", 140)?.platform).toBe("LKF");
    expect(facts("pmc", "PMCJSP", 130)?.platform).toBe("JSP");
  });

  it("names CMP-V", () => {
    const one = facts("pmc", "PMCCMPV", 145);
    expect(one?.platform).toBe("CMP-V");
    expect(one?.sku).toBe("V");
  });

  it("names WTL", () => {
    expect(facts("pmc", "PMCWTL", 150, 0, 30)).toEqual({
      platform: "WTL",
      sku: "H",
      chipsetStepping: "B",
    });
  });

  it("reads APL, BXT and GLK from the token", () => {
    expect(facts("pmc", "PMCAPLP", 130)).toEqual({
      platform: "APL",
      sku: undefined,
      chipsetStepping: "P",
    });
    expect(facts("pmc", "PMCBXT", 130)).toEqual({
      platform: "BXT",
      sku: undefined,
      chipsetStepping: "T",
    });
  });

  it("takes the stepping from the hotfix, clamped to P", () => {
    expect(facts("pmc", "PMCTGP", 150, 0, 30)?.chipsetStepping).toBe("D");
    expect(facts("pmc", "PMCTGP", 150, 0, 5)?.chipsetStepping).toBe("A");
    expect(facts("pmc", "PMCTGP", 150, 0, 200)?.chipsetStepping).toBe("P");
  });
});

describe("gating", () => {
  it("answers nothing for a non-IUP family", () => {
    expect(facts("csme", "CSME", 15, 0, 30)).toBeUndefined();
    expect(facts("unknown", "PMC", 150, 0, 10)).toBeUndefined();
  });

  it("answers nothing for an unknown or short token", () => {
    expect(facts("pmc", "Unknown", 150)).toBeUndefined();
    expect(facts("pchc", "PC", 15)).toBeUndefined();
    expect(facts("phy", "PHY", 15)).toBeUndefined();
  });

  it("names a PCHC CMP-V", () => {
    expect(facts("pchc", "PCHCCMPV", 15)?.platform).toBe("CMP-V");
  });

  it("gives a DG PHY the SKU G", () => {
    const one = facts("phy", "PHYDG1", 15);
    expect(one?.sku).toBe("G");
    expect(one?.platform).toBe("DG1");
  });
});
