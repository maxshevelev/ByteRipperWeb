import type { ManifestFormat } from "@/firmware/me/layout/manifest";
import type {
  EFSVolume,
  MFSBackup,
  MFSVolume,
  OEMConfiguration,
} from "@/firmware/me/models/fileSystemFacts";
import type {
  FITVersion,
  FirmwareFamily,
  FirmwareType,
  FPTRegionRow,
  FWUpdateSupport,
  MEVersion,
  MFSState,
  ReleaseType,
} from "@/firmware/me/models/firmwareFacts";
import type { GSCInfo, GSCOROMImage, RBEPMMetadata } from "@/firmware/me/models/independentFacts";
import type { CPDExtension } from "@/firmware/me/partition/extensions";

/**
 * What an ME analysis reports.
 *
 * Every field that could not be determined is *absent* rather than defaulted.
 * That is the rule this whole half is built on: a firmware whose key the
 * database does not list has an unknown family, not a guessed one, and a panel
 * showing "Unknown" is telling the truth where a panel showing the nearest match
 * would not.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

export type IssueSeverity = "note" | "warning" | "error";

export interface Issue {
  /** Upstream's own numbering, so a message can be traced back to its check. */
  readonly id: number;
  readonly severity: IssueSeverity;
  readonly message: string;
}

/** Facts read from the *operational* manifest — the copy identified against the database. */
export interface ManifestSummary {
  /** Absolute: the region's own base plus the struct's offset in it. */
  readonly offset: number;
  readonly tag: string;
  readonly format: ManifestFormat;
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
  readonly svn: number;
  readonly day: number;
  readonly month: number;
  readonly year: number;
  readonly pvBit: boolean;
  readonly debugSigned: boolean;
  /** The uppercase digests that key the database's rows. */
  readonly keyHash: string | undefined;
  readonly signatureHash: string | undefined;
  readonly vcn: number | undefined;
  /**
   * Production Ready: the manifest's own flag on a CSE manifest, and on a
   * pre-CSE one the bit in the `$DAT` marker past it — nothing where an ME 2–7
   * carries no marker, which is why the console prints no row for one.
   */
  readonly productionReady: boolean | undefined;
}

/** One module of the operational partition's directory. */
export interface CPDModuleRow {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly isHuffman: boolean;
  /**
   * The module's own extension chain, when its body carries one: a `.met`
   * companion's body *is* a chain, whose leading 0x0A block describes the module
   * it accompanies, and the manifest module's row repeats the partition's chain.
   */
  readonly extensions?: readonly CPDExtension[];
}

/** The `$CPD` that owns the operational manifest. */
export interface CodePartition {
  readonly name: string;
  readonly offset: number;
  readonly headerVersion: number;
  /** 0x10 for revision 1, 0x14 for revision 2. */
  readonly headerLength: number;
  readonly numModules: number;
  /** Nothing when the region is too short to cover the whole directory. */
  readonly checksumValid: boolean | undefined;
  readonly modules: readonly CPDModuleRow[];
  /** The extension chain of the manifest's own module. */
  readonly extensions: readonly CPDExtension[];
}

/** One slot of the CSE Layout Table's inventory. */
export interface CSELayoutPartition {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly empty: boolean;
}

export interface CSELayoutTable {
  readonly offset: number;
  readonly version: number;
  readonly redundancy: boolean;
  readonly checksumValid: boolean | undefined;
  readonly partitions: readonly CSELayoutPartition[];
}

export interface BPDTEntryRow {
  readonly name: string;
  readonly type: number;
  readonly offset: number;
  readonly size: number;
  readonly empty: boolean;
}

export interface BootPartition {
  readonly partitionName: string;
  readonly offset: number;
  readonly version: number;
  readonly redundancy: boolean;
  readonly checksumValid: boolean | undefined;
  readonly fit: FITVersion | undefined;
  readonly entries: readonly BPDTEntryRow[];
}

/**
 * One row of a classic ME `$MME` module directory, as stored. The new header
 * (ME 6–10) carries the size, memory and entry fields and a 32-byte hash; the old
 * one (ME 2–5) the four version words, a GUID, a 20-byte hash and one size. The
 * other shape's fields are absent — the two never mix in one directory.
 */
export interface MMEModule {
  readonly name: string;
  readonly hashHex: string;
  readonly guidHex: string | undefined;
  readonly modBase: number | undefined;
  /** The module's content offset from the `$MN2`, recorded rather than resolved. */
  readonly offsetMN2: number | undefined;
  readonly sizeUncompressed: number | undefined;
  readonly sizeCompressed: number | undefined;
  readonly memorySize: number | undefined;
  readonly preUmaSize: number | undefined;
  readonly entryPoint: number | undefined;
  readonly flags: number;
  readonly majorVersion: number | undefined;
  readonly minorVersion: number | undefined;
  readonly hotfixVersion: number | undefined;
  readonly buildVersion: number | undefined;
  readonly size: number | undefined;
}

/** The multi-chip-package header after an ME 8–10 `$MME` directory. */
export interface MCPHeader {
  readonly offset: number;
  readonly headerSize: number;
  readonly codeSize: number;
  readonly offsetCodeMN2: number;
  readonly offsetPartFPT: number;
  readonly hashHex: string;
}

