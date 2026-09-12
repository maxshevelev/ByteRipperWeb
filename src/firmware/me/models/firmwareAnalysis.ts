import type { ManifestFormat } from "@/firmware/me/layout/manifest";
import type {
  FITVersion,
  FirmwareFamily,
  FirmwareType,
  FPTRegionRow,
  MEVersion,
  ReleaseType,
} from "@/firmware/me/models/firmwareFacts";

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
}

/** One module of the operational partition's directory. */
export interface CPDModuleRow {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly isHuffman: boolean;
}

/** The `$CPD` that owns the operational manifest. */
export interface CodePartition {
  readonly name: string;
  readonly offset: number;
  readonly headerVersion: number;
  readonly numModules: number;
  /** Nothing when the region is too short to cover the whole directory. */
  readonly checksumValid: boolean | undefined;
  readonly modules: readonly CPDModuleRow[];
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
  readonly issues: readonly Issue[];
}
