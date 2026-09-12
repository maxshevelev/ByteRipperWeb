import { tag as asciiTag, has, slice, u8, u16, u32, u64 } from "@/firmware/me/bytes";
import { hex } from "@/firmware/me/crypto/digest";

/**
 * The chain of extension blocks that follows a manifest inside its module.
 *
 * A manifest module holds the partition's manifest *and* its extensions; a
 * metadata companion's whole body *is* a chain. Between them they carry every
 * fact the health rows are made of: the ARB security version, the version
 * control number, the NVM compatibility, the workstation bit, and each module's
 * own compression, sizes and hash.
 *
 * Every block is surfaced, decoded or not. A tag this parser does not know still
 * appears as an envelope — its tag, its size and where it is — so a panel shows
 * the *whole* chain rather than the part that happened to be understood, and a
 * reader can see that something is there.
 *
 * Ported from `Packages/MEFirmware/Partition/Extensions.swift`.
 */

/**
 * Which revision of the block headers this firmware writes.
 *
 * Chosen from the manifest alone, with no database: the same tag has a longer
 * header and a longer hash on the newer families, and reading one as the other
 * puts a hash's first bytes where a size should be.
 */
export type ExtensionFamily = "base" | "csme12" | "csme15";

export function extensionFamily(options: {
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
  readonly year: number;
  readonly month: number;
  readonly keyLength: number | undefined;
}): ExtensionFamily {
  const { major, minor, hotfix, build, year, month, keyLength } = options;
  if (keyLength === 0x180 || major === 15 || major === 16) return "csme15";
  // The earliest CSME 12 builds still use the older structs, and only their own
  // date tells them apart from the rest of 12.
  const isEarly12 = minor === 0 && hotfix === 0 && build >= 7000 && year < 2018 && month < 8;
  if ((major === 12 && !isEarly12) || major === 13 || major === 14) return "csme12";
  return "base";
}

/** Whether a tag's header is the revised one for this family. */
export function isRevisedHeader(tag: number, family: ExtensionFamily): boolean {
  if (family === "csme15") return [0x00, 0x03, 0x0a, 0x0f, 0x16].includes(tag);
  if (family === "csme12") return tag === 0x0f;
  return false;
}

// MARK: - What each block says

export interface SystemInfoExtension {
  readonly minUMASize: number;
  readonly chipsetVersion: number;
  readonly pageableUMASize: number;
  readonly imageHash: string;
}

export interface FeaturePermissionsExtension {
  readonly moduleCount: number;
}

export interface PartitionInfoExtension {
  readonly partitionName: string;
  readonly partitionSize: number;
  /** Only the first of the two partition-information tags carries one. */
  readonly vcn: number | undefined;
  readonly versionMajor: number;
  readonly versionMinor: number;
  readonly dataFormatMajor: number;
  readonly dataFormatMinor: number;
  readonly instanceID: number;
  readonly flags: number;
  readonly hash: string;
}

export interface ClientSystemInfoExtension {
  readonly skuCaps: number;
  readonly cseSize: number;
  readonly skuType: number;
  readonly workstation: boolean;
  readonly m3: boolean;
  readonly m0: boolean;
  readonly skuPlatform: number;
  readonly siClass: number;
}

export interface SignedPackageExtension {
  readonly partitionName: string;
  readonly vcn: number;
  readonly usageBitmap: string;
  readonly arbSvn: number;
  /** The revised header's three extra fields; absent on the original. */
  readonly fwType: number | undefined;
  readonly fwSku: number | undefined;
  readonly nvmCompatibility: number | undefined;
}

export interface ModuleAttributesExtension {
  readonly compression: number;
  readonly encryption: number;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly deviceID: number;
  readonly vendorID: number;
  readonly moduleHash: string;
}

export interface SharedLibraryExtension {
  readonly contextSize: number;
  readonly totalAllocatedVirtSpace: number;
  readonly codeBaseAddress: number;
  readonly tlsSize: number;
  readonly reserved: number;
}

export interface ProcessAttributesExtension {
  readonly faultTolerant: boolean;
  readonly permanentProcess: boolean;
  readonly singleInstance: boolean;
  readonly trustedSendReceiveSender: boolean;
  readonly trustedNotifySender: boolean;
  readonly publicSendReceiveReceiver: boolean;
  readonly publicNotifyReceiver: boolean;
  readonly flagsReserved: number;
  readonly mainThreadID: number;
  readonly codeBaseAddress: number;
  readonly codeSizeUncompressed: number;
  readonly cm0HeapSize: number;
  readonly bssSize: number;
  readonly defaultHeapSize: number;
  readonly mainThreadEntry: number;
  readonly allowedSysCalls: readonly number[];
  readonly userID: number;
  readonly groupIDs: readonly number[];
}

