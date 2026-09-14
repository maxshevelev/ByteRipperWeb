/**
 * What the CSE file systems report: the MFS volume and its backup area, the EFS
 * volume and the FITC OEM configuration beside it.
 *
 * Structural facts only. Naming the files of a file-table volume, and reading the
 * FITC's configuration records, needs `FileTable.dat` — which upstream has not
 * ported either — so these stop where the bytes stop saying things on their own.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

/** One present low-level MFS file: its index and the size of its assembled chain. */
export interface MFSFile {
  readonly index: number;
  readonly size: number;
}

/** One `MFS_Config_Record_0x1C` of a legacy Intel or OEM Configuration tree. */
export interface MFSConfigRecord {
  readonly name: string;
  readonly isFolder: boolean;
  readonly size: number;
  /** Where a file's content sits inside the owning low-level file. */
  readonly offset: number;
  readonly unixRights: number;
  readonly integrityProtection: boolean;
  readonly encryptionProtection: boolean;
  readonly antiReplayProtection: boolean;
  readonly oemConfigurable: boolean;
  readonly mcaConfigurable: boolean;
  readonly reserved: number;
  readonly ownerUserID: number;
  readonly ownerGroupID: number;
}

/** A decoded legacy configuration stream: file 6 (Intel) or 7 (OEM). */
export interface MFSConfiguration {
  readonly owningFile: number;
  readonly records: readonly MFSConfigRecord[];
}

/**
 * A trailing `MFS_Integrity_Table`: 0x28 (HMAC-MD5, AES-GCM nonce) or 0x34
 * (HMAC-SHA-256, 128-bit nonce). The HMAC itself is keyed with Intel's secret and
 * cannot be verified; these are its stored fields.
 */
export interface MFSIntegrityTable {
  readonly size: number;
  readonly hmacHex: string;
  readonly flagsRaw: number;
  readonly antiReplayProtection: boolean;
  readonly encryptionProtection: boolean;
  readonly antiReplayIndex: number;
  readonly securityVersion: number;
  readonly arRandom: number;
  readonly arCounter: number;
  readonly nonceHex: string;
}

/** One file or folder row of the MFS Home Directory. */
export interface MFSHomeRecord {
  readonly fileIndex: number;
  readonly name: string;
  readonly isFolder: boolean;
  readonly fileSystemID: number;
  readonly unixRights: number;
  readonly ownerUserID: number;
  readonly ownerGroupID: number;
  readonly integrityProtection: boolean;
  readonly encryptionProtection: boolean;
  readonly antiReplayProtection: boolean;
  readonly accessUnknown0: boolean;
  readonly accessUnknown1: boolean;
  /** 0 Intel, 1 Other. */
  readonly keyType: number;
  readonly integritySalt: number;
  readonly unknownSalt: number;
  /** The pointed-to file's content length, less its trailing table where it has one. */
  readonly size: number;
  readonly integrity: MFSIntegrityTable | undefined;
  readonly children: readonly MFSHomeRecord[];
}

/**
 * File 8 of a legacy volume, decoded as the home tree it names. The `.` and `..`
 * marker rows are left out.
 */
export interface MFSHomeDirectory {
  readonly homeRecordSize: number;
  readonly rootRecordCount: number;
  readonly integrity: MFSIntegrityTable | undefined;
  readonly entries: readonly MFSHomeRecord[];
}

/** The trailing table of a reserved low-level file (1–5). */
export interface MFSReservedFileIntegrity {
  readonly fileIndex: number;
  /** The file's data length with its table removed. */
  readonly contentSize: number;
  readonly integrity: MFSIntegrityTable;
}

/** One `mphytbl*` chipset initialisation table. */
export interface MFSPCHInitRecord {
  readonly chipset: string;
  /** Empty where the identity's stepping is unreliable. */
  readonly stepping: string;
  readonly revision: number;
}

/** Each chipset the tables name, with every stepping letter they decoded, highest first. */
export interface MFSPCHInitChipset {
  readonly chipset: string;
  readonly steppings: string;
}

