import { filledWith, has, u16 } from "@/firmware/me/bytes";

/**
 * The one fact the `$FPT` spine needs from a whole-flash image: where the
 * Engine/Graphics region begins.
 *
 * Nothing when the bytes do not start with a descriptor, which is what an
 * extracted ME region looks like — and that absence is itself the signal the
 * caller uses, since a bare region is measured from its own start.
 *
 * Ported from `Packages/MEFirmware/Layout/IFWI.swift`.
 */

/**
 * The on-image descriptor signature at 0x10. Compared as raw bytes: read as a
 * little-endian word these four give 0x0FF0A55A, not the big-endian-looking
 * 0x5AA5F00F the documentation writes.
 */
const SIGNATURE = [0x5a, 0xa5, 0xf0, 0x0f];

export interface MERegion {
  readonly base: number;
  readonly size: number;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/IFWI.swift#FlashDescriptor
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/IFWI.swift#FlashDescriptor.meRegion
 */
export function meRegion(bytes: Uint8Array): MERegion | undefined {
  if (bytes.length < 0x1000) return undefined;
  if (!SIGNATURE.every((byte, index) => bytes[0x10 + index] === byte)) return undefined;
  // The strap count, which a descriptor has between one and sixteen of.
  const strap = bytes[0x14] ?? 0;
  if (strap < 0x01 || strap > 0x10) return undefined;
  // And a sixteen-byte erased run, the last of what tells a descriptor from
  // four bytes that happen to match.
  if (!filledWith(bytes, 0xc0, 0x10, 0xff)) return undefined;

  // The region table sits at 0x40 when the descriptor is at the image's start.
  // FLREG2 is the Engine/Graphics region: a base at 0x48 and a limit at 0x4A,
  // both counted in 4 KB blocks.
  const base = u16(bytes, 0x48);
  const limit = u16(bytes, 0x4a);
  if (limit === 0 || base > limit) return undefined;
  const start = base * 0x1000;
  const size = (limit + 1 - base) * 0x1000;
  return has(bytes, start, size) ? { base: start, size } : undefined;
}
