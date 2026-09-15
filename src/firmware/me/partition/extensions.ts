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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Family
 */
export type ExtensionFamily = "base" | "csme12" | "csme15";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.family */
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

/**
 * Whether a tag's header is the revised one for this family.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.headerRevTag
 * @upstream-differs answers whether the tag's revised header applies, rather than naming the revision
 */
export function isRevisedHeader(tag: number, family: ExtensionFamily): boolean {
  if (family === "csme15") return [0x00, 0x03, 0x0a, 0x0f, 0x16].includes(tag);
  if (family === "csme12") return tag === 0x0f;
  return false;
}

// MARK: - What each block says

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SystemInfoExtension */
export interface SystemInfoExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SystemInfoExtension.minUMASize */
  readonly minUMASize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SystemInfoExtension.chipsetVersion */
  readonly chipsetVersion: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SystemInfoExtension.pageableUMASize */
  readonly pageableUMASize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SystemInfoExtension.imageHash */
  readonly imageHash: string;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FeaturePermissionsExtension */
export interface FeaturePermissionsExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FeaturePermissionsExtension.moduleCount */
  readonly moduleCount: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension */
export interface PartitionInfoExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.partitionName */
  readonly partitionName: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.partitionSize */
  readonly partitionSize: number;
  /**
   * Only the first of the two partition-information tags carries one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.vcn
   */
  readonly vcn: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.versionMajor */
  readonly versionMajor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.versionMinor */
  readonly versionMinor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.dataFormatMajor */
  readonly dataFormatMajor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.dataFormatMinor */
  readonly dataFormatMinor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.instanceID */
  readonly instanceID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PartitionInfoExtension.hash */
  readonly hash: string;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension */
export interface ClientSystemInfoExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.skuCaps */
  readonly skuCaps: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.cseSize */
  readonly cseSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.skuType */
  readonly skuType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.workstation */
  readonly workstation: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.m3 */
  readonly m3: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.m0 */
  readonly m0: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.skuPlatform */
  readonly skuPlatform: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ClientSystemInfoExtension.siClass */
  readonly siClass: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension */
export interface SignedPackageExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.partitionName */
  readonly partitionName: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.vcn */
  readonly vcn: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.usageBitmap */
  readonly usageBitmap: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.arbSvn */
  readonly arbSvn: number;
  /**
   * The revised header's three extra fields; absent on the original.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.fwType
   */
  readonly fwType: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.fwSku */
  readonly fwSku: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SignedPackageExtension.nvmCompatibility */
  readonly nvmCompatibility: number | undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension */
export interface ModuleAttributesExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.compression */
  readonly compression: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.encryption */
  readonly encryption: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.uncompressedSize */
  readonly uncompressedSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.compressedSize */
  readonly compressedSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.deviceID */
  readonly deviceID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.vendorID */
  readonly vendorID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ModuleAttributesExtension.moduleHash */
  readonly moduleHash: string;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension */
export interface SharedLibraryExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension.contextSize */
  readonly contextSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension.totalAllocatedVirtSpace */
  readonly totalAllocatedVirtSpace: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension.codeBaseAddress */
  readonly codeBaseAddress: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension.tlsSize */
  readonly tlsSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SharedLibraryExtension.reserved */
  readonly reserved: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension */
