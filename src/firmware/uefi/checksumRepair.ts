import type { ImageReader } from "@/firmware/imageReader";
import { DirectoryKind, fletcher32 } from "@/firmware/uefi/amdFirmware";
import { checksum16, sum8, sum8Of, sum32Of } from "@/firmware/uefi/checksums";
import { FFS, marksHeaderInvalid, volumeErasePolarity } from "@/firmware/uefi/fileParser";
import { enclosingVolume } from "@/firmware/uefi/rootLayout";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { FV } from "@/firmware/uefi/volumeFormat";

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

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#ChecksumRepair */
export interface ChecksumRepair {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#ChecksumRepair.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#ChecksumRepair.bytes */
  readonly bytes: Uint8Array;
}

/**
 * What to write after a file's body or header changed. Returns only what
 * actually differs, so an empty result means nothing needs fixing — which is also
 * the answer for a file whose state marks its header invalid, since it owes no
 * checksum (`marksHeaderInvalid`).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#UEFIChecksums
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#UEFIChecksums.repairs
 */
export function repairsForFile(
  file: UEFINode,
  volumeRevision: number,
  reader: ImageReader,
  volumeErasePolarity?: boolean | undefined
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
    headerBytes === undefined ||
    marksHeaderInvalid(state, volumeErasePolarity)
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
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#UEFIChecksums.repairs
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
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#UEFIChecksums.repairs
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

/**
 * What to write after a PSP or BIOS directory changed (`AMDFirmware`): the Fletcher-32 of
 * everything after the checksum word, in the second word. A slot header carries none of that
 * kind.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ChecksumRepair.swift#UEFIChecksums.repairs
 */
export function repairsForAMDDirectory(directory: UEFINode, reader: ImageReader): ChecksumRepair[] {
  const offset = directory.header.start;
  const end = nodeRange(directory).end;
  if (directory.kind !== "amdDirectory" || directory.subtype === DirectoryKind.slotHeader)
    return [];
  const stored = reader.uint32(offset + 4);
  if (stored === undefined || offset + 8 >= end) return [];
  const bytes = reader.bytes({ start: offset + 8, end });
  if (bytes === undefined) return [];
  const computed = fletcher32(bytes);
  if (computed === stored) return [];
  return [
    {
      offset: offset + 4,
      bytes: Uint8Array.from([0, 1, 2, 3], (index) => (computed >>> (8 * index)) & 0xff),
    },
  ];
}

/**
 * The erase polarity of the volume a node lives in, which is what a file's state
 * byte is read under (`marksHeaderInvalid`).
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.volumeErasePolarity
 * @upstream-differs the volume is the node's enclosing one by tree path, in the node's own
 * space, where upstream looks for the innermost volume whose range holds the node's header
 */
export function volumeErasePolarityOf(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): boolean | undefined {
  const volume = enclosingVolume(node, image);
  return volume === undefined ? undefined : volumeErasePolarity(volume, reader);
}

/**
 * The innermost volume on the way down to the node at `path`, and the revision a
 * file there is checked against: the volume's own, read from its subtype, and 2
 * where there is no volume above the node to say.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.volumeRevision
 * @upstream-differs found by the node's path in the tree, where upstream looks for the innermost volume whose range holds the node's header; and a volume-less node answers revision 2 rather than nothing, which is the revision its fixed body sum is then checked against
 */
export function volumeAlongPath(
  roots: readonly UEFINode[],
  path: readonly number[]
): { readonly volume: UEFINode | undefined; readonly revision: number } {
  let nodes = roots;
  let revision = 2;
  let volume: UEFINode | undefined;
  for (const index of path) {
    const next = nodes[index];
    if (next === undefined) break;
    if (next.kind === "volume") {
      volume = next;
      if (next.subtype !== undefined) revision = next.subtype;
    }
    nodes = next.children;
  }
  return { volume, revision };
}
