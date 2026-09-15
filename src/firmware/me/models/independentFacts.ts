/**
 * What the analysis reports about the graphics and option-ROM firmware, and the
 * metadata table of the power-management module.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

/**
 * `GSC_Info_FWI` — the GSC firmware image header of an INFO partition.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage
 */
export interface GSCFirmwareImage {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.project */
  readonly project: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.build */
  readonly build: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.gscMajor */
  readonly gscMajor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.gscMinor */
  readonly gscMinor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.gscHotfix */
  readonly gscHotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.gscBuild */
  readonly gscBuild: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.fwType */
  readonly fwType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.fwSku */
  readonly fwSku: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.arbSvn */
  readonly arbSvn: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.tcbSvn */
  readonly tcbSvn: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.vcn */
  readonly vcn: number;
}

/**
 * `GSC_Info_IUP` — one independent update partition row.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition
 */
export interface GSCIUPPartition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition.reserved */
  readonly reserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition.svn */
  readonly svn: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCIUPPartition.vcn */
  readonly vcn: number;
}

/**
 * A GSC image's INFO partition.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo
 */
export interface GSCInfo {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo.revision */
  readonly revision: number;
  /**
   * Anything but 1 is upstream's "unknown revision" — and it decodes anyway.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo.revisionValid
   */
  readonly revisionValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo.image */
  readonly image: GSCFirmwareImage;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCInfo.iupPartitions */
  readonly iupPartitions: readonly GSCIUPPartition[];
}

/**
 * `GSC_OROM_Header`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader
 */
export interface GSCOROMHeader {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.signature */
  readonly signature: number;
  /**
   * In 512-byte blocks.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.imageSize
   */
  readonly imageSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.initFuncEntryPoint */
  readonly initFuncEntryPoint: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.subSystem */
  readonly subSystem: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.machineType */
  readonly machineType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.compressionType */
  readonly compressionType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.reserved */
  readonly reserved: bigint;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.efiImageOffset */
  readonly efiImageOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.pciDataHeaderOffset */
  readonly pciDataHeaderOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.oromPayloadOffset */
  readonly oromPayloadOffset: number;
}

/**
 * `GSC_OROM_PCI_Data` — the PCIR header.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData
 */
export interface GSCOROMPCIData {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.signature */
  readonly signature: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.vendorID */
  readonly vendorID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.deviceID */
  readonly deviceID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.deviceListPointer */
  readonly deviceListPointer: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.pciDataHeaderLength */
  readonly pciDataHeaderLength: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.pciDataHeaderRevision */
  readonly pciDataHeaderRevision: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.classCode */
  readonly classCode: number;
  /**
   * In 512-byte blocks.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.imageSize
   */
  readonly imageSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.revisionLevel */
  readonly revisionLevel: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.codeType */
  readonly codeType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.lastImage */
  readonly lastImage: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.maxRuntimeImageLength */
  readonly maxRuntimeImageLength: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.configUtilityCodeHeaderPointer */
  readonly configUtilityCodeHeaderPointer: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMPCIData.dmtfCLPEntryPointPointer */
  readonly dmtfCLPEntryPointPointer: number;
}

/**
 * One option ROM image an OROM region carries.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage
 */
export interface GSCOROMImage {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage.header */
  readonly header: GSCOROMHeader;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage.pciData */
  readonly pciData: GSCOROMPCIData;
  /**
   * Where the payload starts past the headers.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage.payloadOffset
   */
  readonly payloadOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMImage.payloadIsCPD */
  readonly payloadIsCPD: boolean;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMVariant */
export type RBEPMVariant = "r1" | "r2" | "r3" | "r4";

/**
 * One row of the `pm` / `rbe` module's metadata table. R1 and R3 carry the six
 * extended fields; R2 and R4 stop after the compressed size. The hash is printed
 * as upstream prints it: the digest read as one little-endian integer.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata
 */
export interface RBEPMMetadata {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.variant */
  readonly variant: RBEPMVariant;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.unknown0 */
  readonly unknown0: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.deviceID */
  readonly deviceID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.vendorID */
  readonly vendorID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.sizeUncompressed */
  readonly sizeUncompressed: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.sizeCompressed */
  readonly sizeCompressed: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.bssSize */
  readonly bssSize: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.codeSizeUncompressed */
  readonly codeSizeUncompressed: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.codeBaseAddress */
  readonly codeBaseAddress: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.mainThreadEntry */
  readonly mainThreadEntry: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.unknown1 */
  readonly unknown1: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.unknown2 */
  readonly unknown2: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#RBE_PMMetadata.hash */
  readonly hash: string;
}

/**
 * The GSC version, or "N/A" where its major is 0 or 0xFFFF.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCFirmwareImage.versionText
 */
export function gscVersionText(image: GSCFirmwareImage): string {
  if (image.gscMajor === 0 || image.gscMajor === 0xffff) return "N/A";
  return `${image.gscMajor}.${image.gscMinor}.${image.gscHotfix}.${image.gscBuild}`;
}

/**
 * The image size in bytes: 512 per block.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GSCOROMHeader.imageSizeBytes
 */
export const oromImageSizeBytes = (header: GSCOROMHeader): number => header.imageSize * 512;