export interface ProcessAttributesExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.faultTolerant */
  readonly faultTolerant: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.permanentProcess */
  readonly permanentProcess: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.singleInstance */
  readonly singleInstance: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.trustedSendReceiveSender */
  readonly trustedSendReceiveSender: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.trustedNotifySender */
  readonly trustedNotifySender: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.publicSendReceiveReceiver */
  readonly publicSendReceiveReceiver: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.publicNotifyReceiver */
  readonly publicNotifyReceiver: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.flagsReserved */
  readonly flagsReserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.mainThreadID */
  readonly mainThreadID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.codeBaseAddress */
  readonly codeBaseAddress: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.codeSizeUncompressed */
  readonly codeSizeUncompressed: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.cm0HeapSize */
  readonly cm0HeapSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.bssSize */
  readonly bssSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.defaultHeapSize */
  readonly defaultHeapSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.mainThreadEntry */
  readonly mainThreadEntry: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.allowedSysCalls */
  readonly allowedSysCalls: readonly number[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.userID */
  readonly userID: number;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessAttributesExtension.rows
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessGroupIDRow
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ProcessGroupIDRow.groupID
   * @upstream-differs the group IDs as a plain list, not rows
   */
  readonly groupIDs: readonly number[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadRow */
export interface ThreadRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadRow.stackSize */
  readonly stackSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadRow.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadRow.schedulingPolicy */
  readonly schedulingPolicy: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadRow.reserved */
  readonly reserved: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DeviceRow */
export interface DeviceRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DeviceRow.deviceID */
  readonly deviceID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DeviceRow.reserved */
  readonly reserved: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangeRow */
export interface MmioRangeRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangeRow.baseAddress */
  readonly baseAddress: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangeRow.sizeLimit */
  readonly sizeLimit: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangeRow.flags */
  readonly flags: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow */
export interface SpecialFileRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.accessMode */
  readonly accessMode: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.userID */
  readonly userID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.groupID */
  readonly groupID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.minorNumber */
  readonly minorNumber: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.reserved0 */
  readonly reserved0: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFileRow.reserved1 */
  readonly reserved1: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFilesExtension */
export interface SpecialFilesExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFilesExtension.majorNumber */
  readonly majorNumber: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFilesExtension.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#SpecialFilesExtension.rows */
  readonly rows: readonly SpecialFileRow[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#LockedRangeRow */
export interface LockedRangeRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#LockedRangeRow.rangeBase */
  readonly rangeBase: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#LockedRangeRow.rangeSize */
  readonly rangeSize: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow */
export interface UserInfoRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.userID */
  readonly userID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.reserved */
  readonly reserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.nvStorageQuota */
  readonly nvStorageQuota: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.ramStorageQuota */
  readonly ramStorageQuota: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.wopQuota */
  readonly wopQuota: number;
  /**
   * Only the older row layout carries one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoRow.workingDirectory
   */
  readonly workingDirectory: string | undefined;
}

/**
 * One block of the chain: its envelope, and whatever of it was understood.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension
 */
export interface CPDExtension {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.tag */
  readonly tag: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.size */
  readonly size: number;
  /**
   * Absolute, so it matches every other offset the analysis reports.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.offset
   */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.systemInfo */
  readonly systemInfo?: SystemInfoExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.featurePermissions */
  readonly featurePermissions?: FeaturePermissionsExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.partitionInfo */
  readonly partitionInfo?: PartitionInfoExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.clientSystemInfo */
  readonly clientSystemInfo?: ClientSystemInfoExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.signedPackage */
  readonly signedPackage?: SignedPackageExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.moduleAttributes */
  readonly moduleAttributes?: ModuleAttributesExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.sharedLibrary */
  readonly sharedLibrary?: SharedLibraryExtension;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.processAttributes */
  readonly processAttributes?: ProcessAttributesExtension;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.threadAttributes
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadAttributesExtension
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ThreadAttributesExtension.rows
   * @upstream-differs the rows sit on the extension directly, without a wrapper per block type
   */
  readonly threadRows?: readonly ThreadRow[];
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.deviceTypes
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DeviceTypesExtension
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DeviceTypesExtension.rows
   */
  readonly deviceRows?: readonly DeviceRow[];
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.mmioRanges
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangesExtension
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MmioRangesExtension.rows
   */
  readonly mmioRows?: readonly MmioRangeRow[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.specialFiles */
  readonly specialFiles?: SpecialFilesExtension;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.lockedRanges
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#LockedRangesExtension
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#LockedRangesExtension.rows
   */
  readonly lockedRanges?: readonly LockedRangeRow[];
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDExtension.userInfo
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoExtension
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UserInfoExtension.rows
   */
  readonly userInfoRows?: readonly UserInfoRow[];
}

// MARK: - Walking the chain

/**
 * The chain of a manifest module: the manifest struct is skipped, since the
 * chain begins where it ends.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.decode
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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.decodeMetBody
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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist
 */
export interface ExtensionFacts {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist.arbSvn */
  readonly arbSvn: number | undefined;
  /**
   * The first partition-information tag's version control number.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist.vcn03
   */
  readonly vcnFromPartitionInfo: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist.vcn0F */
  readonly vcnFromSignedPackage: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist.nvm */
  readonly nvmCompatibility: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.Hoist.workstation */
  readonly workstation: boolean | undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/Extensions.swift#CPDExtensionParser.hoist */
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
