import { decompressLzma } from "@/firmware/compression/firmwareDecompression";
import { hex, sha256, sha384 } from "@/firmware/me/crypto/digest";

/**
 * CSE LZMA module decompression — upstream `cse_unpack`'s `mod_comp == 2` branch,
 * over the shared LZMA decoder.
 *
 * Upstream does three things around the decode that the LZMA format itself knows
 * nothing about, and all three are here: three stray zero bytes some modules
 * carry in their header, the trailing padding a decoded module can be short of,
 * and a stored hash that covers the compressed bytes for most modules and the
 * decompressed ones for a few.
 *
 * Ported from `Packages/MEFirmware/Decompress/LZMAModule.swift`.
 */

/**
 * How a module with the stray zeros starts (after `me_unpack.py`, which upstream cites).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.strayZerosSignature
 */
export const STRAY_ZEROS_SIGNATURE: readonly number[] = [0x36, 0x00, 0x40, 0x00, 0x00];

/**
 * What any one CSME module may decompress to; the declared size is an untrusted number.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.maximumSize
 */
export const LZMA_MODULE_MAXIMUM_SIZE = 64 * 1024 * 1024;

/**
 * The stored bytes as the decoder wants them: a module that starts with the
 * signature and has zeros at 0x0E…0x10 loses those three bytes.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.decoderInput
 */
export function lzmaDecoderInput(stored: Uint8Array): Uint8Array {
  if (stored.length < 0x11) return stored;
  if (!STRAY_ZEROS_SIGNATURE.every((byte, index) => stored[index] === byte)) return stored;
  if (stored[0x0e] !== 0 || stored[0x0f] !== 0 || stored[0x10] !== 0) return stored;
  const out = new Uint8Array(stored.length - 3);
  out.set(stored.subarray(0, 0x0e));
  out.set(stored.subarray(0x11), 0x0e);
  return out;
}

/**
 * The module decompressed, or nothing when it does not decode. A stream shorter
 * than the `.met`'s uncompressed size is filled out with its own last byte — the
 * way upstream adds the "missing EOF padding".
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.decompress
 */
export function decompressLzmaModule(
  stored: Uint8Array,
  uncompressedSize: number
): Uint8Array | undefined {
  let decoded: Uint8Array;
  try {
    decoded = decompressLzma(lzmaDecoderInput(stored), LZMA_MODULE_MAXIMUM_SIZE).bytes;
  } catch {
    return undefined;
  }
  const last = decoded.at(-1);
  if (decoded.length >= uncompressedSize || last === undefined) return decoded;
  const padded = new Uint8Array(uncompressedSize).fill(last);
  padded.set(decoded);
  return padded;
}

/**
 * Whether the `.met` hash covers this module: the stored bytes, stray zeros
 * included, or failing that the decompressed ones. The hash is stored in the
 * order the `.met` holds it, and upstream prints it as a little-endian integer,
 * so its digest is this one read backwards. 32 bytes is SHA-256, anything else
 * SHA-384.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.hashMatches
 */
export function lzmaHashMatches(
  storedHash: string,
  stored: Uint8Array,
  decompressed: Uint8Array
): boolean {
  const expected = reversedHex(storedHash);
  if (expected.length === 0) return false;
  const digest = expected.length === 64 ? sha256 : sha384;
  return hex(digest(stored)) === expected || hex(digest(decompressed)) === expected;
}

/**
 * Uppercase hex with its bytes in the opposite order; nothing for half a byte.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Decompress/LZMAModule.swift#LZMAModule.reversedHex
 */
export function reversedHex(text: string): string {
  const upper = text.toUpperCase();
  if (upper.length % 2 !== 0) return "";
  let out = "";
  for (let at = upper.length - 2; at >= 0; at -= 2) out += upper.slice(at, at + 2);
  return out;
}
