/**
 * What the CSE file systems report: the MFS volume and its backup area, the EFS
 * volume and the FITC OEM configuration beside it.
 *
 * Facts decoded from bytes, and nothing else. What `FileTable.dat` says — a
 * file's path, an ID-keyed record's file, a name of any kind — is not here: it
 * is looked up on the way to the panel's rows (`MFSFileNames`, `EFSFileNames`,
 * `ConfigRecordPaths`), which is what keeps a database answer out of the result
 * model. What the table's *flags* unlock, though, is byte work and is here:
 * `MFSFile.contentSize`/`.integrity` and `EFSFile` are the tails it makes
 * possible to split off.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

/**
 * One present low-level MFS file: its index and the size of its assembled chain.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSFile
 */
export interface MFSFile {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSFile.index */
  readonly index: number;
  /**
   * The whole assembled FAT chain, Integrity table and all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSFile.size
   */
  readonly size: number;
  /**
   * The file's own bytes, where a trailing `MFS_Integrity_Table` was taken off
   * the end — what upstream prints as the file's Size. Undefined where nothing
   * was split: a file that carries no such table, and every file of a legacy
   * volume, whose Integrity tables are reported per reserved file and per
   * home-directory row instead (`reservedIntegrity`, `homeDirectory`).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSFile.contentSize
   */
  readonly contentSize?: number | undefined;
  /**
   * The table that came off the end, when one did (`MFSIntegrityTable.size`
   * says which of 0x28 / 0x34 / 0x38 it turned out to be).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSFile.integrity
   */
  readonly integrity?: MFSIntegrityTable | undefined;
}

/**
 * One `MFS_Config_Record_0x1C` of a legacy Intel or OEM Configuration tree.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord
 */
export interface MFSConfigRecord {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.isFolder */
  readonly isFolder: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.size */
  readonly size: number;
  /**
   * Where a file's content sits inside the owning low-level file.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.offset
   */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.unixRights */
  readonly unixRights: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.integrityProtection */
  readonly integrityProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.encryptionProtection */
  readonly encryptionProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.antiReplayProtection */
  readonly antiReplayProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.oemConfigurable */
  readonly oemConfigurable: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.mcaConfigurable */
  readonly mcaConfigurable: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.reserved */
  readonly reserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.ownerUserID */
  readonly ownerUserID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigRecord.ownerGroupID */
  readonly ownerGroupID: number;
}

/**
 * A decoded legacy configuration stream: file 6 (Intel) or 7 (OEM).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfiguration
 */
export interface MFSConfiguration {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfiguration.owningFile */
  readonly owningFile: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfiguration.records */
  readonly records: readonly MFSConfigRecord[];
}

/**
 * A trailing `MFS_Integrity_Table`: 0x28 (HMAC-MD5, AES-GCM nonce) or 0x34
 * (HMAC-SHA-256, 128-bit nonce). The HMAC itself is keyed with Intel's secret and
 * cannot be verified; these are its stored fields.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable
 */
export interface MFSIntegrityTable {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.hmacHex */
  readonly hmacHex: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.flagsRaw */
  readonly flagsRaw: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.antiReplayProtection */
  readonly antiReplayProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.encryptionProtection */
  readonly encryptionProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.antiReplayIndex */
  readonly antiReplayIndex: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.securityVersion */
  readonly securityVersion: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.arRandom */
  readonly arRandom: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.arCounter */
  readonly arCounter: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSIntegrityTable.nonceHex */
  readonly nonceHex: string;
}

/**
 * One file or folder row of the MFS Home Directory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord
 */
export interface MFSHomeRecord {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.fileIndex */
  readonly fileIndex: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.isFolder */
  readonly isFolder: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.fileSystemID */
  readonly fileSystemID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.unixRights */
  readonly unixRights: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.ownerUserID */
  readonly ownerUserID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.ownerGroupID */
  readonly ownerGroupID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.integrityProtection */
  readonly integrityProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.encryptionProtection */
  readonly encryptionProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.antiReplayProtection */
  readonly antiReplayProtection: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.accessUnknown0 */
  readonly accessUnknown0: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.accessUnknown1 */
  readonly accessUnknown1: boolean;
  /**
   * 0 Intel, 1 Other.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.keyType
   */
  readonly keyType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.integritySalt */
  readonly integritySalt: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.unknownSalt */
  readonly unknownSalt: number;
  /**
   * The pointed-to file's content length, less its trailing table where it has one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.size
   */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.integrity */
  readonly integrity: MFSIntegrityTable | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeRecord.children */
  readonly children: readonly MFSHomeRecord[];
}

