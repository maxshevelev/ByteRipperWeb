/**
 * The lists of `BOOT_GUARD_PROTECTED_RANGES.md` §4 and §5, byte for byte — what
 * the protected-range tests build their images out of.
 *
 * Ported from `Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift`'s
 * `TestBootGuard`, which upstream keeps in the test file itself; a test file here
 * cannot export, and two test files need these.
 */

import * as Test from "@/firmware/testing/testImage";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { sum8 } from "@/firmware/uefi/checksums";
import { guid } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapParser";

export interface MapEntry {
  readonly offset: number;
  readonly size: number;
  readonly attributes: number;
  readonly hash: Uint8Array;
}

export const ZERO32 = new Uint8Array(32);

/**
 * An Insyde flash device map, its header checksum right.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#TestBootGuard.flashDeviceMap
 */
export function flashDeviceMapBytes(options: {
  readonly base: number;
  readonly entries: readonly MapEntry[];
  readonly entrySize?: number;
  readonly format?: number;
  readonly revision?: number;
}): Uint8Array {
  const body = new BinaryWriter();
  options.entries.forEach((entry, index) => {
    const id = (index + 1).toString(16).toUpperCase().padStart(12, "0");
    body.guid(guid(`FD000000-0000-4000-8000-${id}`));
    const text = `REGION${index}`;
    const regionId = Uint8Array.from(text, (character) => character.charCodeAt(0));
    body.raw(regionId).fill(16 - regionId.length, 0);
    body.u64(entry.offset).u64(entry.size).u32(entry.attributes).raw(entry.hash);
  });

  const header = new BinaryWriter()
    .u32(FlashDeviceMap.signature)
    .u32(FlashDeviceMap.headerSize + body.count)
    .u32(FlashDeviceMap.headerSize) // DataOffset
    .u32(options.entrySize ?? FlashDeviceMap.entrySize)
    .u8(options.format ?? 0)
    .u8(options.revision ?? 3)
    .u8(0) // ExtensionCount
    .u8(0) // Checksum, filled in below
    .u64(options.base).bytes;
  header[FlashDeviceMap.checksumOffset] = (0x100 - sum8(header)) & 0xff;

  const out = new Uint8Array(header.length + body.count);
  out.set(header);
  out.set(body.bytes, header.length);
  return out;
}

/**
 * The store at the start of a 64 KiB image, with a volume behind it so the image
 * is mapped.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.mapImage
 */
export function mapImage(store: Uint8Array): Uint8Array {
  const volume = Test.volume({ length: 0xf000, lastFile: Test.volumeTopFile({ size: 0x100 }) });
  const out = new Uint8Array(0x1000 + volume.length);
  out.fill(0xff);
  out.set(store);
  out.set(volume, 0x1000);
  return out;
}
