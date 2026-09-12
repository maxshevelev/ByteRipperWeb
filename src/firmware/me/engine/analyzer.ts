import { hex, sha256 } from "@/firmware/me/crypto/digest";
import { validateSignature } from "@/firmware/me/crypto/rsa";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import { classifyFirmwareType, fptHeaderFIT } from "@/firmware/me/engine/firmwareTypeClassifier";
import { selectOperationalManifest } from "@/firmware/me/engine/manifestSelection";
import { identify } from "@/firmware/me/identify/identifier";
import { parseFirstFpt } from "@/firmware/me/layout/fpt";
import { bpdtTable, findBpdt } from "@/firmware/me/layout/ifwi";
import {
  type Manifest,
  manifestProtectedData,
  parseManifestCandidates,
} from "@/firmware/me/layout/manifest";
import type {
  BootPartition,
  CodePartition,
  FirmwareAnalysis,
  Issue,
  ManifestSummary,
} from "@/firmware/me/models/firmwareAnalysis";
import {
  cpdChecksumValid,
  cpdEntries,
  cpdModuleContentEnd,
  findPrecedingCpd,
  trailingEmptyCpdEntries,
} from "@/firmware/me/partition/cpd";

/**
 * Analyses one engine region.
 *
 * The pipeline is single-pass with one dependency: the structures that need no
 * database decode first, and the identification step is handed one — so a region
 * with no manifest never needs the network at all, and one that does is read
 * exactly once.
 *
 * The region's own digests are deliberately *not* taken here: three passes over
 * the whole buffer to answer three detail rows were about two thirds of the work
 * of a parse upstream. A caller that is going to show them asks for them.
 *
 * Ported from `Packages/MEFirmware/Engine/MEFirmwareAnalyzer.swift`.
 */

