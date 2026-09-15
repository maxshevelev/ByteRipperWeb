import { type EFIGUID, guid, guidEquals, guidKey } from "@/firmware/uefi/efiGuid";

/**
 * The NVRAM GUIDs UEFITool names in `common/nvram.h`, and what they mean.
 *
 * GENERATED from that header by way of upstream's own `NvramGuids.swift`. The
 * NVRAM volume parser classifies a store by its GUID — which file-system GUID
 * is an NVRAM store, which GUID opens a VSS2 or FTW store — and the tree names
 * a GUID-identity node from here while the downloaded catalogue has no name for
 * it. Do not edit by hand: the next regeneration overwrites it.
 */

/**
 * EDKII_WORKING_BLOCK_SIGNATURE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.edkiiWorkingBlockSignatureGuid
 */
export const edkiiWorkingBlockSignatureGuid = guid("9E58292B-7C68-497D-0ACE-6500FD9F1B95");

/**
 * FFS_PHOENIX_RAW_SECTION_EVSA_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.ffsPhoenixRawSectionEvsaGuid
 */
export const ffsPhoenixRawSectionEvsaGuid = guid("DAB78572-E8D1-4C3F-9A1E-F27E9CAF686D");

/**
 * NVRAM_ADDITIONAL_STORE_VOLUME_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramAdditionalStoreVolumeGuid
 */
export const nvramAdditionalStoreVolumeGuid = guid("00504624-8A59-4EEB-BD0F-6B36E96128E0");

/**
 * NVRAM_FDC_STORE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramFdcStoreGuid
 */
export const nvramFdcStoreGuid = guid("DDCF3616-3275-4164-98B6-FE85707FFE7D");

/**
 * NVRAM_MAIN_STORE_VOLUME_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramMainStoreVolumeGuid
 */
export const nvramMainStoreVolumeGuid = guid("FFF12B8D-7696-4C8B-A985-2747075B4F50");

/**
 * NVRAM_NVAR_BB_DEFAULTS_FILE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramNvarBbDefaultsFileGuid
 */
export const nvramNvarBbDefaultsFileGuid = guid("AF516361-B4C5-436E-A7E3-A149A31B1461");

/**
 * NVRAM_NVAR_EXTERNAL_DEFAULTS_FILE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramNvarExternalDefaultsFileGuid
 */
export const nvramNvarExternalDefaultsFileGuid = guid("9221315B-30BB-46B5-813E-1B1BF4712BD3");

/**
 * NVRAM_NVAR_PEI_EXTERNAL_DEFAULTS_FILE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramNvarPeiExternalDefaultsFileGuid
 */
export const nvramNvarPeiExternalDefaultsFileGuid = guid("77D3DC50-D42B-4916-AC80-8F469035D150");

/**
 * NVRAM_NVAR_STORE_FILE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramNvarStoreFileGuid
 */
export const nvramNvarStoreFileGuid = guid("CEF5B9A3-476D-497F-9FDC-E98143E0422C");

/**
 * NVRAM_PHOENIX_FLASH_MAP_CMDB_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapCmdbGuid
 */
export const nvramPhoenixFlashMapCmdbGuid = guid("46310243-7B03-4132-BE44-2243FACA7CDD");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA1_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa1Guid
 */
export const nvramPhoenixFlashMapEvsa1Guid = guid("FACFB110-7BFD-4EFB-873E-88B6B23B97EA");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA2_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa2Guid
 */
export const nvramPhoenixFlashMapEvsa2Guid = guid("E68DC11A-A5F4-4AC3-AA2E-29E298BFF645");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA3_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa3Guid
 */
export const nvramPhoenixFlashMapEvsa3Guid = guid("4B3828AE-0ACE-45B6-8CDB-DAFC28BBF8C5");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA4_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa4Guid
 */
export const nvramPhoenixFlashMapEvsa4Guid = guid("C22E6B8A-8159-49A3-B353-E84B79DF19C0");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA5_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa5Guid
 */