/** A classic ME manifest's `$MME` module directory. */
export interface MMEModuleDirectory {
  /** Absolute position of the list head. */
  readonly offset: number;
  readonly manifestTag: string;
  readonly declaredModules: number;
  readonly modules: readonly MMEModule[];
  readonly mcp: MCPHeader | undefined;
}

/** The three lower words of an ME version, which is what a blacklist entry records. */
export interface Version3 {
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}

/**
 * The newest ME 7.0 and 7.1 firmware an ME 7 image refuses to be downgraded to.
 * Either is absent where that line blacklists nothing.
 */
export interface DowngradeBlacklist {
  readonly sevenZero: Version3 | undefined;
  readonly sevenOne: Version3 | undefined;
}

export interface FirmwareAnalysis {
  readonly family: FirmwareFamily;
  readonly variant: string;
  readonly version: MEVersion;
  readonly securityVersion: string | undefined;
  readonly release: ReleaseType;
  readonly type: FirmwareType;
  readonly chipsetStepping: string | undefined;
  readonly platform: string | undefined;
  /** How much was handed to the engine. */
  readonly sizeBytes: number;
  readonly databaseName: string | undefined;
  /** Nothing when the signature could not be checked at all. */
  readonly rsaSignatureValid: boolean | undefined;
  readonly regions: readonly FPTRegionRow[];
  readonly manifest: ManifestSummary | undefined;
  readonly codePartition: CodePartition | undefined;
  readonly cseLayoutTable: CSELayoutTable | undefined;
  readonly bootPartitions: readonly BootPartition[] | undefined;
  /** The Flash Image Tool version of a non-IFWI image, where it has one. */
  readonly fptHeaderFIT: FITVersion | undefined;
  readonly powerDownMitigation: string | undefined;
  /**
   * The anti-rollback security version number the chain records, when it
   * carries one.
   */
  readonly arbSvn: number | undefined;
  /**
   * The version control number. The partition-information block is preferred
   * where there is one, since it is the partition's own; the signed package's
   * is the fallback, and a pre-CSE manifest keeps its own in its struct.
   */
  readonly vcn: number | undefined;
  /**
   * Which storage this firmware is compatible with, as the raw two-bit field.
   * A number rather than a label: "UFS" and "SPI" are display text, and which
   * words to use is the panel's decision.
   */
  readonly nvmCompatibility: number | undefined;
  /** Whether the firmware supports the workstation platform. */
  readonly workstationSupport: boolean | undefined;
  /**
   * The SKU row: a pre-CSE image's `$SKU`, an independent firmware's chipset
   * SKU, or a CSME's composed "Consumer H".
   */
  readonly sku: string | undefined;
  /**
   * How far the firmware reaches from its `$FPT` — the Size the console prints —
   * which is not `sizeBytes`, how much was handed over. Nothing where the answer
   * needs a leg that is not ported.
   */
  readonly firmwareSizeBytes: number | undefined;
  /** A classic ME manifest's `$MME` directory. */
  readonly mmeDirectory: MMEModuleDirectory | undefined;
  /** Whether an ME 7 supports the Patsburg chipset. */
  readonly patsburgSupport: boolean | undefined;
  /** ME 7's downgrade blacklist; nothing for anything else, or when both lines are empty. */
  readonly downgradeBlacklist: DowngradeBlacklist | undefined;
  /**
   * OEM Configuration: an OEM-signed key module or a populated OEM or unlock
   * partition. Nothing where no firmware was identified.
   */
  readonly oemCustomized: boolean | undefined;
  /** Whether FWUpdate can update the image in place; CSME 12 and newer only. */
  readonly fwUpdateSupport: FWUpdateSupport | undefined;
  /**
   * The independent firmware stitched into this image — a PMC, a PCHC, a PHY —
   * each analysed in its own right over its own partition's bytes, in the order
   * the console prints their tables. Their `type` means nothing and their issues
   * stay with them. Only the image handed to the analyzer looks for these.
   */
  readonly independentFirmware: readonly FirmwareAnalysis[] | undefined;
  /** The MFS volume, when an FPT "MFS" partition decodes as one. */
  readonly mfsVolume: MFSVolume | undefined;
  /** An MFS backup area: an "MFSB" partition, or a main MFS region in backup state. */
  readonly mfsBackup: MFSBackup | undefined;
  /** The EFS volume's structural facts, from an FPT "EFS" partition. */
  readonly efsVolume: EFSVolume | undefined;
  /** The FITC partition's header and integrity facts. */
  readonly oemConfiguration: OEMConfiguration | undefined;
  /**
   * File System State: what the file system says about itself, raised by any
   * configuration partition. Answered for every identified image; which families
   * print the row is the panel's decision.
   */
  readonly mfsState: MFSState | undefined;
  /** A GSC image's INFO partition. */
  readonly gscInfo: GSCInfo | undefined;
  /** An OROM image's option ROMs. */
  readonly oromImages: readonly GSCOROMImage[] | undefined;
  /** The operational partition's `pm` / `rbe` module metadata table. */
  readonly rbePmMetadata: readonly RBEPMMetadata[] | undefined;
  readonly issues: readonly Issue[];
}