export interface ThreadRow {
  readonly stackSize: number;
  readonly flags: number;
  readonly schedulingPolicy: number;
  readonly reserved: number;
}

export interface DeviceRow {
  readonly deviceID: number;
  readonly reserved: number;
}

export interface MmioRangeRow {
  readonly baseAddress: number;
  readonly sizeLimit: number;
  readonly flags: number;
}

export interface SpecialFileRow {
  readonly name: string;
  readonly accessMode: number;
  readonly userID: number;
  readonly groupID: number;
  readonly minorNumber: number;
  readonly reserved0: number;
  readonly reserved1: number;
}

export interface SpecialFilesExtension {
  readonly majorNumber: number;
  readonly flags: number;
  readonly rows: readonly SpecialFileRow[];
}

export interface LockedRangeRow {
  readonly rangeBase: number;
  readonly rangeSize: number;
}

export interface UserInfoRow {
  readonly userID: number;
  readonly reserved: number;
  readonly nvStorageQuota: number;
  readonly ramStorageQuota: number;
  readonly wopQuota: number;
  /** Only the older row layout carries one. */
  readonly workingDirectory: string | undefined;
}

/** One block of the chain: its envelope, and whatever of it was understood. */
export interface CPDExtension {
  readonly tag: number;
  readonly size: number;
  /** Absolute, so it matches every other offset the analysis reports. */
  readonly offset: number;
  readonly systemInfo?: SystemInfoExtension;
  readonly featurePermissions?: FeaturePermissionsExtension;
  readonly partitionInfo?: PartitionInfoExtension;
  readonly clientSystemInfo?: ClientSystemInfoExtension;
  readonly signedPackage?: SignedPackageExtension;
  readonly moduleAttributes?: ModuleAttributesExtension;
  readonly sharedLibrary?: SharedLibraryExtension;
  readonly processAttributes?: ProcessAttributesExtension;
  readonly threadRows?: readonly ThreadRow[];
  readonly deviceRows?: readonly DeviceRow[];
  readonly mmioRows?: readonly MmioRangeRow[];
  readonly specialFiles?: SpecialFilesExtension;
  readonly lockedRanges?: readonly LockedRangeRow[];
  readonly userInfoRows?: readonly UserInfoRow[];
}

// MARK: - Walking the chain

/**
 * The chain of a manifest module: the manifest struct is skipped, since the
 * chain begins where it ends.
 */
export function decodeExtensionChain(options: {
  readonly bytes: Uint8Array;
  /** The module's start, which for a manifest module is the manifest's base. */
  readonly moduleContentBase: number;
  readonly moduleSize: number;
  /** Where extensions begin: the manifest's base plus its header length. */
  readonly chainStart: number;
  readonly family: ExtensionFamily;
  readonly baseOffset?: number;
}): CPDExtension[] {
  const { bytes, moduleContentBase, moduleSize, chainStart, family } = options;
  if (moduleSize <= 0) return [];
  const moduleEnd = Math.min(moduleContentBase + moduleSize, bytes.length);
  if (moduleEnd < moduleContentBase || chainStart < moduleContentBase) return [];
  if (chainStart + 8 > moduleEnd) return [];
  return walk(bytes, chainStart, moduleEnd, family, options.baseOffset ?? 0);
}

/**
 * The chain of a metadata companion, whose body *is* the chain.
 *
 * Unlike a manifest module — which begins with the manifest struct, so its chain
 * starts a header's length in — this one starts at the body's own base. Its
 * first block is almost always the one describing the module it belongs to.
 */
export function decodeMetadataChain(options: {
  readonly bytes: Uint8Array;
  readonly contentBase: number;
  readonly bodySize: number;
  readonly family: ExtensionFamily;
  readonly baseOffset?: number;
}): CPDExtension[] {
  const { bytes, contentBase, bodySize, family } = options;
  if (bodySize <= 0) return [];
  const bodyEnd = Math.min(contentBase + bodySize, bytes.length);
  if (bodyEnd < contentBase || contentBase + 8 > bodyEnd) return [];
  return walk(bytes, contentBase, bodyEnd, family, options.baseOffset ?? 0);
}