export const nvramPhoenixFlashMapEvsa5Guid = guid("B6B5FAB9-75C4-4AAE-8314-7FFFA7156EAA");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA6_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa6Guid
 */
export const nvramPhoenixFlashMapEvsa6Guid = guid("919B9699-8DD0-4376-AA0B-0E54CCA47D8F");

/**
 * NVRAM_PHOENIX_FLASH_MAP_EVSA7_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapEvsa7Guid
 */
export const nvramPhoenixFlashMapEvsa7Guid = guid("58A90A52-929F-44F8-AC35-A7E1AB18AC91");

/**
 * NVRAM_PHOENIX_FLASH_MAP_MARKER1_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapMarker1Guid
 */
export const nvramPhoenixFlashMapMarker1Guid = guid("127C1C4E-9135-46E3-B006-F9808B0559A5");

/**
 * NVRAM_PHOENIX_FLASH_MAP_MARKER2_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapMarker2Guid
 */
export const nvramPhoenixFlashMapMarker2Guid = guid("071A3DBE-CFF4-4B73-83F0-598C13DCFDD5");

/**
 * NVRAM_PHOENIX_FLASH_MAP_MICROCODES_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapMicrocodesGuid
 */
export const nvramPhoenixFlashMapMicrocodesGuid = guid("FD3F690E-B4B0-4D68-89DB-19A1A3318F90");

/**
 * NVRAM_PHOENIX_FLASH_MAP_PUBKEY1_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapPubkey1Guid
 */
export const nvramPhoenixFlashMapPubkey1Guid = guid("1B2C4952-D778-4B64-BDA1-15A36F5FA545");

/**
 * NVRAM_PHOENIX_FLASH_MAP_PUBKEY2_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapPubkey2Guid
 */
export const nvramPhoenixFlashMapPubkey2Guid = guid("7CE75114-8272-45AF-B536-761BD38852CE");

/**
 * NVRAM_PHOENIX_FLASH_MAP_SELF_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapSelfGuid
 */
export const nvramPhoenixFlashMapSelfGuid = guid("8CB71915-531F-4AF5-82BF-A09140817BAA");

/**
 * NVRAM_PHOENIX_FLASH_MAP_VOLUME_HEADER.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramPhoenixFlashMapVolumeHeader
 */
export const nvramPhoenixFlashMapVolumeHeader = guid("B091E7D2-05A0-4198-94F0-74B7B8C55459");

/**
 * NVRAM_VSS2_AUTH_VAR_KEY_DATABASE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramVss2AuthVarKeyDatabaseGuid
 */
export const nvramVss2AuthVarKeyDatabaseGuid = guid("AAF32C78-947B-439A-A180-2E144EC37792");

/**
 * NVRAM_VSS2_STORE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.nvramVss2StoreGuid
 */
export const nvramVss2StoreGuid = guid("DDCF3617-3275-4164-98B6-FE85707FFE7D");

/**
 * VSS2_WORKING_BLOCK_SIGNATURE_GUID.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.vss2WorkingBlockSignatureGuid
 */
export const vss2WorkingBlockSignatureGuid = guid("9E58292B-7C68-497D-A0CE-6500FD9F1B95");

/**
 * The word to show for a GUID-identity NVRAM node, when the downloaded
 * catalogue has no name for it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.names
 */
