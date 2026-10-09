import { BinaryWriter } from "@/firmware/testing/testImage";
import { sum8 } from "@/firmware/uefi/checksums";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";

/**
 * An Insyde flash device map built byte by byte, for the tests of what the map makes of
 * the padding it names.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestFlashDeviceMap.swift#TestFlashDeviceMap
 */

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestFlashDeviceMap.swift#TestFlashDeviceMap.Entry */
export interface FlashDeviceMapTestEntry {
  readonly type: EFIGUID;
  readonly offset: number;
  readonly size: number;
}

/**
 * A map whose entries carry the region types given, each `offset` from `base`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestFlashDeviceMap.swift#TestFlashDeviceMap.map
 */
export function flashDeviceMapBytes(
  entries: readonly FlashDeviceMapTestEntry[],
  base: number
): Uint8Array {
  const body = new BinaryWriter();
  for (const entry of entries) {
    body.guid(entry.type);
    body.fill(16, 0); // RegionId
    body.u64(entry.offset);
    body.u64(entry.size);
    body.u32(FlashDeviceMap.modifiable);
    body.fill(32, 0); // Hash
  }
  const header = new BinaryWriter()
    .u32(FlashDeviceMap.signature)
    .u32(FlashDeviceMap.headerSize + body.count)
    .u32(FlashDeviceMap.headerSize)
    .u32(FlashDeviceMap.entrySize)
    .u8(FlashDeviceMap.entryFormat)
    .u8(3) // Revision
    .u8(0) // ExtensionCount
    .u8(0) // Checksum, filled in below
    .u64(base).bytes;
  header[FlashDeviceMap.checksumOffset] = (0x100 - sum8(header)) & 0xff;
  return Uint8Array.from([...header, ...body.bytes]);
}