/**
 * The blocks from `start` to `moduleEnd`: one per tag-and-size envelope, with a
 * header decoded for the tags this understands.
 *
 * A size of zero stops the walk — it is a false positive rather than a block,
 * and continuing would mean stepping nowhere forever. So does a hundred blocks,
 * which is the backstop upstream keeps for a chain that loops.
 */
function walk(
  bytes: Uint8Array,
  start: number,
  moduleEnd: number,
  family: ExtensionFamily,
  baseOffset: number
): CPDExtension[] {
  const found: CPDExtension[] = [];
  let offset = start;
  let loops = 0;
  while (offset + 8 <= moduleEnd) {
    loops++;
    if (loops > 100) break;
    const tag = u32(bytes, offset);
    const size = u32(bytes, offset + 4);
    if (size === 0) break;
    const blockEnd = offset + size;

    // A header is decoded only for a block wholly inside its module. One that
    // overruns keeps its envelope — the fact that it is there and how big it
    // claims to be is exactly what a reader needs to see.
    const decoded =
      blockEnd <= moduleEnd
        ? decodeBlock(bytes, offset, size, tag, isRevisedHeader(tag, family), family)
        : {};
    found.push({ tag, size, offset: baseOffset + offset, ...decoded });
    offset = blockEnd;
  }
  return found;
}