/**
 * File 8 of a legacy volume, decoded as the home tree it names. The `.` and `..`
 * marker rows are left out.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeDirectory
 */
export interface MFSHomeDirectory {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeDirectory.homeRecordSize */
  readonly homeRecordSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeDirectory.rootRecordCount */
  readonly rootRecordCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeDirectory.integrity */
  readonly integrity: MFSIntegrityTable | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSHomeDirectory.entries */
  readonly entries: readonly MFSHomeRecord[];
}

/**
 * The trailing table of a reserved low-level file (1–5).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSReservedFileIntegrity
 */
export interface MFSReservedFileIntegrity {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSReservedFileIntegrity.fileIndex */
  readonly fileIndex: number;
  /**
   * The file's data length with its table removed.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSReservedFileIntegrity.contentSize
   */
  readonly contentSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSReservedFileIntegrity.integrity */
  readonly integrity: MFSIntegrityTable;
}

/**
 * One `mphytbl*` chipset initialisation table.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitRecord
 */
export interface MFSPCHInitRecord {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitRecord.chipset */
  readonly chipset: string;
  /**
   * Empty where the identity's stepping is unreliable.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitRecord.stepping
   */
  readonly stepping: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitRecord.revision */
  readonly revision: number;
}

/**
 * Each chipset the tables name, with every stepping letter they decoded, highest first.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitChipset
 */
