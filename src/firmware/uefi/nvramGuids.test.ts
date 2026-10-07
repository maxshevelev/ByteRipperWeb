import { describe, expect, it } from "vitest";
import { guid, guidText } from "@/firmware/uefi/efiGuid";
import * as N from "@/firmware/uefi/nvramGuids";

/**
 * The NVRAM GUID classifier the volume parser reads. These pin the table: a GUID
 * that stops matching its canonical string is a regeneration that drifted from
 * `common/nvram.cpp`, and a classifier that answers wrong routes a store to the
 * wrong parser.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests
 */
describe("NVRAM GUIDs", () => {
  const stranger = guid("11111111-2222-3333-4444-555555555555");

  // Every constant equals the canonical GUID string in `common/nvram.h`. This is
  // the whole of the drift guard: a byte that changes upstream changes the
  // string, and the test fails.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testEveryConstantMatchesItsCanonicalGuid
  it("matches every constant to its canonical GUID", () => {
    expect(guidText(N.edkiiWorkingBlockSignatureGuid)).toBe("9E58292B-7C68-497D-0ACE-6500FD9F1B95");
    expect(guidText(N.ffsPhoenixRawSectionEvsaGuid)).toBe("DAB78572-E8D1-4C3F-9A1E-F27E9CAF686D");
    expect(guidText(N.nvramAdditionalStoreVolumeGuid)).toBe("00504624-8A59-4EEB-BD0F-6B36E96128E0");
    expect(guidText(N.nvramFdcStoreGuid)).toBe("DDCF3616-3275-4164-98B6-FE85707FFE7D");
    expect(guidText(N.nvramMainStoreVolumeGuid)).toBe("FFF12B8D-7696-4C8B-A985-2747075B4F50");
    expect(guidText(N.nvramNvarBbDefaultsFileGuid)).toBe("AF516361-B4C5-436E-A7E3-A149A31B1461");
    expect(guidText(N.nvramNvarExternalDefaultsFileGuid)).toBe(
      "9221315B-30BB-46B5-813E-1B1BF4712BD3"
    );
    expect(guidText(N.nvramNvarPeiExternalDefaultsFileGuid)).toBe(
      "77D3DC50-D42B-4916-AC80-8F469035D150"
    );
    expect(guidText(N.nvramNvarStoreFileGuid)).toBe("CEF5B9A3-476D-497F-9FDC-E98143E0422C");
    expect(guidText(N.nvramPhoenixFlashMapCmdbGuid)).toBe("46310243-7B03-4132-BE44-2243FACA7CDD");
    expect(guidText(N.nvramPhoenixFlashMapEvsa1Guid)).toBe("FACFB110-7BFD-4EFB-873E-88B6B23B97EA");
    expect(guidText(N.nvramPhoenixFlashMapEvsa2Guid)).toBe("E68DC11A-A5F4-4AC3-AA2E-29E298BFF645");
    expect(guidText(N.nvramPhoenixFlashMapEvsa3Guid)).toBe("4B3828AE-0ACE-45B6-8CDB-DAFC28BBF8C5");
    expect(guidText(N.nvramPhoenixFlashMapEvsa4Guid)).toBe("C22E6B8A-8159-49A3-B353-E84B79DF19C0");
    expect(guidText(N.nvramPhoenixFlashMapEvsa5Guid)).toBe("B6B5FAB9-75C4-4AAE-8314-7FFFA7156EAA");
    expect(guidText(N.nvramPhoenixFlashMapEvsa6Guid)).toBe("919B9699-8DD0-4376-AA0B-0E54CCA47D8F");
    expect(guidText(N.nvramPhoenixFlashMapEvsa7Guid)).toBe("58A90A52-929F-44F8-AC35-A7E1AB18AC91");
    expect(guidText(N.nvramPhoenixFlashMapMarker1Guid)).toBe(
      "127C1C4E-9135-46E3-B006-F9808B0559A5"
    );
    expect(guidText(N.nvramPhoenixFlashMapMarker2Guid)).toBe(
      "071A3DBE-CFF4-4B73-83F0-598C13DCFDD5"
    );
    expect(guidText(N.nvramPhoenixFlashMapMicrocodesGuid)).toBe(
      "FD3F690E-B4B0-4D68-89DB-19A1A3318F90"
    );
    expect(guidText(N.nvramPhoenixFlashMapPubkey1Guid)).toBe(
      "1B2C4952-D778-4B64-BDA1-15A36F5FA545"
    );
    expect(guidText(N.nvramPhoenixFlashMapPubkey2Guid)).toBe(
      "7CE75114-8272-45AF-B536-761BD38852CE"
    );
    expect(guidText(N.nvramPhoenixFlashMapSelfGuid)).toBe("8CB71915-531F-4AF5-82BF-A09140817BAA");
    expect(guidText(N.nvramPhoenixFlashMapVolumeHeader)).toBe(
      "B091E7D2-05A0-4198-94F0-74B7B8C55459"
    );
    expect(guidText(N.nvramVss2AuthVarKeyDatabaseGuid)).toBe(
      "AAF32C78-947B-439A-A180-2E144EC37792"
    );
    expect(guidText(N.nvramVss2StoreGuid)).toBe("DDCF3617-3275-4164-98B6-FE85707FFE7D");
    expect(guidText(N.vss2WorkingBlockSignatureGuid)).toBe("9E58292B-7C68-497D-A0CE-6500FD9F1B95");
  });

  // The table holds exactly the 27 GUIDs the source names — a count that drifts
  // means a GUID was added, dropped, or mis-parsed.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testTheTableHoldsEveryNamedGuid
  it("holds every named GUID", () => {
    expect(N.NVRAM_NAMES.size).toBe(27);
  });

  // The two file-system GUIDs whose volume body is an NVRAM store.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testIsStoreVolumeAnswersForTheTwoStoreGuids
  it("says which volumes are stores", () => {
    expect(N.isStoreVolume(N.nvramMainStoreVolumeGuid)).toBe(true);
    expect(N.isStoreVolume(N.nvramAdditionalStoreVolumeGuid)).toBe(true);
    // A VSS2 store GUID is not a file-system GUID; it opens a store inside one.
    expect(N.isStoreVolume(N.nvramVss2StoreGuid)).toBe(false);
    expect(N.isStoreVolume(stranger)).toBe(false);
  });

  // A VSS2 store is opened by its store GUID, the FDC variant, or the auth key
  // database.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testIsVss2StoreAnswersForTheVss2Guids
  it("says which GUIDs open a VSS2 store", () => {
    expect(N.isVss2Store(N.nvramVss2StoreGuid)).toBe(true);
    expect(N.isVss2Store(N.nvramFdcStoreGuid)).toBe(true);
    expect(N.isVss2Store(N.nvramVss2AuthVarKeyDatabaseGuid)).toBe(true);
    expect(N.isVss2Store(N.nvramMainStoreVolumeGuid)).toBe(false);
  });

  // An FTW working block is opened by the EDKII or VSS2 signature GUID — or by
  // the main store's own GUID, which doubles as the signature of the block that
  // protects it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testIsFtwStoreAnswersForTheWorkingBlockGuids
  it("says which GUIDs open a working block", () => {
    expect(N.isFtwStore(N.edkiiWorkingBlockSignatureGuid)).toBe(true);
    expect(N.isFtwStore(N.vss2WorkingBlockSignatureGuid)).toBe(true);
    expect(N.isFtwStore(N.nvramMainStoreVolumeGuid)).toBe(true);
    expect(N.isFtwStore(N.nvramVss2StoreGuid)).toBe(false);
  });

  // The word a GUID-identity NVRAM node shows while the catalogue has no name.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramGuidsTests.swift#NvramGuidsTests.testNameAnswersForAGuidAndNilForOneItDoesNotKnow
  it("names a GUID it knows, and no other", () => {
    expect(N.nvramGuidName(N.nvramMainStoreVolumeGuid)).toBe("NVRAM main store volume");
    expect(N.nvramGuidName(N.nvramVss2StoreGuid)).toBe("NVRAM VSS2 store");
    expect(N.nvramGuidName(stranger)).toBeUndefined();
  });
});
