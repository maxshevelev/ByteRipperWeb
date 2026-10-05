import { type EFIGUID, guid, guidKey } from "@/firmware/uefi/efiGuid";

/**
 * The flash device map's own constants.
 *
 * A leaf module of its own, for the reason `volumeFormat.ts` is one: the raw
 * scan needs the signature to look for, and the parser that reads a map's
 * regions needs the NVRAM walk and the second pass, which reach the scan again
 * through the file parser. A function-level cycle is fine; a *constant* read at
 * module load is not, and the scan reads this one as it loads.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap */
export const FlashDeviceMap = {
  /**
   * `HFDM`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.signature
   */
  signature: 0x4d44_4648,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.headerSize */
  headerSize: 0x1c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.checksumOffset */
  checksumOffset: 0x13,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.baseAddressOffset */
  baseAddressOffset: 0x14,
  /**
   * The one entry layout known: `INSYDE_FLASH_DEVICE_MAP_ENTRY`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.entrySize
   */
  entrySize: 0x54,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.entryFormat */
  entryFormat: 0,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.maxRevision */
  maxRevision: 4,
  /**
   * The region's hash is not checked.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.modifiable
   */
  modifiable: 0x1,
  /**
   * The entry is not valid — which UEFITool does not look at.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.ignored
   */
  ignored: 0x2,
  /**
   * Offsets inside an entry.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.regionOffsetOffset
   */
  regionOffsetOffset: 0x20,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.regionSizeOffset */
  regionSizeOffset: 0x28,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.attributesOffset */
  attributesOffset: 0x30,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.hashOffset */
  hashOffset: 0x34,
  /**
   * `INSYDE_FLASH_MAP_REGION_VAR_DEFAULT_GUID`: a range of `$VSS` stores
   * holding the firmware's default variables, outside every volume.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.variableDefaults
   */
  variableDefaults: guid("D9DDACA2-0816-48F3-ADED-6B71656B248A"),
  /**
   * `INSYDE_FLASH_MAP_REGION_BVDT_GUID`: the `$BVDT$` table (`InsydeBVDT`).
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.biosVersionDataTable
   */
  biosVersionDataTable: guid("32415DFC-D106-48C7-9EB5-806C114DD107"),
  /**
   * `INSYDE_FLASH_MAP_REGION_EC_GUID`: the embedded controller's firmware.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.ecFirmware
   */
  ecFirmware: guid("A73EF3BF-33CC-43A9-B39C-A912C7489A57"),
  /**
   * `INSYDE_FLASH_MAP_REGION_FLASH_MAP_GUID`: the map's own region.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.flashDeviceMap
   */
  flashDeviceMap: guid("F078C1A0-FC52-4C3F-BE1F-D688815A62C0"),
} as const;

/**
 * The region types UEFITool names (`insydeFlashDeviceMapEntryTypeGuidToUString`).
 * The words are its own and stay in its English: a region type is a name from
 * the firmware's vocabulary, not a sentence of this application's.
 */
