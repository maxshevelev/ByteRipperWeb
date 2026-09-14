/**
 * What the analysis reports about the graphics and option-ROM firmware, and the
 * metadata table of the power-management module.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

/** `GSC_Info_FWI` — the GSC firmware image header of an INFO partition. */
export interface GSCFirmwareImage {
  readonly project: string;
  readonly hotfix: number;
  readonly build: number;
  readonly gscMajor: number;
  readonly gscMinor: number;
  readonly gscHotfix: number;
  readonly gscBuild: number;
  readonly flags: number;
  readonly fwType: number;
  readonly fwSku: number;
  readonly arbSvn: number;
  readonly tcbSvn: number;
  readonly vcn: number;
}

/** `GSC_Info_IUP` — one independent update partition row. */
export interface GSCIUPPartition {
  readonly name: string;
  readonly flags: number;
  readonly reserved: number;
  readonly svn: number;
  readonly vcn: number;
}

/** A GSC image's INFO partition. */
export interface GSCInfo {
  readonly offset: number;
  readonly revision: number;
  /** Anything but 1 is upstream's "unknown revision" — and it decodes anyway. */
  readonly revisionValid: boolean;
  readonly image: GSCFirmwareImage;
  readonly iupPartitions: readonly GSCIUPPartition[];
}

/** `GSC_OROM_Header`. */
export interface GSCOROMHeader {
  readonly signature: number;
  /** In 512-byte blocks. */
  readonly imageSize: number;
  readonly initFuncEntryPoint: number;
  readonly subSystem: number;
  readonly machineType: number;
  readonly compressionType: number;
  readonly reserved: bigint;
  readonly efiImageOffset: number;
  readonly pciDataHeaderOffset: number;
  readonly oromPayloadOffset: number;
}

/** `GSC_OROM_PCI_Data` — the PCIR header. */
export interface GSCOROMPCIData {
  readonly signature: string;
  readonly vendorID: number;
  readonly deviceID: number;
  readonly deviceListPointer: number;
  readonly pciDataHeaderLength: number;
  readonly pciDataHeaderRevision: number;
  readonly classCode: number;
  /** In 512-byte blocks. */
  readonly imageSize: number;
  readonly revisionLevel: number;
  readonly codeType: number;
  readonly lastImage: boolean;
  readonly maxRuntimeImageLength: number;
  readonly configUtilityCodeHeaderPointer: number;
  readonly dmtfCLPEntryPointPointer: number;
}

/** One option ROM image an OROM region carries. */
export interface GSCOROMImage {
  readonly offset: number;
  readonly header: GSCOROMHeader;
  readonly pciData: GSCOROMPCIData;
  /** Where the payload starts past the headers. */
  readonly payloadOffset: number;
  readonly payloadIsCPD: boolean;
}

export type RBEPMVariant = "r1" | "r2" | "r3" | "r4";

/**
 * One row of the `pm` / `rbe` module's metadata table. R1 and R3 carry the six
 * extended fields; R2 and R4 stop after the compressed size. The hash is printed
 * as upstream prints it: the digest read as one little-endian integer.
 */
export interface RBEPMMetadata {
  readonly variant: RBEPMVariant;
  readonly unknown0: number;
  readonly deviceID: number;
  readonly vendorID: number;
  readonly sizeUncompressed: number;
  readonly sizeCompressed: number;
  readonly bssSize: number | undefined;
  readonly codeSizeUncompressed: number | undefined;
  readonly codeBaseAddress: number | undefined;
  readonly mainThreadEntry: number | undefined;
  readonly unknown1: number | undefined;
  readonly unknown2: number | undefined;
  readonly hash: string;
}

/** The GSC version, or "N/A" where its major is 0 or 0xFFFF. */
export function gscVersionText(image: GSCFirmwareImage): string {
  if (image.gscMajor === 0 || image.gscMajor === 0xffff) return "N/A";
  return `${image.gscMajor}.${image.gscMinor}.${image.gscHotfix}.${image.gscBuild}`;
}

/** The image size in bytes: 512 per block. */
export const oromImageSizeBytes = (header: GSCOROMHeader): number => header.imageSize * 512;
