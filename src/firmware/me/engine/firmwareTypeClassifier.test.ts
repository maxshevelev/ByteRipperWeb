import { describe, expect, it } from "vitest";
import { tagBytes } from "@/firmware/me/bytes";
import { classifyFirmwareType, fptHeaderFIT } from "@/firmware/me/engine/firmwareTypeClassifier";
import type { FPTPartition, FPTResult } from "@/firmware/me/layout/fpt";

/**
 * The Stock / Update / Extracted port of upstream `fw_type` (MEA.py
 * 12538–12588). Fixtures are synthetic `$FPT` results built directly (not
 * decoded), so each case pins one classifier branch to the exact partition
 * inventory and region bytes that branch keys off.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests
 */

function partition(name: string, offset: number, size: number, empty = false): FPTPartition {
  return { name, offset, size, flags: 0, empty };
}

function fpt(
  partitions: readonly FPTPartition[],
  fit: {
    readonly build?: number;
    readonly major?: number;
    readonly minor?: number;
    readonly hotfix?: number;
  } = {},
  fptStart = 0
): FPTResult {
  return {
    headerVersion: 0x20,
    resolvedVersion: 0x20,
    fptStart,
    fitMajor: fit.major ?? 0,
    fitMinor: fit.minor ?? 0,
    fitHotfix: fit.hotfix ?? 0,
    fitBuild: fit.build ?? 0,
    partitions,
    cseLayout: undefined,
  };
}

/**
 * A not-erased region: 0x00 fill, so the erased-window checks upstream uses to
 * spot placeholders and ROM-Bypass vectors read *not* erased.
 */
const liveRegion = (size = 0x4000) => new Uint8Array(size);

