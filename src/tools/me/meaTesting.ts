import type { MFSBackup, MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import type {
  BootPartition,
  CodePartition,
  FirmwareAnalysis,
  ManifestSummary,
} from "@/firmware/me/models/firmwareAnalysis";

/**
 * Analyses built by hand for the ME panel's tests — the minimum identity every
 * analysis carries, with whatever a test needs laid over it. The same shape
 * upstream's JSON fixtures decode to.
 */
export function analysisWith(overrides: Partial<FirmwareAnalysis> = {}): FirmwareAnalysis {
  return {
    family: "csme",
    variant: "CSME",
    version: {
      major: 15,
      minor: 40,
      hotfix: 37,
      build: 3121,
      meMajor: undefined,
      meMinor: undefined,
      meHotfix: undefined,
      meBuild: undefined,
    },
    securityVersion: undefined,
    release: "production",
    type: "region",
    chipsetStepping: undefined,
    platform: undefined,
    sizeBytes: 0x20_0000,
    databaseName: undefined,
    rsaSignatureValid: undefined,
    regions: [],
    manifest: undefined,
    codePartition: undefined,
    cseLayoutTable: undefined,
    bootPartitions: undefined,
    fptHeaderFIT: undefined,
    powerDownMitigation: undefined,
    arbSvn: undefined,
    vcn: undefined,
    nvmCompatibility: undefined,
    workstationSupport: undefined,
    sku: undefined,
    firmwareSizeBytes: undefined,
    mmeDirectory: undefined,
    patsburgSupport: undefined,
    downgradeBlacklist: undefined,
    oemCustomized: undefined,
    fwUpdateSupport: undefined,
    independentFirmware: undefined,
    mfsVolume: undefined,
    mfsBackup: undefined,
    efsVolume: undefined,
    oemConfiguration: undefined,
    mfsState: undefined,
    gscInfo: undefined,
    oromImages: undefined,
    rbePmMetadata: undefined,
    unmatchedMetadataHashes: undefined,
    redundantCopies: undefined,
    issues: [],
    ...overrides,
  };
}

export function versionWith(
  major: number,
  minor: number,
  hotfix: number,
  build: number,
  meu?: readonly [number, number, number, number]
): FirmwareAnalysis["version"] {
  return {
    major,
    minor,
    hotfix,
    build,
    meMajor: meu?.[0],
    meMinor: meu?.[1],
    meHotfix: meu?.[2],
    meBuild: meu?.[3],
  };
}

export const manifestFixture = (): ManifestSummary => ({
  offset: 0x1000,
  tag: "$MN2",
  format: "r1",
  major: 15,
  minor: 40,
  hotfix: 37,
  build: 3121,
  svn: 3,
  day: 24,
  month: 3,
  year: 2021,
  pvBit: true,
  debugSigned: false,
  keyHash: "ABCDEF",
  signatureHash: "0123456789ABCDEF",
  vcn: undefined,
  productionReady: true,
});

export const bootFixture = (fit: boolean): BootPartition => ({
  partitionName: "Boot 1",
  offset: 0x100,
  version: 2,
  redundancy: true,
  checksumValid: true,
  fit: fit ? { major: 12, minor: 0, hotfix: 3, build: 1091 } : undefined,
  entries: [{ name: "FTPR", type: 2, offset: 0x5_9000, size: 0x12_5000, empty: false }],
});

/** A `$CPD` at 0x1000 whose module offsets are absolute, as the analyzer reports them. */
export const codePartitionFixture = (
  extensions: CodePartition["extensions"] = [{ tag: 0x01, size: 0x8, offset: 0x1040 }]
): CodePartition => ({
  name: "FTPR",
  offset: 0x1000,
  headerVersion: 1,
  headerLength: 0x10,
  numModules: 1,
  checksumValid: true,
  modules: [{ name: "$MN2", offset: 0x1010, size: 0x284, isHuffman: false }],
  extensions,
});

/**
 * A legacy MFS volume with one present file, and the chipset initialisation
 * aggregate when a test wants one.
 */
export function mfsVolumeFixture(chipset?: { name: string; steppings: string }): MFSVolume {
  return {
    offset: 0x7_0000,
    pageSize: 0x1000,
    pageCount: 0x40,
    systemPageCount: 1,
    dataPageCount: 0x3f,
    signatureValid: true,
    volumeSize: 0x4_0000,
    computedVolumeSize: 0x3_e800,
    fileRecordCount: 0x40,
    usedFileCount: 3,
    ftblDictionary: 0,
    ftblPlatform: 0,
    ftblReserved: 0,
    usesFTBL: false,
    presentFileCount: 1,
    fileBytes: 0x200,
    files: [{ index: 0, size: 0x200 }],
    configurations: [],
    homeDirectory: undefined,
    reservedIntegrity: [],
    pchInit:
      chipset === undefined
        ? undefined
        : { records: [], chipsets: [{ chipset: chipset.name, steppings: chipset.steppings }] },
  };
}

/** An R1 MFS backup with one Intel Configuration entry. */
export const mfsBackupFixture = (): MFSBackup => ({
  offset: 0x7_0000,
  format: "r1",
  headerCRCStored: 0x1234_abcd,
  headerCRCValid: true,
  reservedAllFF: undefined,
  reconstructedVolumeParses: undefined,
  headerRevision: 1,
  headerRevisionValid: true,
  entries: [
    {
      fileIndex: 6,
      blobOffset: 0x20,
      blobSize: 0x100,
      revision: 1,
      revisionValid: true,
      headerCRCStored: 0x1111,
      headerCRCValid: true,
      dataSize: 0x80,
      dataCRCStored: 0x2222,
      dataCRCValid: true,
    },
  ],
});