function decodeBlock(
  bytes: Uint8Array,
  at: number,
  size: number,
  tag: number,
  revised: boolean,
  family: ExtensionFamily
): Partial<CPDExtension> {
  switch (tag) {
    case 0x00: {
      // System information. The revised header is longer and its image hash is
      // the longer digest.
      const headerLength = revised ? 0x50 : 0x40;
      if (!has(bytes, at, headerLength)) return {};
      return {
        systemInfo: {
          minUMASize: u32(bytes, at + 0x08),
          chipsetVersion: u32(bytes, at + 0x0c),
          pageableUMASize: u32(bytes, at + (revised ? 0x40 : 0x30)),
          imageHash: hexAt(bytes, at + 0x10, revised ? 48 : 32),
        },
      };
    }
    case 0x02:
      if (!has(bytes, at, 0x0c)) return {};
      return { featurePermissions: { moduleCount: u32(bytes, at + 0x08) } };
    case 0x03:
    case 0x16:
      return decodePartitionInfo(bytes, at, tag, revised);
    case 0x0a: {
      // Module attributes: the universal first block of a metadata body, which
      // describes the module it belongs to.
      const hashLength = revised ? 48 : 32;
      if (!has(bytes, at, 0x18 + hashLength)) return {};
      return {
        moduleAttributes: {
          compression: u8(bytes, at + 0x08),
          encryption: u8(bytes, at + 0x09),
          uncompressedSize: u32(bytes, at + 0x0c),
          compressedSize: u32(bytes, at + 0x10),
          deviceID: u16(bytes, at + 0x14),
          vendorID: u16(bytes, at + 0x16),
          moduleHash: hexAt(bytes, at + 0x18, hashLength),
        },
      };
    }
    case 0x0c: {
      if (!has(bytes, at, 0x30)) return {};
      // One packed word of bitfields, which is where the workstation bit lives.
      const attributes = u64(bytes, at + 0x28);
      const field = (shift: number, width: number) =>
        Math.floor(attributes / 2 ** shift) % 2 ** width;
      return {
        clientSystemInfo: {
          skuCaps: u32(bytes, at + 0x08),
          cseSize: field(0, 4),
          skuType: field(4, 3),
          workstation: field(7, 1) !== 0,
          m3: field(8, 1) !== 0,
          m0: field(9, 1) !== 0,
          skuPlatform: field(10, 2),
          siClass: field(12, 4),
        },
      };
    }
    case 0x0f: {
      if (!has(bytes, at, 0x34)) return {};
      return {
        signedPackage: {
          partitionName: asciiTag(bytes, at + 0x08, 4),
          vcn: u32(bytes, at + 0x0c),
          usageBitmap: hexAt(bytes, at + 0x10, 16),
          arbSvn: u32(bytes, at + 0x20),
          // The revised header reuses the original's reserved bytes for these.
          fwType: revised ? u8(bytes, at + 0x24) & 0x7 : undefined,
          fwSku: revised ? u8(bytes, at + 0x25) & 0x7 : undefined,
          nvmCompatibility: revised ? u32(bytes, at + 0x26) & 0x3 : undefined,
        },
      };
    }
    case 0x04: {
      if (!has(bytes, at, 0x1c)) return {};
      return {
        sharedLibrary: {
          contextSize: u32(bytes, at + 0x08),
          totalAllocatedVirtSpace: u32(bytes, at + 0x0c),
          codeBaseAddress: u32(bytes, at + 0x10),
          tlsSize: u32(bytes, at + 0x14),
          reserved: u32(bytes, at + 0x18),
        },
      };
    }
    case 0x05:
      return decodeProcessAttributes(bytes, at, size);
    case 0x06: {
      const rows = rowsOf(bytes, at, size, 0x08, 0x10, (row) => ({
        stackSize: u32(bytes, row),
        flags: u32(bytes, row + 0x04),
        schedulingPolicy: u32(bytes, row + 0x08),
        reserved: u32(bytes, row + 0x0c),
      }));
      return rows === undefined ? {} : { threadRows: rows };
    }
    case 0x07: {
      const rows = rowsOf(bytes, at, size, 0x08, 0x08, (row) => ({
        deviceID: u32(bytes, row),
        reserved: u32(bytes, row + 0x04),
      }));
      return rows === undefined ? {} : { deviceRows: rows };
    }
    case 0x08: {
      const rows = rowsOf(bytes, at, size, 0x08, 0x0c, (row) => ({
        baseAddress: u32(bytes, row),
        sizeLimit: u32(bytes, row + 0x04),
        flags: u32(bytes, row + 0x08),
      }));
      return rows === undefined ? {} : { mmioRows: rows };
    }
    case 0x09: {
      const rows = rowsOf(bytes, at, size, 0x0c, 0x18, (row) => ({
        name: asciiTag(bytes, row, 12),
        accessMode: u16(bytes, row + 0x0c),
        userID: u16(bytes, row + 0x0e),
        groupID: u16(bytes, row + 0x10),
        minorNumber: u8(bytes, row + 0x12),
        reserved0: u8(bytes, row + 0x13),
        reserved1: u32(bytes, row + 0x14),
      }));
      if (rows === undefined) return {};
      return {
        specialFiles: {
          majorNumber: u16(bytes, at + 0x08),
          flags: u16(bytes, at + 0x0a),
          rows,
        },
      };
    }
    case 0x0b: {
      const rows = rowsOf(bytes, at, size, 0x08, 0x08, (row) => ({
        rangeBase: u32(bytes, row),
        rangeSize: u32(bytes, row + 0x04),
      }));
      return rows === undefined ? {} : { lockedRanges: rows };
    }
    case 0x0d: {
      // The newer families write a shorter row with no working directory in it.
      const shortRow = family === "csme12" || family === "csme15";
      const rows = rowsOf(bytes, at, size, 0x08, shortRow ? 0x10 : 0x34, (row) => ({
        userID: u16(bytes, row),
        reserved: u16(bytes, row + 0x02),
        nvStorageQuota: u32(bytes, row + 0x04),
        ramStorageQuota: u32(bytes, row + 0x08),
        wopQuota: u32(bytes, row + 0x0c),
        workingDirectory: shortRow ? undefined : asciiTag(bytes, row + 0x10, 36),
      }));
      return rows === undefined ? {} : { userInfoRows: rows };
    }
    default:
      // The init script and every tag this does not know: the envelope is the
      // whole of what is claimed, and it is still worth showing.
      return {};
  }
}

function decodePartitionInfo(
  bytes: Uint8Array,
  at: number,
  tag: number,
  revised: boolean
): Partial<CPDExtension> {
  const headerLength = revised ? 0x68 : 0x58;
  if (!has(bytes, at, headerLength)) return {};

  const hashLength = revised ? 48 : 32;
  // The two tags put the same facts in different places: the first keeps its
  // hash early and its version late, the second the other way round.
  const isFirst = tag === 0x03;
  const versionBase = isFirst ? (revised ? 0x44 : 0x34) : 0x10;
  const hashAt = isFirst ? 0x10 : 0x24;
  return {
    partitionInfo: {
      partitionName: asciiTag(bytes, at + 0x08, 4),
      partitionSize: u32(bytes, at + 0x0c),
      vcn: isFirst ? u32(bytes, at + (revised ? 0x40 : 0x30)) : undefined,
      versionMajor: u16(bytes, at + versionBase + 2),
      versionMinor: u16(bytes, at + versionBase),
      dataFormatMajor: u16(bytes, at + versionBase + 6),
      dataFormatMinor: u16(bytes, at + versionBase + 4),
      instanceID: u32(bytes, at + (isFirst ? (revised ? 0x4c : 0x3c) : 0x18)),
      flags: u32(bytes, at + (isFirst ? (revised ? 0x50 : 0x40) : 0x1c)),
      hash: hexAt(bytes, at + hashAt, hashLength),
    },
  };
}