const NVRAM_NAMES = new Map<string, string>([
  [guidKey(edkiiWorkingBlockSignatureGuid), "EDKII working block"],
  [guidKey(ffsPhoenixRawSectionEvsaGuid), "FFS PHOENIX raw section EVSA"],
  [guidKey(nvramAdditionalStoreVolumeGuid), "NVRAM additional store volume"],
  [guidKey(nvramFdcStoreGuid), "NVRAM FDC store"],
  [guidKey(nvramMainStoreVolumeGuid), "NVRAM main store volume"],
  [guidKey(nvramNvarBbDefaultsFileGuid), "NVRAM NVAR BB defaults file"],
  [guidKey(nvramNvarExternalDefaultsFileGuid), "NVRAM NVAR external defaults file"],
  [guidKey(nvramNvarPeiExternalDefaultsFileGuid), "NVRAM NVAR PEI external defaults file"],
  [guidKey(nvramNvarStoreFileGuid), "NVRAM NVAR store file"],
  [guidKey(nvramPhoenixFlashMapCmdbGuid), "NVRAM PHOENIX flash map CMDB"],
  [guidKey(nvramPhoenixFlashMapEvsa1Guid), "NVRAM PHOENIX flash map evsa1"],
  [guidKey(nvramPhoenixFlashMapEvsa2Guid), "NVRAM PHOENIX flash map evsa2"],
  [guidKey(nvramPhoenixFlashMapEvsa3Guid), "NVRAM PHOENIX flash map evsa3"],
  [guidKey(nvramPhoenixFlashMapEvsa4Guid), "NVRAM PHOENIX flash map evsa4"],
  [guidKey(nvramPhoenixFlashMapEvsa5Guid), "NVRAM PHOENIX flash map evsa5"],
  [guidKey(nvramPhoenixFlashMapEvsa6Guid), "NVRAM PHOENIX flash map evsa6"],
  [guidKey(nvramPhoenixFlashMapEvsa7Guid), "NVRAM PHOENIX flash map evsa7"],
  [guidKey(nvramPhoenixFlashMapMarker1Guid), "NVRAM PHOENIX flash map marker1"],
  [guidKey(nvramPhoenixFlashMapMarker2Guid), "NVRAM PHOENIX flash map marker2"],
  [guidKey(nvramPhoenixFlashMapMicrocodesGuid), "NVRAM PHOENIX flash map microcodes"],
  [guidKey(nvramPhoenixFlashMapPubkey1Guid), "NVRAM PHOENIX flash map pubkey1"],
  [guidKey(nvramPhoenixFlashMapPubkey2Guid), "NVRAM PHOENIX flash map pubkey2"],
  [guidKey(nvramPhoenixFlashMapSelfGuid), "NVRAM PHOENIX flash map self"],
  [guidKey(nvramPhoenixFlashMapVolumeHeader), "NVRAM PHOENIX flash map volume header"],
  [guidKey(nvramVss2AuthVarKeyDatabaseGuid), "NVRAM VSS2 auth VAR KEY database"],
  [guidKey(nvramVss2StoreGuid), "NVRAM VSS2 store"],
  [guidKey(vss2WorkingBlockSignatureGuid), "VSS2 working block"],
]);

/**
 * The word for a GUID, or nothing when it is not one of these.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.name
 */
export function nvramGuidName(candidate: EFIGUID): string | undefined {
  return NVRAM_NAMES.get(guidKey(candidate));
}

/**
 * The two file-system GUIDs whose volume body is an NVRAM store.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.isStoreVolume
 */
export function isStoreVolume(candidate: EFIGUID): boolean {
  return (
    guidEquals(candidate, nvramMainStoreVolumeGuid) ||
    guidEquals(candidate, nvramAdditionalStoreVolumeGuid)
  );
}

/**
 * A VSS2 store, by the store GUID that leads its 24-byte header.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.isVss2Store
 */
export function isVss2Store(candidate: EFIGUID): boolean {
  return (
    guidEquals(candidate, nvramVss2StoreGuid) ||
    guidEquals(candidate, nvramFdcStoreGuid) ||
    guidEquals(candidate, nvramVss2AuthVarKeyDatabaseGuid)
  );
}

/**
 * An FTW working block, by the signature GUID that leads its header. The main
 * store's own GUID doubles as the FTW signature of the block that protects it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramGuids.swift#NvramGuids.isFtwStore
 */
export function isFtwStore(candidate: EFIGUID): boolean {
  return (
    guidEquals(candidate, nvramMainStoreVolumeGuid) ||
    guidEquals(candidate, edkiiWorkingBlockSignatureGuid) ||
    guidEquals(candidate, vss2WorkingBlockSignatureGuid)
  );
}