const REGION_TYPE_NAMES: ReadonlyMap<string, string> = new Map(
  (
    [
      ["8CC7CC2D-C926-473B-B9D7-B297BB0FCA5F", "Aux Firmware Volume"],
      ["E3D76D56-988A-4D6B-8913-64F2DF1DF6A6", "Boot Firmware Volume"],
      ["32415DFC-D106-48C7-9EB5-806C114DD107", "BIOS Version Data Table"],
      ["A73EF3BF-33CC-43A9-B39C-A912C7489A57", "EC Firmware"],
      ["B78E15D3-F0A5-4248-8E2F-D3157AEF8836", "FTW Backup"],
      ["C8416E04-9934-4079-BE9A-39F8D6028498", "FTW State"],
      ["B5E8E758-A7E6-4C8B-AB85-FF2A959B99BA", "Firmware Volume"],
      ["A36CBFED-0A2F-4A9D-823C-3C498C06DDD1", "Other Firmware Volume"],
      ["F078C1A0-FC52-4C3F-BE1F-D688815A62C0", "Flash Device Map"],
      ["29280631-623B-43E4-BCA1-005214C483A6", "GPNV"],
      ["1AB43FAF-4988-47B9-969B-3E31587A75DE", "License"],
      ["DACFAB69-F977-4784-8AD8-7724A6F4B440", "Logo"],
      ["B49866F8-8CD2-49E4-A16D-B60FBEC31C4B", "Microcode"],
      ["B344EB1A-F97E-4F14-A1E1-7E63BC40C8CE", "MSDM Table"],
      ["5994B592-2F14-48D5-BB40-BD27969C7780", "MultiConfig"],
      ["A42C1051-73B5-41A9-B635-0CC51C8272F8", "ODM"],
      ["2FD91AD6-D8E3-4FD6-B679-3030E86AE57A", "OEM"],
      ["C0027E32-8EE5-4D17-9B28-BA50166C4CB4", "Password"],
      ["B95D2198-8E70-4CDC-937D-9A3F795F9905", "SMBIOS Event Log"],
      ["8964FEDC-6FE7-4E1E-A55E-FF821D71FFCF", "SMBIOS Update"],
      ["773C5374-81D1-4D43-B293-F3D74F181D6B", "Variables"],
      ["D9DDACA2-0816-48F3-ADED-6B71656B248A", "Variable Defaults"],
      ["201D65E5-BE23-4875-80F8-B1D4795E7E08", "Unknown"],
      ["13C8B020-4F27-453B-8F80-1BFCA187380F", "Unused"],
      ["607BF30F-5F2B-4DA2-AEED-56F9BDCD2D21", "USB Option ROM"],
      ["1FD0BACE-6F0A-4085-901E-F6210385CB6F", "DXE Firmware Volume"],
      ["CF1406C5-3FEC-47EB-A6C3-B71A3EE00B95", "PEI Firmware Volume"],
      ["F2A016B6-E814-402E-A395-46D3CF75264A", "Unsigned Firmware Volume"],
      ["00000C00-0000-0000-0000-000000000000", "Factory Copy"],
      ["244A24AF-C124-49A3-B286-ACE1AB31FD25", "Option ROM"],
      ["8C493122-CE49-4504-9250-1B296C49A5C3", "BusDeviceFunction Option ROM"],
      ["1A6047F6-7B12-45E1-A26F-E8DDA55D7256", "Verb Table"],
      ["AD38B3FD-5C53-49FE-A4B3-28EE079D2495", "Lenovo Variable1"],
      ["A63E8136-6933-46A0-B74A-3618A5F7EF04", "Lenovo Variable2"],
      ["3E2DA81C-E401-4B6B-B8A4-5095DA690DDD", "Lenovo EEPROM"],
      ["F392B582-1F08-4E95-B51D-598B19F6993F", "Lenovo Supervisor Password"],
      ["FA01652A-4942-417A-AE1C-B8FA2BD31A84", "Lenovo User Password"],
      ["D1877CDF-4573-4273-A11C-97428E03A734", "Lenovo SLP 2.0"],
      ["CD1C653D-D25D-44D2-BF94-37D9633DE22F", "Lenovo Computrace"],
      ["45C3433E-E013-4F0C-AE37-A9AA0B47C42E", "Lenovo Custom MultiLogo"],
      ["0669D988-1C2C-455F-8BDD-6DA303F4AAC1", "Lenovo Reserved"],
      ["06BFC909-BCEF-4E32-8E64-E909D9F6BBE4", "Lenovo Computrace Volume"],
      ["0978798D-98FA-4A38-BBC5-96F0B4DEC485", "Lenovo Backup IBB"],
      ["C2C749AF-12D6-484A-A39A-81D1C1F04E01", "Lenovo Variable Debug"],
      ["C2C749AF-12D6-484A-A39A-81D1C1F04E02", "Lenovo Variable Sub1"],
      ["C2C749AF-12D6-484A-A39A-81D1C1F04E03", "Lenovo Variable Sub2"],
    ] as const
  ).map(([text, name]) => [guidKey(guid(text)), name])
);

/**
 * What a region of this type is, in UEFITool's words, or nothing for a type it
 * does not name. The entry's row reads as this: the GUID alone says nothing a
 * technician can use.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.regionTypeName
 */
export function regionTypeName(type: EFIGUID): string | undefined {
  return REGION_TYPE_NAMES.get(guidKey(type));
}