function decodeProcessAttributes(
  bytes: Uint8Array,
  at: number,
  size: number
): Partial<CPDExtension> {
  const headerLength = 0x44;
  if (!has(bytes, at, headerLength) || size < headerLength) return {};
  const flags = u32(bytes, at + 0x08);
  const bit = (shift: number) => ((flags >>> shift) & 1) !== 0;
  const groupIDs: number[] = [];
  for (let index = 0; index < Math.floor((size - headerLength) / 2); index++) {
    groupIDs.push(u16(bytes, at + headerLength + index * 2));
  }
  return {
    processAttributes: {
      faultTolerant: bit(0),
      permanentProcess: bit(1),
      singleInstance: bit(2),
      trustedSendReceiveSender: bit(3),
      trustedNotifySender: bit(4),
      publicSendReceiveReceiver: bit(5),
      publicNotifyReceiver: bit(6),
      flagsReserved: flags >>> 7,
      mainThreadID: u32(bytes, at + 0x0c),
      codeBaseAddress: u32(bytes, at + 0x10),
      codeSizeUncompressed: u32(bytes, at + 0x14),
      cm0HeapSize: u32(bytes, at + 0x18),
      bssSize: u32(bytes, at + 0x1c),
      defaultHeapSize: u32(bytes, at + 0x20),
      mainThreadEntry: u32(bytes, at + 0x24),
      allowedSysCalls: [0, 1, 2].map((index) => u32(bytes, at + 0x28 + index * 4)),
      userID: u16(bytes, at + 0x34),
      groupIDs,
    },
  };
}

/** The rows filling a block behind its header, or nothing when it is short. */
function rowsOf<T>(
  bytes: Uint8Array,
  at: number,
  size: number,
  headerLength: number,
  stride: number,
  read: (row: number) => T
): T[] | undefined {
  if (!has(bytes, at, headerLength) || size < headerLength) return undefined;
  const rows: T[] = [];
  for (let index = 0; index < Math.floor((size - headerLength) / stride); index++) {
    rows.push(read(at + headerLength + index * stride));
  }
  return rows;
}

const hexAt = (bytes: Uint8Array, at: number, length: number): string => {
  const read = slice(bytes, at, length);
  return read === undefined ? "" : hex(read);
};

// MARK: - What the chain adds up to

/**
 * The facts the health rows read, taken from the last block of each kind that
 * carries one — the same last-wins walk upstream's own does.
 */
export interface ExtensionFacts {
  readonly arbSvn: number | undefined;
  /** The first partition-information tag's version control number. */
  readonly vcnFromPartitionInfo: number | undefined;
  readonly vcnFromSignedPackage: number | undefined;
  readonly nvmCompatibility: number | undefined;
  readonly workstation: boolean | undefined;
}

export function extensionFacts(extensions: readonly CPDExtension[]): ExtensionFacts {
  let arbSvn: number | undefined;
  let vcnFromPartitionInfo: number | undefined;
  let vcnFromSignedPackage: number | undefined;
  let nvmCompatibility: number | undefined;
  let workstation: boolean | undefined;

  for (const extension of extensions) {
    const signed = extension.signedPackage;
    if (signed !== undefined) {
      arbSvn = signed.arbSvn;
      vcnFromSignedPackage = signed.vcn;
      // Only the revised header has this field, and it is written from inside
      // that revision's branch alone — so an unrevised block later in the chain
      // leaves what a revised one before it found, rather than clearing it.
      if (signed.nvmCompatibility !== undefined) nvmCompatibility = signed.nvmCompatibility;
    }
    if (extension.tag === 0x03 && extension.partitionInfo?.vcn !== undefined) {
      vcnFromPartitionInfo = extension.partitionInfo.vcn;
    }
    if (extension.clientSystemInfo !== undefined) {
      workstation = extension.clientSystemInfo.workstation;
    }
  }
  return { arbSvn, vcnFromPartitionInfo, vcnFromSignedPackage, nvmCompatibility, workstation };
}
