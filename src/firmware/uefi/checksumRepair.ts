import type { ImageReader } from "@/firmware/imageReader";
import { checksum16, sum8, sum8Of, sum32Of } from "@/firmware/uefi/checksums";
import { FFS } from "@/firmware/uefi/fileParser";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { FV } from "@/firmware/uefi/volumeParser";

/**
 * Bytes that have to be written to put a structure's checksums back in order.
 *
 * The reason this module produces writes rather than performing them: nothing
 * here touches a file. A tool turns these into one undoable edit, and that is
 * what makes the whole repair a single step — the scattered writes of an edit
 * and the checksums they invalidate landing together or not at all.
 *
 * Every level of this format checks itself, and the checks nest: change a
 * file's body and the file's body checksum is wrong; change its header and the
 * header checksum is wrong. The volume above it does *not* care — its checksum
 * covers only its own header — which is the one mercy in this format and the
 * reason this cascade is two steps and not ten.
 */

export interface ChecksumRepair {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

/**
 * What to write after a file's body or header changed. Returns only what
 * actually differs, so an empty result means nothing needs fixing.
 */
export function repairsForFile(
  file: UEFINode,
  volumeRevision: number,
  reader: ImageReader
): ChecksumRepair[] {
  if (file.kind !== "file") return [];
  const at = file.header.start;
  const storedHeader = reader.uint8(at + 0x10);
  const storedBody = reader.uint8(at + 0x11);
  const attributes = reader.uint8(at + 0x13);
  const state = reader.uint8(at + 0x17);
  const headerBytes = reader.bytes(file.header);
  if (
    storedHeader === undefined ||
    storedBody === undefined ||
    attributes === undefined ||
    state === undefined ||
    headerBytes === undefined
  ) {
    return [];
  }

  const repairs: ChecksumRepair[] = [];

  // The body checksum first, though the order does not matter: the header sum
  // excludes both checksum bytes, so neither depends on the other.
  if (file.body.end > file.body.start) {
    let computed: number;
    if ((attributes & FFS.checksumBit) !== 0) {
      const bodySum = sum8Of(file.body, reader);
      if (bodySum === undefined) return [];
      computed = (0x100 - bodySum) & 0xff;
    } else {
      computed = volumeRevision === 1 ? FFS.fixedChecksum : FFS.fixedChecksum2;
    }
    if (computed !== storedBody) {
      repairs.push({ offset: at + 0x11, bytes: Uint8Array.of(computed) });
    }
  }

  const sum = (sum8(headerBytes) - storedHeader - storedBody - state) & 0xff;
  const computed = (0x100 - sum) & 0xff;
  if (computed !== storedHeader) {
    repairs.push({ offset: at + 0x10, bytes: Uint8Array.of(computed) });
  }
  return repairs;
}

/**
 * What to write after a volume header changed. The sum covers `HeaderLength`
 * bytes and not the extended header, so this reads the length back out of the
 * header rather than trusting the node's.
 */
export function repairsForVolume(volume: UEFINode, reader: ImageReader): ChecksumRepair[] {
  if (volume.kind !== "volume") return [];
  const at = volume.header.start;
  const headerLength = reader.uint16(at + 0x30);
  const stored = reader.uint16(at + FV.checksumOffset);
  const read = headerLength === undefined ? undefined : reader.bytesAt(at, headerLength);
  if (stored === undefined || read === undefined) return [];

  const bytes = Uint8Array.from(read);
  bytes[FV.checksumOffset] = 0;
  bytes[FV.checksumOffset + 1] = 0;
  const computed = checksum16(bytes);
  if (computed === undefined || computed === stored) return [];
  return [
    {
      offset: at + FV.checksumOffset,
      bytes: Uint8Array.of(computed & 0xff, (computed >>> 8) & 0xff),
    },
  ];
}

/**
 * What to write after a microcode image changed: the field that brings the sum
 * of every dword back to zero.
 */
export function repairsForMicrocode(microcode: UEFINode, reader: ImageReader): ChecksumRepair[] {
  if (microcode.kind !== "microcode") return [];
  const at = microcode.header.start;
  const stored = reader.uint32(at + 0x10);
  const sum = sum32Of(nodeRange(microcode), reader);
  if (stored === undefined || sum === undefined || sum === 0) return [];
  const computed = (stored - sum) >>> 0;
  return [
    {
      offset: at + 0x10,
      bytes: Uint8Array.from([0, 1, 2, 3], (index) => (computed >>> (8 * index)) & 0xff),
    },
  ];
}
