import { u16, u32 } from "@/firmware/me/bytes";
import type {
  GSCFirmwareImage,
  GSCInfo,
  GSCIUPPartition,
} from "@/firmware/me/models/independentFacts";

/**
 * A GSC image's INFO partition — upstream `info_anl`: a u32 revision (anything but
 * 1 is an error upstream, and decoding carries on), one `GSC_Info_FWI` image
 * header, and as many `GSC_Info_IUP` rows as fit to the partition's end. Only GSC
 * images name a partition INFO, so the name gates the decode.
 *
 * Ported from `Packages/MEFirmware/IUP/GSCInfo.swift`.
 */

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/GSCInfo.swift#GSCInfoParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/GSCInfo.swift#GSCInfoParser.decode
 */
export function decodeGscInfo(
  bytes: Uint8Array,
  offset: number,
  size: number,
  baseOffset = 0
): GSCInfo | undefined {
  const high = Math.min(offset + size, bytes.length);
  if (offset < 0 || offset + 4 + 0x20 > high) return undefined;
  const revision = u32(bytes, offset);
  const image = decodeImage(bytes, offset + 4);
  const iupPartitions: GSCIUPPartition[] = [];
  for (let body = offset + 4 + 0x20; body + 0x10 <= high; body += 0x10) {
    iupPartitions.push({
      name: asciiName(bytes, body, 4),
      flags: u16(bytes, body + 0x04),
      reserved: u16(bytes, body + 0x06),
      svn: u32(bytes, body + 0x08),
      vcn: u32(bytes, body + 0x0c),
    });
  }
  return {
    offset: baseOffset + offset,
    revision,
    revisionValid: revision === 1,
    image,
    iupPartitions,
  };
}

function decodeImage(bytes: Uint8Array, at: number): GSCFirmwareImage {
  return {
    project: asciiName(bytes, at, 4),
    hotfix: u16(bytes, at + 0x04),
    build: u16(bytes, at + 0x06),
    gscMajor: u16(bytes, at + 0x08),
    gscMinor: u16(bytes, at + 0x0a),
    gscHotfix: u16(bytes, at + 0x0c),
    gscBuild: u16(bytes, at + 0x0e),
    flags: u16(bytes, at + 0x10),
    fwType: bytes[at + 0x12] ?? 0,
    fwSku: bytes[at + 0x13] ?? 0,
    arbSvn: u32(bytes, at + 0x14),
    tcbSvn: u32(bytes, at + 0x18),
    vcn: u32(bytes, at + 0x1c),
  };
}

/** The NULs dropped; a name with a byte past ASCII reads as no name, as upstream's decode does. */
export function asciiName(bytes: Uint8Array, at: number, length: number): string {
  if (at + length > bytes.length) return "";
  let text = "";
  for (let index = at; index < at + length; index++) {
    const byte = bytes[index] ?? 0;
    if (byte > 0x7f) return "";
    if (byte !== 0) text += String.fromCharCode(byte);
  }
  return text;
}
