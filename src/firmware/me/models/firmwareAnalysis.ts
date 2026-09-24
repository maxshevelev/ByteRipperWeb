import type { ManifestFormat } from "@/firmware/me/layout/manifest";
import type {
  EFSVolume,
  MFSBackup,
  MFSPCHInit,
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
import type { UnlockTokenFlags } from "@/firmware/me/partition/unlockToken";

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

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Severity */
export type IssueSeverity = "note" | "warning" | "error";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Issue */
export interface Issue {
  /**
   * Upstream's own numbering, so a message can be traced back to its check.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Issue.id
   */
  readonly id: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Issue.severity */
  readonly severity: IssueSeverity;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Issue.message */
  readonly message: string;
  /**
   * The module a module check raised the issue about, so a panel can put it on
   * that module's row. Undefined for an issue about the image.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Issue.module
   */
  readonly module?: string | undefined;
}

/**
 * Facts read from the *operational* manifest — the copy identified against the database.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary
 */
export interface ManifestSummary {
  /**
   * Absolute: the region's own base plus the struct's offset in it.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.offset
   */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.tag */
  readonly tag: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.format */
  readonly format: ManifestFormat;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.major */
  readonly major: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.build */
  readonly build: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.svn */
  readonly svn: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.day */
  readonly day: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.month */
  readonly month: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.year */
  readonly year: number;
  readonly pvBit: boolean;
  readonly debugSigned: boolean;
  /**
   * The uppercase digests that key the database's rows.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.keyHash
   */
  readonly keyHash: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.signatureHash */
  readonly signatureHash: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.vcn */
  readonly vcn: number | undefined;
  /**
   * Production Ready: the manifest's own flag on a CSE manifest, and on a
   * pre-CSE one the bit in the `$DAT` marker past it — nothing where an ME 2–7
   * carries no marker, which is why the console prints no row for one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManifestSummary.productionReady
   */
  readonly productionReady: boolean | undefined;
}

/**
 * One module of the operational partition's directory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule
 */
export interface CPDModuleRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule.isHuffman */
  readonly isHuffman: boolean;
  /**
   * The module's own extension chain, when its body carries one: a `.met`
   * companion's body *is* a chain, whose leading 0x0A block describes the module
   * it accompanies, and the manifest module's row repeats the partition's chain.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CPDModule.extensions
   */
  readonly extensions?: readonly CPDExtension[];
}

/**
 * The `$CPD` that owns the operational manifest.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition
 */
export interface CodePartition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.headerVersion */
  readonly headerVersion: number;
  /**
   * 0x10 for revision 1, 0x14 for revision 2.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.headerLength
   */
  readonly headerLength: number;
  readonly numModules: number;
  /**
   * Nothing when the region is too short to cover the whole directory.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.checksumValid
   */
  readonly checksumValid: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.modules */
  readonly modules: readonly CPDModuleRow[];
  /**
   * The extension chain of the manifest's own module.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CodePartition.extensions
   */
  readonly extensions: readonly CPDExtension[];
}

/**
 * One slot of the CSE Layout Table's inventory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutPartition
 */
export interface CSELayoutPartition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutPartition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutPartition.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutPartition.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutPartition.empty */
  readonly empty: boolean;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable */
