import type { ImageRange } from "@/firmware/imageReader";
import { hex, sha256 } from "@/firmware/me/crypto/digest";
import type { EFSVolume, MFSIntegrityTable } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { EFSFileNames } from "@/tools/efsFileNames";
import { MFSFileNames } from "@/tools/mfsFileNames";

/**
 * Two dumps' ME file systems compared file by file, by what the files hold.
 *
 * Why not by address: an MFS volume moves its pages to spread the wear, so one
 * machine's two dumps keep the same file in different places. A file is matched
 * by what the volume calls it — its low-level index in MFS, its file ID in EFS —
 * and compared by its content, the Integrity table left off and compared apart.
 *
 * Ported from `Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift`.
 */

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Volume */
export type MEFileVolume = "mfs" | "efs";

/**
 * Upstream's `Volume.allCases`, in declaration order.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Volume
 */
export const ME_FILE_VOLUMES: readonly MEFileVolume[] = ["mfs", "efs"];

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Status */
export type MEFileStatus = "same" | "different" | "onlyInA" | "onlyInB" | "incomplete" | "unknown";

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Side */
export interface MEFileSide {
  /** What the volume stores for the file, Integrity table included. */
  readonly storedSize: number;
  /** The content, the table left off. */
  readonly contentSize: number;
  /** Where it is stored, in the file's order; empty for an analysis made before the model kept them. */
  readonly extents: readonly ImageRange[];
  readonly contentDigest: string | undefined;
  readonly integrity: MFSIntegrityTable | undefined;
  readonly complete: boolean;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Row */
export interface MEFileRow {
  readonly volume: MEFileVolume;
  /** The low-level index (MFS) or the file ID (EFS). */
  readonly key: number;
  /** The file table's name for it, from either dump. */
  readonly name: string | undefined;
  readonly status: MEFileStatus;
  readonly a: MEFileSide | undefined;
  readonly b: MEFileSide | undefined;
  /** The same content kept at other addresses. */
  readonly moved: boolean;
  /** How many content bytes differ, for a file of one length on both sides whose bytes were read. */
  readonly differingBytes: number | undefined;
  /** Whether the Integrity tables differ, where both sides have one. */
  readonly integrityDiffers: boolean | undefined;
  /** Whether the file table says the engine encrypts the file. */
  readonly encrypted: boolean | undefined;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Gap.Reason */
export type MEFileGapReason = "absent" | "unreadable" | "badSignature" | "filesNotNamed";

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Gap */
export interface MEFileGap {
  readonly volume: MEFileVolume;
  /** Which dump: true for A. */
  readonly inA: boolean;
  readonly reason: MEFileGapReason;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison */
export interface MEFileComparison {
  /** The rows in volume and key order, MFS first. */
  readonly rows: readonly MEFileRow[];
  readonly gaps: readonly MEFileGap[];
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Names */
export interface MEFileNames {
  readonly mfs: MFSFileNames;
  readonly efs: EFSFileNames;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Names.none */
export const NO_ME_FILE_NAMES: MEFileNames = { mfs: MFSFileNames.none, efs: EFSFileNames.none };

/** A stretch of a dump at the addresses the analyses use, or undefined when it cannot be read. */
export type MEFileReader = (start: number, end: number) => Uint8Array | undefined;

type Files =
  | { readonly kind: "missing"; readonly reason: MEFileGapReason }
  | { readonly kind: "files"; readonly sides: ReadonlyMap<number, MEFileSide> };

/**
 * Compares `a`'s files with `b`'s. `readA` and `readB` return a stretch of
 * their dump at the addresses the analyses use, or undefined when they cannot;
 * with them a differing file says how many bytes differ, without them it says
 * only that it differs.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.compare
 * @upstream-differs the names are one parameter pair, and the readers take start and end
 */
export function compareMEFiles(
  a: FirmwareAnalysis,
  b: FirmwareAnalysis,
  names: { readonly a: MEFileNames; readonly b: MEFileNames } = {
    a: NO_ME_FILE_NAMES,
    b: NO_ME_FILE_NAMES,
  },
  readA?: MEFileReader,
  readB?: MEFileReader
): MEFileComparison {
  const rows: MEFileRow[] = [];
  const gaps: MEFileGap[] = [];
  for (const volume of ME_FILE_VOLUMES) {
    const left = filesOf(volume, a);
    const right = filesOf(volume, b);
    if (
      left.kind === "missing" &&
      left.reason === "absent" &&
      right.kind === "missing" &&
      right.reason === "absent"
    ) {
      continue;
    }
    if (left.kind === "missing" || right.kind === "missing") {
      // Each side that has no files to give says why.
      if (left.kind === "missing") gaps.push({ volume, inA: true, reason: left.reason });
      if (right.kind === "missing") gaps.push({ volume, inA: false, reason: right.reason });
      continue;
    }
    const keys = [...new Set([...left.sides.keys(), ...right.sides.keys()])].sort((x, y) => x - y);
    for (const key of keys) {
      const name = volumeName(volume, key, names.a) ?? volumeName(volume, key, names.b);
      const one = rowOf(volume, key, name, left.sides.get(key), right.sides.get(key), readA, readB);
      rows.push({
        ...one,
        encrypted: volumeEncrypted(volume, key, names.a) ?? volumeEncrypted(volume, key, names.b),
      });
    }
  }
  return { rows, gaps };
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.row */
function rowOf(
  volume: MEFileVolume,
  key: number,
  name: string | undefined,
  a: MEFileSide | undefined,
  b: MEFileSide | undefined,
  readA: MEFileReader | undefined,
  readB: MEFileReader | undefined
): MEFileRow {
  const row = {
    volume,
    key,
    name,
    a,
    b,
    encrypted: undefined,
  };
  if (a === undefined || b === undefined) {
    return {
      ...row,
      status: a === undefined ? "onlyInB" : "onlyInA",
      moved: false,
      differingBytes: undefined,
      integrityDiffers: undefined,
    };
  }
  const integrityDiffers =
    a.integrity !== undefined && b.integrity !== undefined
      ? !sameIntegrity(a.integrity, b.integrity)
      : undefined;
  if (!a.complete || !b.complete) {
    return {
      ...row,
      status: "incomplete",
      moved: false,
      differingBytes: undefined,
      integrityDiffers,
    };
  }
  const left = readA === undefined ? undefined : contentOf(a, readA);
  const right = readB === undefined ? undefined : contentOf(b, readB);
  let status: MEFileStatus;
  let differingBytes: number | undefined;
  if (left !== undefined && right !== undefined) {
    const equal = sameContent(left, right);
    status = equal ? "same" : "different";
    if (left.length === right.length && !equal) {
      differingBytes = 0;
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) differingBytes++;
      }
    }
  } else if (a.contentDigest !== undefined && b.contentDigest !== undefined) {
    status =
      a.contentSize === b.contentSize && a.contentDigest === b.contentDigest ? "same" : "different";
  } else {
    status = a.contentSize === b.contentSize ? "unknown" : "different";
  }
  const moved =
    status === "same" &&
    a.extents.length > 0 &&
    b.extents.length > 0 &&
    !sameExtents(a.extents, b.extents);
  return { ...row, status, moved, differingBytes, integrityDiffers };
}

/**
 * The file's content read through its extents, undefined where any stretch
 * cannot be read, the extents do not add up to what the file stores, or what was
 * read is not what the analysis found there — the bytes changed since, and the
 * digest is then the better witness of what was analysed.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.content
 */
export function contentOf(side: MEFileSide, read: MEFileReader): Uint8Array | undefined {
  if (side.extents.length === 0) return undefined;
  let total = 0;
  for (const extent of side.extents) total += extent.end - extent.start;
  if (total !== side.storedSize) return undefined;
  const bytes = new Uint8Array(side.storedSize);
  let at = 0;
  for (const extent of side.extents) {
    const piece = read(extent.start, extent.end);
    if (piece === undefined || piece.length !== extent.end - extent.start) return undefined;
    bytes.set(piece, at);
    at += piece.length;
  }
  const content = bytes.subarray(0, Math.min(side.contentSize, bytes.length));
  if (side.contentDigest !== undefined && hex(sha256(content)) !== side.contentDigest) {
    return undefined;
  }
  return content;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.files */
function filesOf(volume: MEFileVolume, analysis: FirmwareAnalysis): Files {
  if (volume === "mfs") {
    const mfs = analysis.mfsVolume;
    if (mfs === undefined) {
      return {
        kind: "missing",
        reason: analysis.regions.some((one) => one.name === "MFS") ? "unreadable" : "absent",
      };
    }
    if (!mfs.signatureValid) return { kind: "missing", reason: "badSignature" };
    const sides = new Map<number, MEFileSide>();
    for (const file of mfs.files) {
      sides.set(file.index, {
        storedSize: file.size,
        contentSize: file.contentSize ?? file.size,
        extents: file.extents ?? [],
        contentDigest: file.contentDigest,
        integrity: file.integrity,
        complete: file.chainIntact ?? true,
      });
    }
    return { kind: "files", sides };
  }
  const efs = analysis.efsVolume;
  if (efs === undefined) {
    return {
      kind: "missing",
      reason: analysis.regions.some((one) => one.name === "EFS") ? "unreadable" : "absent",
    };
  }
  // @upstream-differs the web's \`EFSVolume.files\` is never absent, so this is true only of a model that
  // lacks it (as one decoded before the field existed); an empty list is a volume with no files.
  const efsFiles = (efs as { readonly files?: EFSVolume["files"] }).files;
  if (efsFiles === undefined) return { kind: "missing", reason: "filesNotNamed" };
  const sides = new Map<number, MEFileSide>();
  for (const file of efsFiles) {
    sides.set(file.fileID, {
      storedSize: file.storedSize,
      contentSize: file.contentSize,
      extents: file.extents ?? [],
      contentDigest: file.contentDigest,
      integrity: file.integrity,
      complete: true,
    });
  }
  return { kind: "files", sides };
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Volume.name */
function volumeName(volume: MEFileVolume, key: number, names: MEFileNames): string | undefined {
  return volume === "mfs" ? names.mfs.path(key) : names.efs.name(key);
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEFileComparison.swift#MEFileComparison.Volume.encrypted */
function volumeEncrypted(
  volume: MEFileVolume,
  key: number,
  names: MEFileNames
): boolean | undefined {
  return (volume === "mfs" ? names.mfs.record(key) : names.efs.record(key))?.encryption;
}

/** @web-only Swift's synthesised Equatable on MFSIntegrityTable, which a record type lacks */
function sameIntegrity(left: MFSIntegrityTable, right: MFSIntegrityTable): boolean {
  return (
    left.size === right.size &&
    left.hmacHex === right.hmacHex &&
    left.flagsRaw === right.flagsRaw &&
    left.antiReplayProtection === right.antiReplayProtection &&
    left.encryptionProtection === right.encryptionProtection &&
    left.antiReplayIndex === right.antiReplayIndex &&
    left.securityVersion === right.securityVersion &&
    left.arRandom === right.arRandom &&
    left.arCounter === right.arCounter &&
    left.nonceHex === right.nonceHex
  );
}

/** @web-only Swift's array equality of ranges */
function sameExtents(left: readonly ImageRange[], right: readonly ImageRange[]): boolean {
  return (
    left.length === right.length &&
    left.every((one, index) => one.start === right[index]?.start && one.end === right[index]?.end)
  );
}

/** @web-only Swift's Data equality */
function sameContent(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