export function analyzeMeRegion(options: {
  readonly bytes: Uint8Array;
  /** Where the region sits inside the caller's own file. */
  readonly baseOffset?: number;
  /** Absent means the analysis runs without one, and identifies nothing. */
  readonly database?: MEADatabase;
}): FirmwareAnalysis {
  const bytes = options.bytes;
  const baseOffset = options.baseOffset ?? 0;
  const database = options.database ?? MEADatabase.empty;
  const issues: Issue[] = [];

  // MARK: The partition table and what sits around it

  const fpt = parseFirstFpt(bytes);
  const regions = (fpt?.partitions ?? []).map((partition, index) => ({
    index,
    name: partition.name,
    offset: baseOffset + partition.offset,
    size: partition.size,
    flags: partition.flags,
  }));

  const layout = fpt?.cseLayout;
  const cseLayoutTable =
    layout === undefined
      ? undefined
      : {
          offset: baseOffset + layout.base,
          version: layout.version,
          redundancy: layout.redundancy,
          checksumValid: layout.checksumValid,
          partitions: layout.slots.map((slot) => ({
            name: slot.name,
            offset: baseOffset + slot.offset,
            size: slot.size,
            empty: slot.empty,
          })),
        };
  if (layout?.version === 0x17 && layout.checksumValid === false) {
    issues.push({
      id: 10,
      severity: "warning",
      message:
        "Checksum of the IFWI 1.7 CSE Layout Table at " +
        `0x${(baseOffset + layout.base).toString(16)} is INVALID.`,
    });
  }

  // Each non-empty boot partition opens with a descriptor table of the
  // sub-partitions packed inside it. A pre-IFWI engine has neither.
  const bootPartitions: BootPartition[] = [];
  for (const slot of layout?.slots ?? []) {
    if (!slot.name.startsWith("Boot") || slot.empty) continue;
    const high = Math.min(slot.offset + slot.size, bytes.length);
    const base = findBpdt(bytes, slot.offset, high);
    if (base === undefined) continue;
    const info = bpdtTable(bytes, base, slot.name);
    if (info === undefined) continue;
    bootPartitions.push({
      partitionName: info.partitionName,
      offset: baseOffset + info.base,
      version: info.version,
      redundancy: info.redundancy,
      checksumValid: info.checksumValid,
      fit:
        info.fitMajor === undefined
          ? undefined
          : {
              major: info.fitMajor,
              minor: info.fitMinor ?? 0,
              hotfix: info.fitHotfix ?? 0,
              build: info.fitBuild ?? 0,
            },
      entries: info.slots.map((one) => ({
        name: one.name,
        type: one.type,
        offset: baseOffset + one.offset,
        size: one.size,
        empty: one.empty,
      })),
    });
  }
  const isIFWI = bootPartitions.length > 0;

  // MARK: The operational manifest

  const candidates = parseManifestCandidates(bytes);
  const manifest = selectOperationalManifest({ candidates, fpt, bytes });
  const manifestSummary = manifest === undefined ? undefined : summarize(manifest, baseOffset);

  // MARK: The directory that owns it

  let codePartition: CodePartition | undefined;
  if (manifest !== undefined) {
    const owner = findPrecedingCpd(bytes, manifest.base);
    if (owner !== undefined) {
      const header = owner.header;
      const entries = cpdEntries(bytes, header);
      const checksumValid = cpdChecksumValid(bytes, header);
      if (checksumValid === false) {
        issues.push({
          id: 4,
          severity: "warning",
          message: `Checksum of $CPD partition "${header.partitionName}" is INVALID.`,
        });
      }
      const trailing = trailingEmptyCpdEntries(bytes, header);
      if (trailing > 0) {
        issues.push({
          id: 5,
          severity: "note",
          message:
            `$CPD partition "${header.partitionName}" has ${trailing} empty trailing module ` +
            `${trailing === 1 ? "entry" : "entries"} beyond its declared count ` +
            `(${header.numModules}).`,
        });
      }
      const contentEnd = cpdModuleContentEnd(header, entries);
      if (contentEnd > bytes.length) {
        issues.push({
          id: 6,
          severity: "warning",
          message:
            `Modules of $CPD partition "${header.partitionName}" extend past the end of the ` +
            `region (content end 0x${contentEnd.toString(16)} > region size ` +
            `0x${bytes.length.toString(16)}).`,
        });
      }
      codePartition = {
        name: header.partitionName,
        offset: baseOffset + header.base,
        headerVersion: header.headerVersion,
        numModules: header.numModules,
        checksumValid,
        modules: entries.map((entry) => ({
          name: entry.name,
          offset: baseOffset + header.base + entry.offset,
          size: entry.size,
          isHuffman: entry.isHuffman,
        })),
      };
    }
  }

  // MARK: The signature

  const rsaSignatureValid = manifest === undefined ? undefined : signatureVerdict(manifest, bytes);

  if (fpt === undefined) {
    issues.push({
      id: 1,
      severity: "note",
      message: "No $FPT partition table found in the region.",
    });
  }
  if (rsaSignatureValid === false) {
    issues.push({
      id: 9,
      severity: "error",
      message:
        `RSA Signature of ${manifest?.tag ?? "manifest"} at ` +
        `0x${(baseOffset + (manifest?.base ?? 0)).toString(16)} is INVALID.`,
    });
  }

  const structural = {
    sizeBytes: bytes.length,
    regions,
    manifest: manifestSummary,
    codePartition,
    cseLayoutTable,
    bootPartitions: bootPartitions.length > 0 ? bootPartitions : undefined,
  };

  // Nothing to identify, and nothing to identify it against: the structural
  // facts are the whole answer, and they needed no database to reach.
  if (manifest === undefined) {
    return {
      family: "unknown",
      variant: "",
      version: {
        major: 0,
        minor: 0,
        hotfix: 0,
        build: 0,
        meMajor: undefined,
        meMinor: undefined,
        meHotfix: undefined,
        meBuild: undefined,
      },
      securityVersion: undefined,
      release: "unknown",
      type: "region",
      chipsetStepping: undefined,
      platform: undefined,
      databaseName: undefined,
      rsaSignatureValid: undefined,
      fptHeaderFIT: undefined,
      powerDownMitigation: undefined,
      issues,
      ...structural,
    };
  }

  // MARK: Identification

  const hasRomBypass = regions.some(
    (one) =>
      one.name === "ROMB" &&
      one.size !== 0 &&
      one.size !== 0xffff_ffff &&
      one.offset !== 0xffff_ffff
  );
  const identity = identify({
    manifest,
    database,
    hasRomBypass,
    moduleNames: codePartition?.modules.map((one) => one.name) ?? [],
  });

  if (!identity.identified) {
    issues.push({
      id: 2,
      severity: "note",
      message:
        "RSA public key not found in the firmware database; variant could not be determined.",
    });
  } else if (identity.databaseName === undefined) {
    issues.push({ id: 3, severity: "note", message: "This firmware is not in the database." });
  }

  const type = classifyFirmwareType({
    family: identity.family,
    major: identity.major,
    isIFWI,
    fpt,
    bytes,
  });

  return {
    family: identity.family,
    variant: identity.variant,
    version: {
      major: identity.major,
      minor: identity.minor,
      hotfix: identity.hotfix,
      build: identity.build,
      meMajor: identity.meMajor,
      meMinor: identity.meMinor,
      meHotfix: identity.meHotfix,
      meBuild: identity.meBuild,
    },
    securityVersion: identity.securityVersion,
    release: identity.release,
    type,
    chipsetStepping: identity.chipsetStepping,
    platform: undefined,
    databaseName: identity.databaseName,
    rsaSignatureValid,
    fptHeaderFIT: fptHeaderFIT({
      family: identity.family,
      major: identity.major,
      type,
      fpt,
      isIFWI,
    }),
    powerDownMitigation: identity.powerDownMitigation,
    issues,
    ...structural,
  };
}

function summarize(manifest: Manifest, baseOffset: number): ManifestSummary {
  return {
    offset: baseOffset + manifest.base,
    tag: manifest.tag,
    format: manifest.format,
    major: manifest.major,
    minor: manifest.minor,
    hotfix: manifest.hotfix,
    build: manifest.build,
    svn: manifest.svn,
    day: manifest.day,
    month: manifest.month,
    year: manifest.year,
    pvBit: manifest.pvBit,
    debugSigned: manifest.debugSigned,
    keyHash: manifest.rsaPublicKey === undefined ? undefined : hex(sha256(manifest.rsaPublicKey)),
    signatureHash:
      manifest.rsaSignature === undefined ? undefined : hex(sha256(manifest.rsaSignature)),
    vcn: manifest.vcn,
  };
}

/**
 * Whether the manifest's signature checks out.
 *
 * Nothing when it cannot be checked at all — no key material, a window the
 * region does not hold, or a modulus that is not one. That is a different
 * answer from "invalid", and a panel that ran them together would call a
 * synthetic image corrupt.
 */
function signatureVerdict(manifest: Manifest, bytes: Uint8Array): boolean | undefined {
  const key = manifest.rsaPublicKey;
  const signature = manifest.rsaSignature;
  const exponent = manifest.rsaExponent;
  if (key === undefined || signature === undefined || exponent === undefined) return undefined;
  const protectedData = manifestProtectedData(bytes, manifest);
  if (protectedData === undefined) return undefined;
  return validateSignature({
    tag: manifest.tag,
    publicKey: key,
    exponent,
    signature,
    protectedData,
  })?.valid;
}