export interface CSELayoutTable {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable.version */
  readonly version: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable.redundancy */
  readonly redundancy: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable.checksumValid */
  readonly checksumValid: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#CSELayoutTable.partitions */
  readonly partitions: readonly CSELayoutPartition[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition */
export interface BPDTEntryRow {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition.type */
  readonly type: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDTPartition.empty */
  readonly empty: boolean;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT */
export interface BootPartition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.partitionName */
  readonly partitionName: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.version */
  readonly version: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.redundancy */
  readonly redundancy: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.checksumValid */
  readonly checksumValid: boolean | undefined;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.fitMajor
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.fitMinor
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.fitHotfix
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.fitBuild
   * @upstream-differs one FITVersion, not four fields
   */
  readonly fit: FITVersion | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BPDT.entries */
  readonly entries: readonly BPDTEntryRow[];
}

/**
 * One row of a classic ME `$MME` module directory, as stored. The new header
 * (ME 6–10) carries the size, memory and entry fields and a 32-byte hash; the old
 * one (ME 2–5) the four version words, a GUID, a 20-byte hash and one size. The
 * other shape's fields are absent — the two never mix in one directory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule
 */
export interface MMEModule {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.hashHex */
  readonly hashHex: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.guidHex */
  readonly guidHex: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.modBase */
  readonly modBase: number | undefined;
  /**
   * The module's content offset from the `$MN2`, recorded rather than resolved.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.offsetMN2
   */
  readonly offsetMN2: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.sizeUncompressed */
  readonly sizeUncompressed: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.sizeCompressed */
  readonly sizeCompressed: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.memorySize */
  readonly memorySize: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.preUmaSize */
  readonly preUmaSize: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.entryPoint */
  readonly entryPoint: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.flags */
  readonly flags: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.majorVersion */
  readonly majorVersion: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.minorVersion */
  readonly minorVersion: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.hotfixVersion */
  readonly hotfixVersion: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.buildVersion */
  readonly buildVersion: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModule.size */
  readonly size: number | undefined;
}

/**
 * The multi-chip-package header after an ME 8–10 `$MME` directory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader
 */
export interface MCPHeader {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.headerSize */
  readonly headerSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.codeSize */
  readonly codeSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.offsetCodeMN2 */
  readonly offsetCodeMN2: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.offsetPartFPT */
  readonly offsetPartFPT: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MCPHeader.hashHex */
  readonly hashHex: string;
}

/**
 * A classic ME manifest's `$MME` module directory.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory
 */
export interface MMEModuleDirectory {
  /**
   * Absolute position of the list head.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory.offset
   */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory.manifestTag */
  readonly manifestTag: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory.declaredModules */
  readonly declaredModules: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory.modules */
  readonly modules: readonly MMEModule[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MMEModuleDirectory.mcp */
  readonly mcp: MCPHeader | undefined;
}

/**
 * The three lower words of an ME version, which is what a blacklist entry records.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version3
 */
export interface Version3 {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version3.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version3.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version3.build */
  readonly build: number;
}

/**
 * The newest ME 7.0 and 7.1 firmware an ME 7 image refuses to be downgraded to.
 * Either is absent where that line blacklists nothing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DowngradeBlacklist
 */
export interface DowngradeBlacklist {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DowngradeBlacklist.sevenZero */
  readonly sevenZero: Version3 | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#DowngradeBlacklist.sevenOne */
  readonly sevenOne: Version3 | undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis */
export interface FirmwareAnalysis {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.family */
  readonly family: FirmwareFamily;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.variant */
  readonly variant: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.version */
  readonly version: MEVersion;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.securityVersion */
  readonly securityVersion: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.release */
  readonly release: ReleaseType;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.type */
  readonly type: FirmwareType;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.chipsetStepping */
  readonly chipsetStepping: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.platform */
  readonly platform: string | undefined;
  /**
   * How much was handed to the engine.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.sizeBytes
   */
  readonly sizeBytes: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.databaseName */
  readonly databaseName: string | undefined;
  /**
   * Nothing when the signature could not be checked at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.rsaSignatureValid
   */
  readonly rsaSignatureValid: boolean | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.regions */
  readonly regions: readonly FPTRegionRow[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.manifest */
  readonly manifest: ManifestSummary | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.codePartition */
  readonly codePartition: CodePartition | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.cseLayoutTable */
  readonly cseLayoutTable: CSELayoutTable | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.bootPartitions */
  readonly bootPartitions: readonly BootPartition[] | undefined;
  /**
   * The Flash Image Tool version of a non-IFWI image, where it has one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.fptHeaderFIT
   */
  readonly fptHeaderFIT: FITVersion | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.powerDownMitigation */
  readonly powerDownMitigation: string | undefined;
  /**
   * The anti-rollback security version number the chain records, when it
   * carries one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.arbSvn
   */
  readonly arbSvn: number | undefined;
  /**
   * The version control number. The partition-information block is preferred
   * where there is one, since it is the partition's own; the signed package's
   * is the fallback, and a pre-CSE manifest keeps its own in its struct.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.vcn
   */
  readonly vcn: number | undefined;
  /**
   * Which storage this firmware is compatible with, as the raw two-bit field.
   * A number rather than a label: "UFS" and "SPI" are display text, and which
   * words to use is the panel's decision.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.nvmCompatibility
   */
  readonly nvmCompatibility: number | undefined;
  /**
   * Whether the firmware supports the workstation platform.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.workstationSupport
   */
  readonly workstationSupport: boolean | undefined;
  /**
   * The SKU row: a pre-CSE image's `$SKU`, an independent firmware's chipset
   * SKU, or a CSME's composed "Consumer H".
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.sku
   */
  readonly sku: string | undefined;
  /**
   * How far the firmware reaches from its `$FPT` — the Size the console prints —
   * which is not `sizeBytes`, how much was handed over. Nothing where the answer
   * needs a leg that is not ported.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.firmwareSizeBytes
   */
  readonly firmwareSizeBytes: number | undefined;
  /**
   * A classic ME manifest's `$MME` directory.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.mmeDirectory
   */
  readonly mmeDirectory: MMEModuleDirectory | undefined;
  /**
   * Whether an ME 7 supports the Patsburg chipset.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.patsburgSupport
   */
  readonly patsburgSupport: boolean | undefined;
  /**
   * ME 7's downgrade blacklist; nothing for anything else, or when both lines are empty.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.downgradeBlacklist
   */
  readonly downgradeBlacklist: DowngradeBlacklist | undefined;
  /**
   * OEM Configuration: an OEM-signed key module or a populated OEM or unlock
   * partition. Nothing where no firmware was identified.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.oemCustomized
   */
  readonly oemCustomized: boolean | undefined;
  /**
   * Whether FWUpdate can update the image in place; CSME 12 and newer only.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.fwUpdateSupport
   */
  readonly fwUpdateSupport: FWUpdateSupport | undefined;
  /**
   * The independent firmware stitched into this image — a PMC, a PCHC, a PHY —
   * each analysed in its own right over its own partition's bytes, in the order
   * the console prints their tables. Their `type` means nothing and their issues
   * stay with them. Only the image handed to the analyzer looks for these.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.independentFirmware
   */
  readonly independentFirmware: readonly FirmwareAnalysis[] | undefined;
  /**
   * The MFS volume, when an FPT "MFS" partition decodes as one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.mfsVolume
   */
  readonly mfsVolume: MFSVolume | undefined;
  /**
   * Chipset Initialization Tables (row 6a, upstream `pch_init_final`): the
   * image's *final* answer, after every Intel Configuration that carries one
   * has been read in upstream's own order — the MFS volume's low-level file 6
   * first, then the FTPR `$CPD` module `intl.cfg`, which replaces it with
   * whatever it yields, nothing included (MEA.py 5999–6009).
   *
   * Distinct from `mfsVolume.pchInit`, which stays what *that volume* held: on
   * a CSME 15/16 image the volume holds nothing at all and this is the only
   * chipset there is, and where both exist and disagree this one is the answer
   * the Chipset row and the Chipset Support gate read.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.chipsetInit
   */
  readonly chipsetInit: MFSPCHInit | undefined;
  /**
   * An MFS backup area: an "MFSB" partition, or a main MFS region in backup state.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.mfsBackup
   */
  readonly mfsBackup: MFSBackup | undefined;
  /**
   * The EFS volume's structural facts, from an FPT "EFS" partition.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.efsVolume
   */
  readonly efsVolume: EFSVolume | undefined;
  /**
   * The FITC partition's header and integrity facts.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.oemConfiguration
   */
  readonly oemConfiguration: OEMConfiguration | undefined;
  /**
   * The `UTFL` flags a `UTOK`/`STKN` partition ends with — undefined where no
   * such partition carries them, which is the format's own optional case and
   * not a row saying so.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.unlockTokenFlags
   */
  readonly unlockTokenFlags: readonly UnlockTokenFlags[] | undefined;
  /**
   * File System State: what the file system says about itself, raised by any
   * configuration partition. Answered for every identified image; which families
   * print the row is the panel's decision.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.mfsState
   */
  readonly mfsState: MFSState | undefined;
  /**
   * A GSC image's INFO partition.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.gscInfo
   */
  readonly gscInfo: GSCInfo | undefined;
  /**
   * An OROM image's option ROMs.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.oromImages
   */
  readonly oromImages: readonly GSCOROMImage[] | undefined;
  /**
   * The operational partition's `pm` / `rbe` module metadata table.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.rbePmMetadata
   */
  readonly rbePmMetadata: readonly RBEPMMetadata[] | undefined;
  /**
   * The hashes the `pm` / `rbe` module metadata tables list that no module of
   * the image hashes to (upstream's leftover report, MEA.py 5814) — most often
   * an encrypted module, which cannot be hashed as it is loaded, such as NFTP
   * `pavp`. Uppercase hex, in table order. Empty when every hash is accounted
   * for; undefined when no table was read.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.unmatchedMetadataHashes
   */
  readonly unmatchedMetadataHashes: readonly string[] | undefined;
  /**
   * On an independent firmware: the other places its very bytes are stored — the
   * boot partition that holds CSE Redundancy's backup of Boot 1 ("Boot 2") —
   * which upstream lists as tables of their own and this engine folds into the
   * one table. Undefined when it is stored once.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.redundantCopies
   */
  readonly redundantCopies: readonly string[] | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.issues */
  readonly issues: readonly Issue[];
}

/**
 * The region's own digests, which `analyze` leaves out: they are the caller's to
 * ask for, with `checksums`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Checksums
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Checksums.init
 */
export interface Checksums {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Checksums.sha256 */
  readonly sha256: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Checksums.sha384 */
  readonly sha384: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Checksums.crc32 */
  readonly crc32: number | undefined;
}