export interface MFSPCHInitChipset {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitChipset.chipset */
  readonly chipset: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInitChipset.steppings */
  readonly steppings: string;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInit */
export interface MFSPCHInit {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInit.records */
  readonly records: readonly MFSPCHInitRecord[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSPCHInit.chipsets */
  readonly chipsets: readonly MFSPCHInitChipset[];
}

/**
 * An MFS volume, from an FPT partition named "MFS".
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume
 */
export interface MFSVolume {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.pageSize */
  readonly pageSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.pageCount */
  readonly pageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.systemPageCount */
  readonly systemPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.dataPageCount */
  readonly dataPageCount: number;
  /**
   * The assembled System chunk 0 carries the volume signature.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.signatureValid
   */
  readonly signatureValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.volumeSize */
  readonly volumeSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.computedVolumeSize */
  readonly computedVolumeSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.fileRecordCount */
  readonly fileRecordCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.usedFileCount */
  readonly usedFileCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.ftblDictionary */
  readonly ftblDictionary: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.ftblPlatform */
  readonly ftblPlatform: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.ftblReserved */
  readonly ftblReserved: number;
  /**
   * A file-table volume, as opposed to the legacy (1, 0, 0) layout.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.usesFTBL
   */
  readonly usesFTBL: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.presentFileCount */
  readonly presentFileCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.fileBytes */
  readonly fileBytes: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.files */
  readonly files: readonly MFSFile[];
  /**
   * The volume's ID-keyed (0xC) Configuration streams, where its identity says
   * its records are those. Undefined when they are 0x1C (`configurations` then
   * holds them), and when the volume carries no file 6/7 at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.configurationsByID
   */
  readonly configurationsByID?: readonly MFSConfigurationByID[] | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.configurations */
  readonly configurations: readonly MFSConfiguration[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.homeDirectory */
  readonly homeDirectory: MFSHomeDirectory | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.reservedIntegrity */
  readonly reservedIntegrity: readonly MFSReservedFileIntegrity[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSVolume.pchInit */
  readonly pchInit: MFSPCHInit | undefined;
}

/**
 * One R1 backup entry: file 6 Intel Configuration, 9 Manifest Backup or 7 OEM Configuration.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry
 */
export interface MFSBackupEntry {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.fileIndex */
  readonly fileIndex: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.blobOffset */
  readonly blobOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.blobSize */
  readonly blobSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.revision */
  readonly revision: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.revisionValid */
  readonly revisionValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.headerCRCStored */
  readonly headerCRCStored: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.headerCRCValid */
  readonly headerCRCValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.dataSize */
  readonly dataSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.dataCRCStored */
  readonly dataCRCStored: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupEntry.dataCRCValid */
  readonly dataCRCValid: boolean;
}

/**
 * An MFS backup area: an "MFSB" partition, or a main MFS region in backup state.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup
 */
export interface MFSBackup {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.offset */
  readonly offset: number;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.format
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackupFormat
   */
  readonly format: "r0" | "r1";
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.headerCRCStored */
  readonly headerCRCStored: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.headerCRCValid */
  readonly headerCRCValid: boolean;
  /**
   * R0: the reserved header words are all erased, which is the R0 dispatch itself.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.reservedAllFF
   */
  readonly reservedAllFF: boolean | undefined;
  /**
   * R0: the compacted body rebuilds into a volume that reads as MFS.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.reconstructedVolumeParses
   */
  readonly reconstructedVolumeParses: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.headerRevision */
  readonly headerRevision: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.headerRevisionValid */
  readonly headerRevisionValid: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSBackup.entries */
  readonly entries: readonly MFSBackupEntry[];
}

/**
 * An EFS volume's structural facts, from an FPT partition named "EFS".
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume
 */
export interface EFSVolume {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.pageSize */
  readonly pageSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.systemPageCount */
  readonly systemPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPageCount */
  readonly dataPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.scratchPageCount */
  readonly scratchPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.scratchPagesEmpty */
  readonly scratchPagesEmpty: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPageCountMatchesSystem */
  readonly dataPageCountMatchesSystem: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dictionary */
  readonly dictionary: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.revision */
  readonly revision: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.unknown1 */
  readonly unknown1: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dictionaryRevision */
  readonly dictionaryRevision: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPagesCommitted */
  readonly dataPagesCommitted: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPagesReserved */
  readonly dataPagesReserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.systemHeaderCRCValid */
  readonly systemHeaderCRCValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.indexesCRCValid */
  readonly indexesCRCValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.firstIndexPaddingEmpty */
  readonly firstIndexPaddingEmpty: boolean;
  /**
   * The System index permutation: each logical Data page's physical one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPageOrder
   */
  readonly dataPageOrder: readonly number[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPageHeaderCRCsValid */
  readonly dataPageHeaderCRCsValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.dataPageFooterCRCsValid */
  readonly dataPageFooterCRCsValid: boolean;
  /**
   * Nothing when no MFS volume decoded alongside.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.matchesMFSDictionary
   */
  readonly matchesMFSDictionary: boolean | undefined;
  /**
   * The volume's files, in data-area order — empty until the EFS table that
   * locates them has been read, and on a volume no table describes.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSVolume.files
   */
  readonly files: readonly EFSFile[];
}

/**
 * One file of an EFS volume (upstream's `efs_anl` file walk, MEA.py 8817).
 *
 * Where the file *is* comes from outside the flash: an EFS volume's Data pages
 * are a flat byte area with no directory in them, and the offsets that cut it
 * into files are the `EFST` records of `FileTable.dat`. What is here is what
 * those bytes then say — the file's own 4-byte metadata header, and, for a file
 * the FTBL row flags as Integrity-protected, the table it ends with and the
 * content length without it. The file's *name* and *path* are the table's own
 * text and stay out of the model (reference/result-model.md); `fileID` is the
 * number both tables key it by, which is what the panel joins on.
 *
 * `dataOffset` is an offset into the volume's assembled data area — its Data
 * pages concatenated in System-index order, each contributing the bytes between
 * its 0x10 header and 0x8 footer — and not a position in the image: a file long
 * enough to span pages occupies no one range of the dump.
 *
 * Files the volume has not written are not listed: upstream skips a metadata
 * size of 0xFFFF (never used) and a file whose metadata is longer than the table
 * claims (the table is the wrong one for this volume, and a name put on those
 * bytes would be a guess).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile
 */
export interface EFSFile {
  /**
   * The EFST/FTBL file ID — the FTBL `vfsID` the panel's name comes from.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.fileID
   */
  readonly fileID: number;
  /**
   * The file's offset into the volume's assembled data area.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.dataOffset
   */
  readonly dataOffset: number;
  /**
   * `EFS_File_Metadata.Size`: the length the file's own header states, Integrity
   * table included. Preferred over the table's length, as upstream prefers it.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.storedSize
   */
  readonly storedSize: number;
  /**
   * `EFS_File_Metadata.Unknown`, kept as the open field it is.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.metadataUnknown
   */
  readonly metadataUnknown: number;
  /**
   * The file's own bytes with the Integrity table taken off the end. Equal to
   * `storedSize` where the FTBL row flags no Integrity.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.contentSize
   */
  readonly contentSize: number;
  /**
   * The table the file ends with, where it has one and it decoded. Undefined on
   * an unprotected file — and on a protected one whose tail is too short to
   * read, which still splits (`storedSize - contentSize` is the tail).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#EFSFile.integrity
   */
  readonly integrity: MFSIntegrityTable | undefined;
}

/**
 * A decoded ID-keyed MFS Configuration stream — the 0xC branch of upstream's
 * `mfs_cfg_anl` (MEA.py 8526), which is what the newer layouts carry (CSME
 * 13–16, CSSPS 6, and the CSSPS 4.4 / 5-on-platform-10 pair) and what the FITC
 * partition's own payload is made of.
 *
 * `owningFile` is the low-level file the records came from (6 = Intel, 7 =
 * OEM). A volume's streams are all one record struct or all the other, so a
 * volume that fills this one leaves `MFSVolume.configurations` empty.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigurationByID
 */
export interface MFSConfigurationByID {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigurationByID.owningFile */
  readonly owningFile: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigurationByID.records */
  readonly records: readonly MFSConfigIDRecord[];
}

/**
 * One decoded `MFS_Config_Record_0xC` (MEA.py 1402): a configuration file
 * located by **File ID** rather than by name.
 *
 * There is no name in the record and none in the stream — the path the ID
 * stands for is a row of `FileTable.dat`'s `FTBL` table keyed by that ID
 * (`0x10002000` → `/home/ish_srv/bios2ish`), which upstream looks up before
 * writing the file out and falls back to `/Unknown/<ID>.bin` for. So the path is
 * a panel lookup (reference/result-model.md) and what is here is the record's
 * own bytes: where the content sits in the owning stream, how long it is, and
 * whether an OEM `fitc.cfg` setting may override the Intel `intl.cfg` one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord
 */
export interface MFSConfigIDRecord {
  /**
   * The FTBL table key — the record's own File ID, not a `vfsID`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord.fileID
   */
  readonly fileID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord.oemConfigurable */
  readonly oemConfigurable: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSConfigIDRecord.unknownFlags */
  readonly unknownFlags: number;
}

/**
 * The FITC OEM Configuration partition's header and integrity facts.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration
 */
export interface OEMConfiguration {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.headerRevision */
  readonly headerRevision: number;
  /**
   * Revision 1: the configuration data's length.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.dataLength
   */
  readonly dataLength: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.headerCRCStored */
  readonly headerCRCStored: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.headerCRCValid */
  readonly headerCRCValid: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.dataCRCStored */
  readonly dataCRCStored: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.dataCRCValid */
  readonly dataCRCValid: boolean | undefined;
  /**
   * Any other revision: the length from the first word, and whether the tail is erased.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.configLength
   */
  readonly configLength: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.paddingAllFF */
  readonly paddingAllFF: boolean | undefined;
  /**
   * Where the configuration payload starts in the image — the partition's own
   * offset plus its header (0x10 on revision 1, 0x04 on the alpha layout whose
   * first u32 is the length). A record's `offset` is relative to this, so the
   * two together are the record's bytes in the dump.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.payloadOffset
   */
  readonly payloadOffset: number | undefined;
  /**
   * The configuration records the payload carries, read with the record struct
   * this identity uses — ID-keyed (0xC) on every layout that ships a FITC
   * partition, and named (0x1C) only if an older identity ever did. Undefined
   * for the struct this partition does not use, and before the identity-gated
   * decode has run.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.recordsByID
   */
  readonly recordsByID?: readonly MFSConfigIDRecord[] | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMConfiguration.records */
  readonly records?: readonly MFSConfigRecord[] | undefined;
}
