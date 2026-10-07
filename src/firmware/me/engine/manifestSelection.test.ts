import { describe, expect, it } from "vitest";
import { selectOperationalManifest } from "@/firmware/me/engine/manifestSelection";
import { parseFirstFpt } from "@/firmware/me/layout/fpt";
import { parseManifestCandidates } from "@/firmware/me/layout/manifest";
import { cpdDirectory, fptRegion, manifest } from "@/firmware/me/testing/testMe";

/** The bytes of each part, one after another. */
function joined(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Composition helpers: a "CPD-headed partition" is one `$CPD` header (the
 * owning directory, whose PartitionName selects it) followed by a `$MN2`
 * manifest. Positions mirror real flashes — each engine partition carries its
 * own `$CPD` + `$MN2`, and a full flash usually has one internal-volume `$FPT`
 * that names none of the CSE boot partitions.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#SelectionFixtures
 */
const SelectionFixtures = {
  /**
   * One-module R1 `$CPD` (header and entry row) — the manifest sits right after.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#SelectionFixtures.partition
   */
  partition(name: string): { data: Uint8Array; manifestBase: number } {
    const cpd = cpdDirectory({ name });
    return { data: joined(cpd, manifest()), manifestBase: cpd.length };
  },

  /**
   * A `$MN2` with no owning `$CPD` — only an `$FPT` engine partition can select
   * it (priority 1), never the CPD-name fallback (priority 2).
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#SelectionFixtures.bareManifest
   */
  bareManifest(): { data: Uint8Array; manifestBase: number } {
    return { data: manifest(), manifestBase: 0 };
  },
};

/** The manifest the analyzer would read the region as. */
function select(region: Uint8Array) {
  const chosen = selectOperationalManifest({
    candidates: parseManifestCandidates(region),
    fpt: parseFirstFpt(region),
    bytes: region,
  });
  expect(chosen).toBeDefined();
  return chosen;
}

/**
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests
 */
describe("the operational manifest", () => {
  // Priority 1: an $FPT that names the FTPR engine partition must select the
  // manifest inside it, even though that copy has NO owning $CPD (so priority 2
  // could never find it) and sits AFTER an RBEP CPD partition.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testEngineFPTJumpsToFTPRPartitionEvenWithoutOwningCPD
  it("jumps to the FTPR partition the $FPT names, owning $CPD or not", () => {
    const fptLength = 0x20 + 1 * 0x20;
    const rbe = SelectionFixtures.partition("RBEP");
    const ftpr = SelectionFixtures.bareManifest();
    const ftprStart = fptLength + rbe.data.length;
    const region = joined(
      fptRegion({ entries: [{ name: "FTPR", offset: ftprStart, size: ftpr.data.length + 0x20 }] }),
      rbe.data,
      ftpr.data
    );
    // The FTPR $FPT partition wins over the earlier RBEP copy.
    expect(select(region)?.base).toBe(ftprStart);
  });

  // Priority 2 (the real-dump case): the region's only $FPT lists internal
  // volumes (PSVN/MFS…) and contains no candidate, and there is both an RBEP
  // (earlier) and an FTPR (later) CPD-headed partition. FTPR must be chosen over
  // the RBEP recovery copy that comes first in file order.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testWholeFlashInternalFPTFallsBackToCPDOwnerRankingFTPR
  it("falls back to the $CPD owner, ranking FTPR above RBEP", () => {
    const internalFPT = fptRegion({
      entries: [
        { name: "PSVN", offset: 0x1000, size: 0x100 },
        { name: "MFS", offset: 0x2000, size: 0x64000 },
      ],
    });
    const rbe = SelectionFixtures.partition("RBEP");
    const ftpr = SelectionFixtures.partition("FTPR");
    const region = joined(internalFPT, rbe.data, ftpr.data);
    const ftprBase = internalFPT.length + rbe.data.length + ftpr.manifestBase;
    expect(select(region)?.base).toBe(ftprBase);
  });

  // CSME 18: the boot partition is renamed RBEP and no FTPR exists — the RBEP arm
  // of priority 2 must still resolve it.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testRBEPOnlyRegionChoosesRBEP
  it("chooses RBEP in a region with no FTPR", () => {
    const rbe = SelectionFixtures.partition("RBEP");
    expect(select(rbe.data)?.base).toBe(rbe.manifestBase);
  });

  // A lone non-engine partition (PMCP) has no FPT/CPD engine context — priority 3
  // returns the first (only) candidate, preserving parseFirst.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testUnknownOwnerFallsBackToFirstCandidate
  it("falls back to the first candidate for an owner it does not know", () => {
    const pmcp = SelectionFixtures.partition("PMCP");
    expect(select(pmcp.data)?.base).toBe(pmcp.manifestBase);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testEmptyRegionSelectsNothing
  it("selects nothing in an empty region", () => {
    const region = new Uint8Array(0x300).fill(0xff);
    expect(
      selectOperationalManifest({
        candidates: parseManifestCandidates(region),
        fpt: undefined,
        bytes: region,
      })
    ).toBeUndefined();
  });

  // Upstream accepts CODE only when RCVY/COD1 are absent. An FPT with a CODE
  // partition (covering the later copy) and an earlier RBEP CPD partition: CODE
  // must win (it is not the first candidate).
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testCODEPartitionAcceptedWhenNoRCVYOrCOD1
  it("accepts a CODE partition when there is no RCVY or COD1", () => {
    const fptLength = 0x20 + 1 * 0x20;
    const rbe = SelectionFixtures.partition("RBEP");
    const code = SelectionFixtures.bareManifest();
    const codeStart = fptLength + rbe.data.length;
    const region = joined(
      fptRegion({ entries: [{ name: "CODE", offset: codeStart, size: code.data.length + 0x20 }] }),
      rbe.data,
      code.data
    );
    expect(select(region)?.base).toBe(codeStart);
  });

  // Same shape but the FPT also has an RCVY partition (containing no candidate):
  // CODE is rejected, so priority 2's RBEP arm resolves.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SelectionTests.swift#ManifestSelectionTests.testCODEPartitionRejectedWhenRCVYPresent
  it("rejects a CODE partition when there is an RCVY", () => {
    const fptLength = 0x20 + 2 * 0x20;
    const rbe = SelectionFixtures.partition("RBEP");
    const code = SelectionFixtures.bareManifest();
    const rbeStart = fptLength;
    const codeStart = fptLength + rbe.data.length;
    const region = joined(
      fptRegion({
        entries: [
          { name: "RCVY", offset: rbeStart, size: 0x10 }, // an empty RCVY
          { name: "CODE", offset: codeStart, size: code.data.length + 0x20 },
        ],
      }),
      rbe.data,
      code.data
    );
    expect(select(region)?.base).toBe(rbeStart + rbe.manifestBase);
  });
});