describe("the firmware type", () => {
  describe("the axis", () => {
    // An IFWI image is always Extracted (12541–12547), whatever its `$FPT`.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testIFWIIsExtracted
    it("makes an IFWI image extracted", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 15,
        isIFWI: true,
        fpt: fpt([partition("FTPR", 0x1000, 0x1000)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("extracted");
    });

    // No `$FPT` region at all → upstream's final Update (12588).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testNoRegionIsUpdate
    it("makes an image with no region an update", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 12,
        isIFWI: false,
        fpt: undefined,
        bytes: liveRegion(),
      });
      expect(type).toBe("update");
    });

    // SPS 1–3 are hand-built, never flashed with the FIT → Extracted (12548).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testSPSIsExtracted
    it("makes SPS extracted", () => {
      const type = classifyFirmwareType({
        family: "sps",
        major: 3,
        isIFWI: false,
        fpt: fpt([partition("SPS0", 0x1000, 0x1000)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("extracted");
    });

    // A non-IFWI independent family does not sit on this axis → Unknown.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testIndependentFamilyIsUnknown
    it("leaves an independent family unknown", () => {
      const type = classifyFirmwareType({
        family: "pmc",
        major: 1,
        isIFWI: false,
        fpt: fpt([partition("PMCP", 0x1000, 0x1000)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("unknown");
    });
  });

  describe("ME 2–7", () => {
    // A dirty FOVD (ME 3+) marks an Extracted image before anything else.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testME2to7DirtyFOVDIsExtracted
    it("makes a dirty FOVD extracted", () => {
      const type = classifyFirmwareType({
        family: "me",
        major: 5,
        isIFWI: false,
        fpt: fpt([partition("FOVD", 0x1000, 0x1000)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("extracted");
    });

    // Clean FOVD and no `KRND\x00` string → a stock pre-CSE ME (12558).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testME2to7CleanNoKRNDIsStock
    it("makes a clean FOVD with no KRND stock", () => {
      const type = classifyFirmwareType({
        family: "me",
        major: 5,
        isIFWI: false,
        fpt: fpt([partition("FOVD", 0x1000, 0x1000, true)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("stock");
    });

    // A `KRND\x00` string anywhere marks an Extracted image (12556).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testME2to7KRNDStringIsExtracted
    it("makes a KRND string extracted", () => {
      const region = liveRegion();
      region.set(tagBytes("KRND\0"), 0x200);
      const type = classifyFirmwareType({
        family: "me",
        major: 6,
        isIFWI: false,
        fpt: fpt([partition("FOVD", 0x1000, 0x1000, true)]),
        bytes: region,
      });
      expect(type).toBe("extracted");
    });
  });

  describe("CSME-like (ME 8+, CSME, CSTXE, CSSPS, TXE, GSC)", () => {
    // An Update image's `$FPT` lists exactly the non-empty FTPR/FTUP/NFTP trio
    // (12564) — checked before any FIT reading, so even a no-FIT header is Update.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testExactlyFTUPTrioIsUpdate
    it("makes exactly the update trio an update", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 12,
        isIFWI: false,
        fpt: fpt([
          partition("FTPR", 0x1000, 0x1000),
          partition("FTUP", 0x2000, 0x1000),
          partition("NFTP", 0x3000, 0x1000),
        ]),
        bytes: liveRegion(),
      });
      expect(type).toBe("update");
    });

    // A clean stock (CS)ME `$FPT` carries the no-FIT build marker and no dirty
    // FOVD → Stock (12567/12577).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testCleanStockMarkerFITIsStock
    it("makes a clean table with the no-FIT marker stock", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 11,
        isIFWI: false,
        fpt: fpt([partition("FTPR", 0x1000, 0x1000), partition("FOVD", 0x2000, 0x1000, true)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("stock");
    });

    // A real FIT build in the header means the image was built with the Flash
    // Image Tool → Extracted (12581–12586), whatever the partition inventory.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testRealFITIsExtracted
    it("makes a real FIT build extracted", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 12,
        isIFWI: false,
        fpt: fpt([partition("FTPR", 0x1000, 0x1000)], { build: 1091 }),
        bytes: liveRegion(),
      });
      expect(type).toBe("extracted");
    });

    // CSME 13+ Update images carry placeholder `$FPT` ROM-Bypass vectors: the
    // 0x10 erased window before the marker. The tail window (which would trigger
    // the CSTXE placeholder branch) stays live, isolating the CSME 13 leg (12578).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testCSME13ErasedHeaderVectorsIsExtracted
    it("makes CSME 13 erased header vectors extracted", () => {
      const region = new Uint8Array(0x4000).fill(0xff);
      region.fill(0x00, 0x10, 0x20);
      const type = classifyFirmwareType({
        family: "csme",
        major: 13,
        isIFWI: false,
        fpt: fpt([partition("FTPR", 0x1000, 0x1000)], {}, 0),
        bytes: region,
      });
      expect(type).toBe("extracted");
    });

    // A dirty FOVD overrides even a no-FIT stock-looking header → Extracted (12576).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testDirtyFOVDBeatsStockMarker
    it("lets a dirty FOVD beat the stock marker", () => {
      const type = classifyFirmwareType({
        family: "csme",
        major: 12,
        isIFWI: false,
        fpt: fpt([partition("FOVD", 0x1000, 0x1000)]),
        bytes: liveRegion(),
      });
      expect(type).toBe("extracted");
    });
  });

  describe("row 19's non-IFWI gate", () => {
    /** The type and the header FIT row 19 would show, for one image. */
    function classify(
      family: Parameters<typeof classifyFirmwareType>[0]["family"],
      major: number,
      table: FPTResult,
      isIFWI = false
    ) {
      const type = classifyFirmwareType({ family, major, isIFWI, fpt: table, bytes: liveRegion() });
      return { type, fit: fptHeaderFIT({ family, major, type, fpt: table, isIFWI }) };
    }

    // The row-19 value of a non-IFWI CSE image whose `$FPT` header carries a real
    // FIT — the branch upstream resolves to Extracted *by* (12581–12586) — is that FIT.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testRealFITHeadersSurfaceOnNonIFWIImage
    it("surfaces a real header FIT on a non-IFWI image", () => {
      const table = fpt([partition("FTPR", 0x1000, 0x1000)], {
        build: 1002,
        major: 11,
        minor: 0,
        hotfix: 10,
      });
      expect(classify("csme", 11, table).fit).toEqual({
        major: 11,
        minor: 0,
        hotfix: 10,
        build: 1002,
      });
    });

    // An Update image — exactly the FTPR/FTUP/NFTP trio — is Update even with a
    // real-looking header FIT, and that FIT is *not* surfaced: Check 1 wins
    // before the FIT read (12564).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testUpdateTrioHeaderFITIsNotSurfaced
    it("does not surface an update trio's header FIT", () => {
      const table = fpt(
        [
          partition("FTPR", 0x1000, 0x1000),
          partition("FTUP", 0x2000, 0x1000),
          partition("NFTP", 0x3000, 0x1000),
        ],
        { build: 1091 }
      );
      const { type, fit } = classify("csme", 12, table);
      expect(type).toBe("update");
      expect(fit).toBeUndefined();
    });

    // An IFWI image's row 19 comes from each boot BPDT, never the `$FPT` header.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testIFWIHeaderFITIsNotSurfaced
    it("does not surface an IFWI image's header FIT", () => {
      const { type, fit } = classify(
        "csme",
        12,
        fpt([partition("FTPR", 0x1000, 0x1000)], { build: 1091 }),
        true
      );
      expect(type).toBe("extracted");
      expect(fit).toBeUndefined();
    });

    // SPS 1–3 are hand-built → Extracted without ever printing a FIT (12548).
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testSPSHeaderFITIsNotSurfaced
    it("does not surface SPS's header FIT", () => {
      const { type, fit } = classify(
        "sps",
        3,
        fpt([partition("SPS0", 0x1000, 0x1000)], { build: 1091 })
      );
      expect(type).toBe("extracted");
      expect(fit).toBeUndefined();
    });

    // ME 2–7 sits on the older FOVD/KRND axis, never the real-FIT row 19.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testME2to7HeaderFITIsNotSurfaced
    it("does not surface ME 2–7's header FIT", () => {
      const { type, fit } = classify(
        "me",
        5,
        fpt([partition("FOVD", 0x1000, 0x1000)], { build: 1091 })
      );
      expect(type).toBe("extracted");
      expect(fit).toBeUndefined();
    });

    // The marker-FIT Extracted legs — dirty FOVD over a marker build — stay
    // FIT-less: row 19 needs a real FIT, which a 0/0xFFFF build never is.
    // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareTypeClassifierTests.swift#FirmwareTypeClassifierTests.testMarkerFITExtractedLegHasNoRow19FIT
    it("leaves a marker-FIT extracted leg without a row-19 FIT", () => {
      const { type, fit } = classify(
        "csme",
        12,
        fpt([partition("FOVD", 0x1000, 0x1000)], { build: 0 })
      );
      expect(type).toBe("extracted");
      expect(fit).toBeUndefined();
    });
  });
});