export interface MFSPCHInit {
  readonly records: readonly MFSPCHInitRecord[];
  readonly chipsets: readonly MFSPCHInitChipset[];
}

/** An MFS volume, from an FPT partition named "MFS". */
export interface MFSVolume {
  readonly offset: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly systemPageCount: number;
  readonly dataPageCount: number;
  /** The assembled System chunk 0 carries the volume signature. */
  readonly signatureValid: boolean;
  readonly volumeSize: number;
  readonly computedVolumeSize: number;
  readonly fileRecordCount: number;
  readonly usedFileCount: number;
  readonly ftblDictionary: number;
  readonly ftblPlatform: number;
  readonly ftblReserved: number;
  /** A file-table volume, as opposed to the legacy (1, 0, 0) layout. */
  readonly usesFTBL: boolean;
  readonly presentFileCount: number;
  readonly fileBytes: number;
  readonly files: readonly MFSFile[];
  readonly configurations: readonly MFSConfiguration[];
  readonly homeDirectory: MFSHomeDirectory | undefined;
  readonly reservedIntegrity: readonly MFSReservedFileIntegrity[];
  readonly pchInit: MFSPCHInit | undefined;
}

/** One R1 backup entry: file 6 Intel Configuration, 9 Manifest Backup or 7 OEM Configuration. */
export interface MFSBackupEntry {
  readonly fileIndex: number;
  readonly blobOffset: number;
  readonly blobSize: number;
  readonly revision: number;
  readonly revisionValid: boolean;
  readonly headerCRCStored: number;
  readonly headerCRCValid: boolean;
  readonly dataSize: number;
  readonly dataCRCStored: number;
  readonly dataCRCValid: boolean;
}

/** An MFS backup area: an "MFSB" partition, or a main MFS region in backup state. */
export interface MFSBackup {
  readonly offset: number;
  readonly format: "r0" | "r1";
  readonly headerCRCStored: number;
  readonly headerCRCValid: boolean;
  /** R0: the reserved header words are all erased, which is the R0 dispatch itself. */
  readonly reservedAllFF: boolean | undefined;
  /** R0: the compacted body rebuilds into a volume that reads as MFS. */
  readonly reconstructedVolumeParses: boolean | undefined;
  readonly headerRevision: number | undefined;
  readonly headerRevisionValid: boolean | undefined;
  readonly entries: readonly MFSBackupEntry[];
}

/** An EFS volume's structural facts, from an FPT partition named "EFS". */
export interface EFSVolume {
  readonly offset: number;
  readonly pageSize: number;
  readonly systemPageCount: number;
  readonly dataPageCount: number;
  readonly scratchPageCount: number;
  readonly scratchPagesEmpty: boolean;
  readonly dataPageCountMatchesSystem: boolean;
  readonly dictionary: number;
  readonly revision: number;
  readonly unknown1: number;
  readonly dictionaryRevision: number;
  readonly dataPagesCommitted: number;
  readonly dataPagesReserved: number;
  readonly systemHeaderCRCValid: boolean;
  readonly indexesCRCValid: boolean;
  readonly firstIndexPaddingEmpty: boolean;
  /** The System index permutation: each logical Data page's physical one. */
  readonly dataPageOrder: readonly number[];
  readonly dataPageHeaderCRCsValid: boolean;
  readonly dataPageFooterCRCsValid: boolean;
  /** Nothing when no MFS volume decoded alongside. */
  readonly matchesMFSDictionary: boolean | undefined;
}

/** The FITC OEM Configuration partition's header and integrity facts. */
export interface OEMConfiguration {
  readonly offset: number;
  readonly headerRevision: number;
  /** Revision 1: the configuration data's length. */
  readonly dataLength: number | undefined;
  readonly headerCRCStored: number | undefined;
  readonly headerCRCValid: boolean | undefined;
  readonly dataCRCStored: number | undefined;
  readonly dataCRCValid: boolean | undefined;
  /** Any other revision: the length from the first word, and whether the tail is erased. */
  readonly configLength: number | undefined;
  readonly paddingAllFF: boolean | undefined;
}
