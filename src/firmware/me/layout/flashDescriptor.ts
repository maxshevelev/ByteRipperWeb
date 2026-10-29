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

/**
 * How long the descriptor says the PCH strap section is, in words — the high byte of
 * `FLMAP1`. It is the one thing a dump states about which half of its chipset generation
 * the board is: the mobile parts lay the section out over 69, 70 or 74 words and the
 * desktop ones over 90, 101 or 115. Nothing where no descriptor was handed in or it does
 * not read as one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/IFWI.swift#FlashDescriptor.pchStrapWords
 */
export function pchStrapWords(bytes: Uint8Array): number | undefined {
  if (bytes.length < 0x1000) return undefined;
  if (!SIGNATURE.every((byte, index) => bytes[0x10 + index] === byte)) return undefined;
  return bytes[0x1b];
}

/**
 * What the host CPU / BIOS may read and write in the flash, off the descriptor's master
 * section — the fact that says whether a locked descriptor is locked *against the
 * BIOS*, which is what End of Manufacturing is about. The factory leaves `0x00F` /
 * `0x00A`; an image whose masks are all ones leaves the host able to rewrite the whole
 * flash, which is how a service dump is handed out for repair.
 *
 * The section base is FLMAP1's low byte in 0x10 units. Read in the **v2** word form —
 * twelve bits each, `read = word >> 8 & 0xFFF`, `write = word >> 20 & 0xFFF` — which is
 * the only form this is asked about. An all-zero word is an erased section, not a master.
 * An extracted ME region has no descriptor and answers nothing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/IFWI.swift#FlashDescriptor.biosMaster
 */
export function biosMaster(
  bytes: Uint8Array
): { readonly read: number; readonly write: number } | undefined {
  if (bytes.length < 0x1000) return undefined;
  if (!SIGNATURE.every((byte, index) => bytes[0x10 + index] === byte)) return undefined;
  const masterAt = bytes[0x18] ?? 0;
  if (masterAt === 0 || masterAt > 0xe0) return undefined;
  const base = masterAt * 16;
  if (base + 4 > bytes.length) return undefined;
  const word = u16(bytes, base) + u16(bytes, base + 2) * 0x10000;
  const read = Math.floor(word / 0x100) & 0xfff;
  const write = Math.floor(word / 0x10_0000) & 0xfff;
  if (read === 0 && write === 0) return undefined;
  return { read, write };
}
