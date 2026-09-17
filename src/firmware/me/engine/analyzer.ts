import { crc32 } from "@/firmware/me/crypto/checksum";
import { hex, sha256, sha384 } from "@/firmware/me/crypto/digest";
import { validateSignature } from "@/firmware/me/crypto/rsa";
import type { FileTable } from "@/firmware/me/data/fileTable";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import {
  decompressHuffman,
  dictionaryFor,
  type HuffmanDictionaries,
  type HuffmanDictionary,
} from "@/firmware/me/decompress/huffman";
import {
  decompressLzmaModule,
  lzmaHashMatches,
  STRAY_ZEROS_SIGNATURE,
} from "@/firmware/me/decompress/lzmaModule";
import { classifyFirmwareType, fptHeaderFIT } from "@/firmware/me/engine/firmwareTypeClassifier";
import {
  fwUpdateSupport,
  iupPresence,
  PCHC_PARTITION_NAMES,
  PHY_PARTITION_NAMES,
  PMC_PARTITION_NAMES,
} from "@/firmware/me/engine/fwUpdateSupport";
import { metAttributes } from "@/firmware/me/engine/huffmanNeed";
import { selectOperationalManifest } from "@/firmware/me/engine/manifestSelection";
import { fitConfiguration, oemCustomized } from "@/firmware/me/engine/oemDetector";
import { efsDataArea, efsFiles, parseEfs, parseFitc } from "@/firmware/me/fileSystem/efs";
import {
  ftblFileIntegrity,
  homeDirectory,
  type MFSVolumeInfo,
  mfsState,
  parseMfs,
  reservedIntegrity,
  vfsStartsAtZero,
} from "@/firmware/me/fileSystem/mfs";
import { parseMfsBackup } from "@/firmware/me/fileSystem/mfsBackup";
import { decodePchInit } from "@/firmware/me/fileSystem/pchInit";
import { type ChipsetInitTable, csePlatformName } from "@/firmware/me/identify/csePlatform";
import { identify } from "@/firmware/me/identify/identifier";
import {
  downgradeBlacklist,
  preCseProductionReady,
  preCseSummary,
} from "@/firmware/me/identify/preCseMe";
import { decodeMmeDirectory } from "@/firmware/me/identify/preCseModule";
import { csmeSku } from "@/firmware/me/identify/sku";
import { decodeGscInfo } from "@/firmware/me/iup/gscInfo";
import { iupFacts } from "@/firmware/me/iup/iupDescriptor";
import { decodeOromImages } from "@/firmware/me/iup/orom";
import { firmwareEndLayout } from "@/firmware/me/layout/firmwareEnd";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import { type FPTResult, parseFirstFpt } from "@/firmware/me/layout/fpt";
import { bpdtTable, findBpdt } from "@/firmware/me/layout/ifwi";
import {
  type Manifest,
  manifestProtectedData,
  parseManifestCandidates,
} from "@/firmware/me/layout/manifest";
import type {
  EFSVolume,
  MFSBackup,
  MFSVolume,
  OEMConfiguration,
} from "@/firmware/me/models/fileSystemFacts";
import type {
  BootPartition,
  Checksums,
  CodePartition,
  CPDModuleRow,
  DowngradeBlacklist,
  FirmwareAnalysis,
  Issue,
  ManifestSummary,
  MMEModuleDirectory,
} from "@/firmware/me/models/firmwareAnalysis";
import type { FPTRegionRow } from "@/firmware/me/models/firmwareFacts";
import type { GSCInfo, RBEPMMetadata } from "@/firmware/me/models/independentFacts";
import {
  cpdChecksumValid,
  cpdEntries,
  cpdModuleContentEnd,
  decodeCpdHeader,
  findPrecedingCpd,
  trailingEmptyCpdEntries,
} from "@/firmware/me/partition/cpd";
import {
  type ClientSystemInfoExtension,
  type CPDExtension,
  decodeExtensionChain,
  decodeMetadataChain,
  type ExtensionFamily,
  extensionFacts,
  extensionFamily,
} from "@/firmware/me/partition/extensions";
import { decodeRbePmMetadata } from "@/firmware/me/partition/rbePm";

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

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.analyze
 * @upstream-differs a function over the region's bytes; the database and dictionaries are passed in rather than fetched by an actor
 */
export function analyzeMeRegion(options: {
  readonly bytes: Uint8Array;
  /** Where the region sits inside the caller's own file. */
  readonly baseOffset?: number;
  /** Absent means the analysis runs without one, and identifies nothing. */
  readonly database?: MEADatabase;
  /**
   * `Huffman.dat`, for the checks that decompress a module. Absent, those checks
   * are skipped rather than failed — see `huffmanDictionariesWanted`.
   */
  readonly huffmanDictionaries?: HuffmanDictionaries;
  /**
   * `FileTable.dat`, for the two readings that wait on it: which of an FTBL
   * volume's files end with an `MFS_Integrity_Table`, and which of an EFS
   * volume's carry one. Absent, both splits are skipped rather than failed —
   * see `fileTableWanted` — because a missing database is not a finding about
   * the firmware, and a file that was not split keeps its whole chain as its
   * size, which is what the flash says.
   */
  readonly fileTable?: FileTable;
}): FirmwareAnalysis {
  return analyze(
    options.bytes,
    options.baseOffset ?? 0,
    options.database ?? MEADatabase.empty,
    options.huffmanDictionaries,
    options.fileTable,
    true
  );
}

/**
 * An FTBL-mode volume's files, split from the `MFS_Integrity_Table` they end
 * with — the one decode that waits for a database.
 *
 * **Which** of them end with one is not in the bytes: upstream reads the flag
 * out of `FTBL` before it splits a file (`mfs_home13_anl`), and an FTBL volume
 * has no home directory to carry the bit instead. So the flags are looked up,
 * the split is byte work, and what lands in the model is the tail's own numbers
 * plus the content length without it.
 *
 * Best-effort in every direction: no table — offline, rate-limited, a volume the
 * table does not describe — leaves every `contentSize` undefined and `size` the
 * whole chain, which is what the flash says. No Issue is raised, because a
 * missing database is not a finding about the firmware.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer
 */
function ftblFiles(
  volume: MFSVolume,
  info: MFSVolumeInfo,
  table: FileTable | undefined,
  identity: { readonly variant: string; readonly major: number; readonly minor: number }
): MFSVolume {
  if (table === undefined || table.isEmpty || info.files.length === 0) return volume;
  const resolution = table.resolve(info.ftblPlatform, info.ftblDictionary);
  const protectedIndices = new Set<number>();
  for (const file of info.files) {
    const record = table.recordForFileIndex(file.index, resolution.platform, resolution.dictionary);
    if (record?.integrity === true) protectedIndices.add(file.index);
  }
  const splits = ftblFileIntegrity({
    files: info.files,
    protectedIndices,
    variant: identity.variant,
    major: identity.major,
    minor: identity.minor,
    platform: info.ftblPlatform,
  });
  const byIndex = new Map(splits.map((one) => [one.fileIndex, one]));
  return {
    ...volume,
    files: volume.files.map((file) => {
      const split = byIndex.get(file.index);
      return split === undefined
        ? file
        : { ...file, contentSize: split.contentSize, integrity: split.integrity };
    }),
  };
}

/**
 * An EFS volume's files, cut out of its data area by the file table.
 *
 * Its Data pages are one flat byte area with no directory in them — the offsets
 * that cut it into files are the file table's `EFST` records, and which of those
 * files end with an Integrity table is the `FTBL` flag beside them. Upstream
 * calls that read necessary and not optional: without the flag a file's content
 * length cannot be worked out (MEA.py 8846). The platform and dictionary are the
 * *MFS* volume's, as upstream hands them to `efs_anl`; the revision is the EFS
 * System page's own.
 *
 * Best-effort like the MFS split: no table, no `EFST` for this volume, or a
 * table whose offsets the data area does not carry leaves `files` empty, which
 * is the honest answer about a volume that names nothing itself. No Issue — a
 * missing database is not a finding about the firmware.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer
 */
function efsWithFiles(
  volume: EFSVolume,
  info: MFSVolumeInfo | undefined,
  table: FileTable | undefined,
  identity: { readonly variant: string; readonly major: number; readonly minor: number },
  bytes: Uint8Array,
  baseOffset: number,
  regions: readonly { readonly name: string; readonly offset: number; readonly size: number }[]
): EFSVolume {
  if (table === undefined || table.isEmpty) return volume;
  const region = regions.find((one) => one.name === "EFS");
  if (region === undefined) return volume;
  const resolution = table.resolve(info?.ftblPlatform ?? -1, info?.ftblDictionary ?? -1);
  if (resolution.missing) return volume;
  const entries = table.efsEntries(
    resolution.platform,
    resolution.dictionary,
    volume.dictionaryRevision
  );
  if (entries === undefined || entries.length === 0) return volume;
  const integrityFileIDs = new Set<number>();
  for (const entry of entries) {
    const record = table.recordForFileIndex(
      entry.fileID,
      resolution.platform,
      resolution.dictionary
    );
    if (record?.integrity === true) integrityFileIDs.add(entry.fileID);
  }
  const area = efsDataArea(bytes, region.offset - baseOffset, region.size, volume.dataPageOrder);
  return {
    ...volume,
    files: efsFiles({
      dataArea: area,
      entries,
      integrityFileIDs,
      variant: identity.variant,
      major: identity.major,
      minor: identity.minor,
      platform: resolution.platform,
    }),
  };
}

/**
 * The analysis proper. `findsIndependentFirmware` is false for the nested runs
 * over the independent partitions this one finds, so an image cannot send the
 * analyzer looking inside its own sub-firmware for ever.
 */
function analyze(
  bytes: Uint8Array,
  baseOffset: number,
  database: MEADatabase,
  dictionaries: HuffmanDictionaries | undefined,
  fileTable: FileTable | undefined,
  findsIndependentFirmware: boolean
): FirmwareAnalysis {
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
  const cseLayoutIssues: Issue[] = [];
  if (layout?.version === 0x17 && layout.checksumValid === false) {
    cseLayoutIssues.push({
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
  const boots = layout === undefined ? undefined : bootPartitions;

  // MARK: The file systems

  const fileSystems = decodeFileSystems(bytes, baseOffset, regions);

  // A GSC image's INFO partition. Only GSC images name a partition INFO, so the
  // name gates the decode.
  let gscInfo: GSCInfo | undefined;
  const gscInfoIssues: Issue[] = [];
  const infoRegion = regions.find((one) => one.name === "INFO");
  if (infoRegion !== undefined) {
    gscInfo = decodeGscInfo(bytes, infoRegion.offset - baseOffset, infoRegion.size, baseOffset);
    if (gscInfo !== undefined && !gscInfo.revisionValid) {
      gscInfoIssues.push({
        id: 12,
        severity: "warning",
        message:
          `Unknown GSC Information Partition revision ${gscInfo.revision} at ` +
          `0x${lowerHex(infoRegion.offset)}; expected 1.`,
      });
    }
  }

  // MARK: The operational manifest

  const candidates = parseManifestCandidates(bytes);
  const manifest = selectOperationalManifest({ candidates, fpt, bytes });
  const manifestSummary =
    manifest === undefined ? undefined : summarize(manifest, bytes, baseOffset);

  // MARK: The directory that owns it

  let codePartition: CodePartition | undefined;
  let extensions: CPDExtension[] = [];
  const cpdIssues: Issue[] = [];
  if (manifest !== undefined) {
    const owner = findPrecedingCpd(bytes, manifest.base);
    if (owner !== undefined) {
      const header = owner.header;
      const entries = cpdEntries(bytes, header);
      const checksumValid = cpdChecksumValid(bytes, header);
      if (checksumValid === false) {
        cpdIssues.push({
          id: 4,
          severity: "warning",
          message: `Checksum of $CPD partition "${header.partitionName}" is INVALID.`,
        });
      }
      const trailing = trailingEmptyCpdEntries(bytes, header);
      if (trailing > 0) {
        cpdIssues.push({
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
        cpdIssues.push({
          id: 6,
          severity: "warning",
          message:
            `Modules of $CPD partition "${header.partitionName}" extend past the end of the ` +
            `region (content end 0x${contentEnd.toString(16)} > region size ` +
            `0x${bytes.length.toString(16)}).`,
        });
      }
      // The chain lives in the manifest's own module: the entry whose content
      // starts where the manifest does is the one that carries it.
      const family = extensionFamily({
        major: manifest.major,
        minor: manifest.minor,
        hotfix: manifest.hotfix,
        build: manifest.build,
        year: manifest.year,
        month: manifest.month,
        keyLength: manifest.rsaPublicKey?.length,
      });
      const manifestModule = entries.find(
        (entry) =>
          !entry.isHuffman && header.base + entry.offset === manifest.base && entry.size > 0
      );
      extensions =
        manifestModule === undefined
          ? []
          : decodeExtensionChain({
              bytes,
              moduleContentBase: manifest.base,
              moduleSize: manifestModule.size,
              chainStart: manifest.base + manifest.headerLengthBytes,
              family,
              baseOffset,
            });

      codePartition = {
        name: header.partitionName,
        offset: baseOffset + header.base,
        headerVersion: header.headerVersion,
        headerLength: header.headerLength,
        numModules: header.numModules,
        checksumValid,
        extensions,
        modules: entries.map((entry) => {
          const row = {
            name: entry.name,
            offset: baseOffset + header.base + entry.offset,
            size: entry.size,
            isHuffman: entry.isHuffman,
          };
          if (entry.isHuffman || entry.size <= 0) return row;
          // A `.met` companion — always uncompressed — has a body that is a chain
          // from its content base; the manifest module's row carries the
          // partition's own chain, so every carrier shows its blocks.
          if (entry.name.endsWith(".met")) {
            return {
              ...row,
              extensions: decodeMetadataChain({
                bytes,
                contentBase: header.base + entry.offset,
                bodySize: entry.size,
                family,
                baseOffset,
              }),
            };
          }
          return header.base + entry.offset === manifest.base ? { ...row, extensions } : row;
        }),
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
  // Upstream's order: the directory, the file systems, the layout table.
  issues.push(
    ...cpdIssues,
    ...fileSystems.mfsIssues,
    ...fileSystems.mfsBackupIssues,
    ...fileSystems.fsIssues,
    ...gscInfoIssues,
    ...cseLayoutIssues
  );
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
    bootPartitions: boots,
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
      mfsVolume: fileSystems.mfsVolume,
      mfsBackup: fileSystems.mfsBackup,
      efsVolume: fileSystems.efsVolume,
      oemConfiguration: fileSystems.oemConfiguration,
      mfsState: undefined,
      gscInfo,
      oromImages: undefined,
      rbePmMetadata: undefined,
      unmatchedMetadataHashes: undefined,
      redundantCopies: undefined,
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
  const facts = extensionFacts(extensions);
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
  // The LZMA half: every module whose `.met` advertises LZMA and no encryption
  // must decompress and match its stored hash. It needs no dictionary and no
  // database, so it runs for a firmware that was not identified too.
  if (codePartition !== undefined) {
    issues.push(...lzmaValidationIssues(codePartition, bytes, baseOffset));
  }

  // CSME 11+ SKU from the operational chain's 0x0C / 0x0F facts and the row.
  const skuText = csmeSkuText(identity, codePartition, manifest);

  // The independent families name their own chipset straight from the identity.
  const iup = iupFacts({
    family: identity.family,
    variant: identity.variant,
    major: identity.major,
    minor: identity.minor,
    hotfix: identity.hotfix,
  });

  // A classic ME's `$SKU`: no database needed once the family is named.
  const preCSE =
    identity.family === "me"
      ? preCseSummary({
          bytes,
          manifestBase: manifest.base,
          major: identity.major,
          minor: identity.minor,
          hotfix: identity.hotfix,
          build: identity.build,
        })
      : undefined;

  // A classic ME R0 manifest's `$MME` directory. One whose declared directory
  // under-decodes is noted, never repaired.
  let mmeDirectory: MMEModuleDirectory | undefined;
  if (identity.family === "me" && manifest.format === "r0") {
    mmeDirectory = decodeMmeDirectory({
      bytes,
      manifestBase: manifest.base,
      headerLengthBytes: manifest.headerLengthBytes,
      manifestTag: manifest.tag,
      declaredModules: manifest.numModules ?? 0,
      baseOffset,
    });
    if (mmeDirectory !== undefined && mmeDirectory.modules.length < mmeDirectory.declaredModules) {
      issues.push({
        id: 11,
        severity: "note",
        message:
          `Pre-CSE ${manifest.tag} module directory declares ` +
          `${mmeDirectory.declaredModules} modules but only ` +
          `${mmeDirectory.modules.length} \`$MME\` rows decoded.`,
      });
    }
  }

  // An OROM image's option ROMs.
  const oromImages = identity.family === "orom" ? decodeOromImages(bytes, baseOffset) : undefined;

  // The operational partition's `pm` / `rbe` metadata table: read straight from
  // an uncompressed body, or through the dictionary from a Huffman one.
  const rbePmMetadata =
    codePartition === undefined
      ? undefined
      : rbePmMetadataOf(codePartition, bytes, baseOffset, identity, dictionaries);

  // The Huffman half of the module checks — after the metadata table, whose
  // hashes are what a module without a `.met` is checked against. Every Huffman
  // module the directory can place is decompressed against the dictionary for
  // this identity: one with a `.met` must come out at its declared size, one
  // without must hash to a row of the table. Without the dictionary the check is
  // skipped, never failed, and an image the engine could not name has no
  // dictionary to pick.
  let unmatchedHashes: string[] | undefined;
  if (
    identity.identified &&
    codePartition !== undefined &&
    huffmanSlices(codePartition, bytes, baseOffset).length > 0
  ) {
    const family = extensionFamily({
      major: manifest.major,
      minor: manifest.minor,
      hotfix: manifest.hotfix,
      build: manifest.build,
      year: manifest.year,
      month: manifest.month,
      keyLength: manifest.rsaPublicKey?.length,
    });
    // The FTPR `pm` table's hashes, and those of every RBEP `rbe` table.
    const operational = codePartition.offset - baseOffset;
    const rbeHashes = rbeMetadataHashes(
      rbepOffsets(fpt, boots, baseOffset).filter((offset) => offset !== operational),
      bytes,
      baseOffset,
      family,
      identity,
      dictionaries
    );
    const tables = [...(rbePmMetadata ?? []).map((row) => row.hash), ...rbeHashes];
    issues.push(
      ...huffmanValidationIssues(codePartition, bytes, baseOffset, identity, dictionaries, tables)
    );

    // What the tables list that no module accounts for, over every `$CPD`
    // partition the image lists — the operational one first, each partition
    // name once (Boot 2's backup of Boot 1 adds nothing).
    if (tables.length > 0) {
      const partitions = [codePartition];
      const names = new Set([codePartition.name]);
      for (const offset of partitionOffsets(fpt, boots, baseOffset)) {
        const partition = codePartitionAtCpd(offset, bytes, baseOffset, family);
        if (partition === undefined || names.has(partition.name)) continue;
        names.add(partition.name);
        partitions.push(partition);
      }
      unmatchedHashes = unmatchedMetadataHashes(
        tables,
        partitions,
        bytes,
        baseOffset,
        usableDictionary(identity, dictionaries)
      );
    }
  }

  // Upstream's `ifwi_exist`: a non-empty Boot slot in the Layout Table, whether
  // or not its descriptor table decoded.
  const isIFWI =
    fpt?.cseLayout?.slots.some((slot) => slot.name.startsWith("Boot") && !slot.empty) === true;
  const type = classifyFirmwareType({
    family: identity.family,
    major: identity.major,
    isIFWI,
    fpt,
    bytes,
  });

  const oem = oemCustomized({
    fpt,
    bootPartitions: boots,
    codePartition,
    bytes,
    baseOffset,
  });

  // Row 18: how far the firmware reaches from its `$FPT`. The same walk answers
  // what FWUpdate Support needs to know about the image's tail.
  const endLayout =
    fpt === undefined
      ? undefined
      : firmwareEndLayout({
          bytes,
          partitions: fpt.partitions,
          fptStart: fpt.fptStart,
          cseLayout: fpt.cseLayout,
          hasFlashDescriptor: meRegion(bytes) !== undefined,
          ignores4KAlignment: identity.family === "csme" && identity.major >= 16,
        });

  const sku = preCSE?.sku ?? iup?.sku ?? skuText;
  const fwUpdate =
    endLayout === undefined
      ? undefined
      : fwUpdateSupport({
          family: identity.family,
          major: identity.major,
          minor: identity.minor,
          type,
          sku: sku ?? "",
          iup: iupPresence(fpt?.partitions ?? []),
          layout: endLayout,
          fptStart: fpt?.fptStart ?? 0,
        });

  // The legacy volume's home tree and reserved tables, and file 6's chipset
  // initialisation tables: both are laid out by the identity's variant and
  // version, so they wait for it. The home tree only on a volume whose files do
  // not start at 0; the tables on any legacy volume.
  const mfsInfo = fileSystems.mfsInfo;
  let mfsVolume = fileSystems.mfsVolume;
  if (mfsVolume !== undefined && mfsInfo !== undefined && mfsVolume.usesFTBL) {
    mfsVolume = ftblFiles(mfsVolume, mfsInfo, fileTable, identity);
  }
  // One table serves both file systems: the EFS walk needs the same file, its
  // own `EFST` half and the `FTBL` flags beside it, and the source answers the
  // second ask out of what the first fetched.
  let efsVolumeForWalk = fileSystems.efsVolume;
  if (efsVolumeForWalk !== undefined) {
    efsVolumeForWalk = efsWithFiles(
      efsVolumeForWalk,
      mfsInfo,
      fileTable,
      identity,
      bytes,
      baseOffset,
      regions
    );
  }
  if (mfsVolume !== undefined && mfsInfo !== undefined && !mfsVolume.usesFTBL) {
    const { variant, major, minor } = identity;
    if (!vfsStartsAtZero(variant, major, minor)) {
      const layoutOf = {
        files: mfsInfo.files,
        variant,
        major,
        minor,
        platform: mfsInfo.ftblPlatform,
      };
      mfsVolume = {
        ...mfsVolume,
        homeDirectory: homeDirectory(layoutOf),
        reservedIntegrity: reservedIntegrity({ ...layoutOf, isAFS: false }),
      };
    }
    mfsVolume = {
      ...mfsVolume,
      pchInit: decodePchInit(mfsInfo.files, mfsInfo.configurations, {
        variant,
        major,
        minor,
        build: identity.build,
        year: manifest.year,
        month: manifest.month,
        day: manifest.day,
      }),
    };
  }

  // The four things that raise the File System State to Configured: the Flash
  // Image Tool's own configuration module, and the three configuration
  // partitions.
  const configurationPresent =
    fitConfiguration(codePartition, bytes, baseOffset) ||
    (fpt?.partitions.some((part) => ["FITC", "CDMD", "MFSB"].includes(part.name) && !part.empty) ??
      false);
  const fileSystemState = mfsState({
    usesFTBL: mfsInfo?.usesFTBL ?? false,
    presentFileIndices: (mfsInfo?.files ?? [])
      .filter((one) => one.content.length > 0)
      .map((one) => one.index),
    hasConfiguration: configurationPresent,
  });

  // The independent firmware stitched into this image, each analysed by this
  // same pipeline over its own bytes. A partition that does not decode is left
  // out rather than reported as an empty table.
  const independent: FirmwareAnalysis[] = [];
  if (findsIndependentFirmware) {
    const merged = mergingRedundantCopies(
      independentSlots(fpt, boots, baseOffset, bytes.length),
      bytes
    );
    for (const { slot, copies } of merged.unique) {
      const one = analyze(
        bytes.subarray(slot.start, slot.end),
        baseOffset + slot.start,
        database,
        dictionaries,
        fileTable,
        false
      );
      if (one.manifest === undefined) continue;
      independent.push(copies.length > 0 ? { ...one, redundantCopies: copies } : one);
    }
    for (const differing of merged.differing) {
      issues.push({
        id: 20,
        severity: "warning",
        message:
          `Partition ${differing.name} differs between ${differing.places.join(" and ")}: ` +
          "the copies are not the same firmware.",
      });
    }
  }

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
    // An IUP image's own derived letter, else what the database records.
    chipsetStepping: iup?.chipsetStepping ?? identity.chipsetStepping,
    // A pre-CSE family and an IUP image name their own platform; a CSE one is
    // named from its version, only where no chipset initialisation table
    // already says which chipset it initialises.
    platform:
      preCSE?.platform ??
      iup?.platform ??
      csePlatformName({
        family: identity.family,
        major: identity.major,
        minor: identity.minor,
        chipsetInitTable: chipsetInitTable(mfsVolume),
      }),
    databaseName: identity.databaseName,
    arbSvn: facts.arbSvn,
    // The partition's own number where the chain gives one, then the signed
    // package's, then the pre-CSE manifest's own field.
    vcn: facts.vcnFromPartitionInfo ?? facts.vcnFromSignedPackage ?? manifest.vcn,
    nvmCompatibility: facts.nvmCompatibility,
    workstationSupport: facts.workstation,
    rsaSignatureValid,
    fptHeaderFIT: fptHeaderFIT({
      family: identity.family,
      major: identity.major,
      type,
      fpt,
      isIFWI,
    }),
    powerDownMitigation: identity.powerDownMitigation,
    sku,
    firmwareSizeBytes: endLayout?.firmwareSize,
    mmeDirectory,
    patsburgSupport: preCSE?.patsburgSupport,
    // ME 7 alone carries the two blacklist lines, at fixed offsets in its manifest.
    downgradeBlacklist:
      identity.family === "me" && identity.major === 7
        ? blacklist(bytes, manifest.base)
        : undefined,
    oemCustomized: oem,
    fwUpdateSupport: fwUpdate,
    independentFirmware: independent.length === 0 ? undefined : independent,
    mfsVolume,
    mfsBackup: fileSystems.mfsBackup,
    efsVolume: efsVolumeForWalk,
    oemConfiguration: fileSystems.oemConfiguration,
    mfsState: fileSystemState,
    gscInfo,
    oromImages,
    rbePmMetadata,
    unmatchedMetadataHashes: unmatchedHashes,
    redundantCopies: undefined,
    issues,
    ...structural,
  };
}

function summarize(manifest: Manifest, bytes: Uint8Array, baseOffset: number): ManifestSummary {
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
    // A pre-CSE ME 8–10 or TXE keeps this bit in a `$DAT` marker past the
    // manifest, and an ME 2–7 has none at all; a CSE manifest carries it in its
    // own flags.
    productionReady:
      manifest.format === "r0" ? preCseProductionReady(bytes, manifest.base) : manifest.pvBit,
  };
}

/**
 * The CSME 11+ SKU from the decoded 0x0C / 0x0F facts of the operational chain
 * and the matched database row. The walker keeps one payload per block, and
 * upstream keeps the last of each seen.
 */
function csmeSkuText(
  identity: ReturnType<typeof identify>,
  codePartition: CodePartition | undefined,
  manifest: Manifest
): string | undefined {
  if (!identity.identified || identity.family !== "csme" || identity.major < 11) return undefined;
  if (codePartition === undefined) return undefined;
  let clientSystemInfo: ClientSystemInfoExtension | undefined;
  let fwSku: number | undefined;
  for (const extension of codePartition.extensions) {
    if (extension.clientSystemInfo !== undefined) clientSystemInfo = extension.clientSystemInfo;
    if (extension.signedPackage?.fwSku !== undefined) fwSku = extension.signedPackage.fwSku;
  }
  return csmeSku({
    variant: identity.variant,
    major: identity.major,
    minor: identity.minor,
    hotfix: identity.hotfix,
    build: identity.build,
    year: manifest.year,
    month: manifest.month,
    skuType: clientSystemInfo?.skuType,
    skuCaps: clientSystemInfo?.skuCaps,
    skuPlatform: clientSystemInfo?.skuPlatform,
    fwSku,
    databaseRow: identity.databaseName,
  });
}

/**
 * What is known about the image's chipset initialisation table.
 *
 * The decoded tables when there are some, "absent" when the volume was read and
 * holds none — and "unknown" for a file-table volume with files in it, whose
 * configuration needs `FileTable.dat` to read and may well carry one.
 */
function chipsetInitTable(volume: MFSVolume | undefined): ChipsetInitTable {
  if ((volume?.pchInit?.chipsets.length ?? 0) > 0) return "present";
  if (volume?.usesFTBL === true && volume.presentFileCount > 0) return "unknown";
  return "absent";
}

// MARK: - The file systems

interface FileSystems {
  readonly mfsInfo: MFSVolumeInfo | undefined;
  readonly mfsVolume: MFSVolume | undefined;
  readonly mfsBackup: MFSBackup | undefined;
  readonly efsVolume: EFSVolume | undefined;
  readonly oemConfiguration: OEMConfiguration | undefined;
  readonly mfsIssues: readonly Issue[];
  readonly mfsBackupIssues: readonly Issue[];
  readonly fsIssues: readonly Issue[];
}

const lowerHex = (value: number) => value.toString(16);
const word = (value: number) => `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;

/**
 * The MFS volume and its backup, the EFS volume and the FITC partition, each from
 * the `$FPT` partition that names it, with the warnings upstream raises while
 * still decoding them folded into one per structure.
 */
function decodeFileSystems(
  bytes: Uint8Array,
  baseOffset: number,
  regions: readonly FPTRegionRow[]
): FileSystems {
  const mfsIssues: Issue[] = [];
  const mfsBackupIssues: Issue[] = [];
  const fsIssues: Issue[] = [];
  let mfsInfo: MFSVolumeInfo | undefined;
  let mfsVolume: MFSVolume | undefined;
  let mfsBackup: MFSBackup | undefined;

  const mfsRegion = regions.find((one) => one.name === "MFS");
  if (mfsRegion !== undefined) {
    const volumeOffset = mfsRegion.offset - baseOffset;
    const info = parseMfs(bytes, volumeOffset, mfsRegion.size);
    if (info !== undefined) {
      mfsInfo = info;
      // The present files are the used records whose chain assembled content.
      const present = info.files.filter((one) => one.content.length > 0);
      mfsVolume = {
        offset: mfsRegion.offset,
        pageSize: info.pageSize,
        pageCount: info.systemPageCount + info.dataPageCount,
        systemPageCount: info.systemPageCount,
        dataPageCount: info.dataPageCount,
        signatureValid: info.volumeSignatureValid,
        volumeSize: info.volumeSize,
        computedVolumeSize: info.computedVolumeSize,
        fileRecordCount: info.fileRecordCount,
        usedFileCount: info.usedFileCount,
        ftblDictionary: info.ftblDictionary,
        ftblPlatform: info.ftblPlatform,
        ftblReserved: info.ftblReserved,
        usesFTBL: info.usesFTBL,
        presentFileCount: present.length,
        fileBytes: present.reduce((sum, one) => sum + one.content.length, 0),
        files: present.map((one) => ({ index: one.index, size: one.content.length })),
        configurations: info.configurations.map((config) => ({
          owningFile: config.owningFile,
          records: config.records.map((record) => ({
            name: record.name,
            isFolder: record.isFolder,
            size: record.size,
            offset: record.offset,
            unixRights: record.unixRights,
            integrityProtection: record.integrity,
            encryptionProtection: record.encryption,
            antiReplayProtection: record.antiReplay,
            oemConfigurable: record.oemConfigurable,
            mcaConfigurable: record.mcaConfigurable,
            reserved: record.reserved,
            ownerUserID: record.ownerUserID,
            ownerGroupID: record.ownerGroupID,
          })),
        })),
        homeDirectory: undefined,
        reservedIntegrity: [],
        pchInit: undefined,
      };
      if (!info.volumeSignatureValid) {
        mfsIssues.push({
          id: 8,
          severity: "warning",
          message:
            `MFS volume at 0x${lowerHex(mfsRegion.offset)} is present but its assembled System ` +
            "volume header is missing or its signature is invalid.",
        });
      } else if (!info.fileChainsIntact) {
        mfsIssues.push({
          id: 13,
          severity: "warning",
          message:
            `MFS volume at 0x${lowerHex(mfsRegion.offset)} has a low-level file whose FAT chunk ` +
            "chain is corrupt (ends early or cycles).",
        });
      }
    } else {
      // A main MFS region with no pages may be in backup state instead.
      mfsBackup = parseMfsBackup(bytes, volumeOffset, mfsRegion.size, mfsRegion.offset);
      if (mfsBackup === undefined) {
        mfsIssues.push({
          id: 8,
          severity: "warning",
          message:
            `Skipped MFS partition at 0x${lowerHex(mfsRegion.offset)}: ` +
            "unrecognizable format (no MFS pages found).",
        });
      }
    }
  }

  // A dedicated backup partition is decoded as one outright.
  const mfsbRegion = regions.find((one) => one.name === "MFSB");
  if (mfsBackup === undefined && mfsbRegion !== undefined) {
    mfsBackup = parseMfsBackup(
      bytes,
      mfsbRegion.offset - baseOffset,
      mfsbRegion.size,
      mfsbRegion.offset
    );
    if (mfsBackup === undefined) {
      mfsBackupIssues.push({
        id: 8,
        severity: "warning",
        message: `Skipped MFS Backup partition at 0x${lowerHex(mfsbRegion.offset)}: unrecognizable format.`,
      });
    }
  }

  // Upstream's errors for a decoded backup, as two warnings: the header, and the
  // body or its entries.
  if (mfsBackup !== undefined) {
    const at = `MFS Backup at 0x${lowerHex(mfsBackup.offset)}`;
    if (mfsBackup.format === "r0") {
      if (!mfsBackup.headerCRCValid) {
        mfsBackupIssues.push({
          id: 17,
          severity: "warning",
          message: `${at} (R0) Header CRC-32 ${word(mfsBackup.headerCRCStored)} is INVALID.`,
        });
      }
      if (mfsBackup.reconstructedVolumeParses === false) {
        mfsBackupIssues.push({
          id: 18,
          severity: "warning",
          message: `${at} (R0) body does not reconstruct into a valid MFS volume.`,
        });
      }
    } else {
      const headerDefects: string[] = [];
      if (mfsBackup.headerRevisionValid === false) {
        headerDefects.push(`Revision ${mfsBackup.headerRevision ?? 0}, expected 1`);
      }
      if (!mfsBackup.headerCRCValid) {
        headerDefects.push(`Header CRC-32 ${word(mfsBackup.headerCRCStored)} is INVALID`);
      }
      if (headerDefects.length > 0) {
        mfsBackupIssues.push({
          id: 17,
          severity: "warning",
          message: `${at} (R1): ${headerDefects.join("; ")}.`,
        });
      }
      const entryDefects: string[] = [];
      for (const entry of mfsBackup.entries) {
        const defects: string[] = [];
        if (!entry.revisionValid) defects.push(`Revision ${entry.revision}, expected 1`);
        if (!entry.headerCRCValid) {
          defects.push(`Entry Header CRC-32 ${word(entry.headerCRCStored)} is INVALID`);
        }
        if (!entry.dataCRCValid) {
          defects.push(`Entry Data CRC-32 ${word(entry.dataCRCStored)} is INVALID`);
        }
        if (defects.length > 0) entryDefects.push(`entry ${entry.fileIndex} ${defects.join(", ")}`);
      }
      if (entryDefects.length > 0) {
        mfsBackupIssues.push({
          id: 18,
          severity: "warning",
          message: `${at} (R1): ${entryDefects.join("; ")}.`,
        });
      }
    }
  }

  let efsVolume: EFSVolume | undefined;
  const efsRegion = regions.find((one) => one.name === "EFS");
  if (efsRegion !== undefined) {
    efsVolume = parseEfs(
      bytes,
      efsRegion.offset - baseOffset,
      efsRegion.size,
      efsRegion.offset,
      mfsInfo?.ftblDictionary
    );
    if (efsVolume === undefined) {
      fsIssues.push({
        id: 14,
        severity: "warning",
        message:
          `Skipped EFS partition at 0x${lowerHex(efsRegion.offset)}: ` +
          "unrecognizable format (no leading System page).",
      });
    } else {
      const efs = efsVolume;
      const defects: string[] = [];
      if (efs.systemPageCount !== 1) {
        defects.push(`detected ${efs.systemPageCount} System page(s), expected 1`);
      }
      if (!efs.scratchPagesEmpty) defects.push("data in Empty/Scratch page(s)");
      if (efs.revision !== 1 || efs.unknown1 !== 2) {
        defects.push(
          `Revision,Unknown1 = 0x${efs.revision.toString(16).toUpperCase()},` +
            `0x${efs.unknown1.toString(16).toUpperCase()}, expected 0x1,0x2`
        );
      }
      if (!efs.systemHeaderCRCValid) defects.push("System Page Header CRC-32 is INVALID");
      if (!efs.firstIndexPaddingEmpty) defects.push("data in System Page 1st Index Area Padding");
      if (!efs.indexesCRCValid) defects.push("System Page Indexes CRC-32 is INVALID");
      if (!efs.dataPageCountMatchesSystem) {
        defects.push(
          `detected ${efs.dataPageCount} Data Page(s), ` +
            `expected ${efs.dataPagesCommitted + efs.dataPagesReserved}`
        );
      }
      if (!efs.dataPageHeaderCRCsValid) defects.push("a Data Page Header CRC-32 is INVALID");
      if (!efs.dataPageFooterCRCsValid) defects.push("a Data Page Footer CRC-32 is INVALID");
      if (defects.length > 0) {
        fsIssues.push({
          id: 15,
          severity: "warning",
          message: `EFS partition at 0x${lowerHex(efsRegion.offset)}: ${defects.join("; ")}.`,
        });
      }
    }
  }

  let oemConfiguration: OEMConfiguration | undefined;
  const fitcRegion = regions.find((one) => one.name === "FITC");
  if (fitcRegion !== undefined) {
    oemConfiguration = parseFitc(
      bytes,
      fitcRegion.offset - baseOffset,
      fitcRegion.size,
      fitcRegion.offset
    );
    if (oemConfiguration !== undefined) {
      const defects: string[] = [];
      if (oemConfiguration.headerCRCValid === false) defects.push("Header CRC-32 is INVALID");
      if (oemConfiguration.dataCRCValid === false) defects.push("Data CRC-32 is INVALID");
      if (oemConfiguration.paddingAllFF === false) {
        defects.push("data in padding, possibly unknown Header revision");
      }
      if (defects.length > 0) {
        fsIssues.push({
          id: 16,
          severity: "warning",
          message: `FITC partition at 0x${lowerHex(fitcRegion.offset)}: ${defects.join("; ")}.`,
        });
      }
    }
  }

  return {
    mfsInfo,
    mfsVolume,
    mfsBackup,
    efsVolume,
    oemConfiguration,
    mfsIssues,
    mfsBackupIssues,
    fsIssues,
  };
}

// MARK: - The checks that decompress a module

export interface IdentityFacts {
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
}

/** The dictionary for this identity, when there is one to use. */
function usableDictionary(identity: IdentityFacts, dictionaries: HuffmanDictionaries | undefined) {
  if (dictionaries === undefined || identity.major === 0 || identity.variant === "")
    return undefined;
  return dictionaryFor(dictionaries, identity.variant, identity.major, identity.minor);
}

/**
 * Where a Huffman module's compressed stream is and how long it is on both
 * sides — what decompressing it needs.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice
 */
export interface HuffmanSlice {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.module */
  readonly module: CPDModuleRow;
  /**
   * Region-relative start of the stream.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.offset
   */
  readonly offset: number;
  /**
   * The stream's length, chunk directory included.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.compressedSize
   */
  readonly compressedSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.uncompressedSize */
  readonly uncompressedSize: number;
  /**
   * The `.met`'s stored hash; undefined for a module with no metadata.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.hash
   */
  readonly hash: string | undefined;
  /**
   * The sizes come from a `.met`, rather than from the `$CPD` directory.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.HuffmanSlice.fromMetadata
   */
  readonly fromMetadata: boolean;
}

/**
 * Every Huffman module that can be decompressed, with its sizes.
 *
 * A module with a `.met` takes both sizes from its Module Attributes block (only
 * when it advertises Huffman and no encryption). A module with none — every
 * Huffman module of a CSME 15 FTPR — has only its uncompressed size in the
 * directory, and its compressed size is worked out the way upstream does (MEA.py
 * `ext_anl` Stage 3, 6655–6680): up to where the next entry starts, the last one
 * up to the partition's end (Partition Info 0x03/0x16) or else up to the first
 * `FF FF` (no Huffman codeword is 0xFFFF); an answer past the uncompressed size,
 * or below zero, is not believed; and a FIT- or OEM-customized partition, whose
 * directory sizes are accurate, is not adjusted. An empty module (erased, or past
 * the region) is left out.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.huffmanSlices
 */
export function huffmanSlices(
  codePartition: CodePartition,
  bytes: Uint8Array,
  baseOffset: number
): HuffmanSlice[] {
  // Module offsets are absolute here, where upstream's count from the `$CPD`.
  const at = (module: CPDModuleRow) => module.offset - baseOffset;
  const slice = (start: number, count: number): Uint8Array =>
    start < 0 || start >= bytes.length || count <= 0
      ? new Uint8Array(0)
      : bytes.subarray(start, Math.min(bytes.length, start + count));
  // Upstream's entry_empty: nothing there, or exactly `size` bytes of 0xFF.
  const isEmpty = (module: CPDModuleRow) => {
    const data = slice(at(module), module.size);
    return (
      data.length === 0 || (data.length === module.size && data.every((byte) => byte === 0xff))
    );
  };
  // A real OEM key, as opposed to Intel's 0xBCCB placeholder.
  // Upstream's bccb_pat: CB BC, nine bytes, 00, "$MN2".
  const isPlaceholderKey = (data: Uint8Array) => {
    const head = data.subarray(0, 0x50);
    for (let index = 0; index + 16 <= head.length; index++) {
      if (head[index] !== 0xcb || head[index + 1] !== 0xbc || head[index + 11] !== 0) continue;
      if (
        head[index + 12] === 0x24 &&
        head[index + 13] === 0x4d &&
        head[index + 14] === 0x4e &&
        head[index + 15] === 0x32
      ) {
        return true;
      }
    }
    return false;
  };
  const customized = codePartition.modules.some((module) => {
    if (module.name === "fitc.cfg") return !isEmpty(module);
    if (module.name === "oem.key" && !isEmpty(module)) {
      return !isPlaceholderKey(slice(at(module), module.size));
    }
    return false;
  });
  const partitionSize = codePartition.extensions.find((one) => one.partitionInfo !== undefined)
    ?.partitionInfo?.partitionSize;

  // Stage 3, over every entry in offset order.
  const ordered = codePartition.modules
    .map((module, id) => ({ module, id }))
    .sort((left, right) => left.module.offset - right.module.offset || left.id - right.id);
  const calculated = new Map<number, number>();
  if (!customized) {
    ordered.forEach(({ module, id }, index) => {
      if (isEmpty(module)) return;
      let size: number | undefined;
      const next = ordered[index + 1];
      if (next !== undefined) {
        size = next.module.offset - module.offset;
      } else if (partitionSize !== undefined) {
        size = partitionSize - (module.offset - codePartition.offset);
      } else {
        const rest = slice(at(module), bytes.length);
        for (let offset = 0; offset + 1 < rest.length; offset++) {
          if (rest[offset] === 0xff && rest[offset + 1] === 0xff) {
            size = offset;
            break;
          }
        }
      }
      if (size !== undefined && size >= 0 && size <= module.size) calculated.set(id, size);
    });
  }

  const slices: HuffmanSlice[] = [];
  codePartition.modules.forEach((module, id) => {
    if (!module.isHuffman || module.size <= 0 || isEmpty(module)) return;
    const met = codePartition.modules.find((one) => one.name === `${module.name}.met`);
    if (met !== undefined) {
      const attributes = met.extensions?.find(
        (one) => one.moduleAttributes !== undefined
      )?.moduleAttributes;
      if (
        attributes === undefined ||
        attributes.compression !== 1 ||
        attributes.encryption !== 0 ||
        attributes.compressedSize <= 0 ||
        attributes.uncompressedSize <= 0
      ) {
        return;
      }
      slices.push({
        module,
        offset: at(module),
        compressedSize: attributes.compressedSize,
        uncompressedSize: attributes.uncompressedSize,
        hash: attributes.moduleHash,
        fromMetadata: true,
      });
    } else {
      slices.push({
        module,
        offset: at(module),
        compressedSize: calculated.get(id) ?? module.size,
        uncompressedSize: module.size,
        hash: undefined,
        fromMetadata: false,
      });
    }
  });
  return slices;
}

/** A digest as the metadata tables list it: SHA-384 for a 96-digit hash, else SHA-256. */
function digestOf(data: Uint8Array, length: number): string {
  return hex(length === 96 ? sha384(data) : sha256(data));
}

/**
 * Phase 8 cross-check (`mod_anl`'s Huffman branch, MEA.py 7178–7230): every
 * Huffman module `huffmanSlices` can place is decompressed against the dictionary
 * for this identity.
 *
 * - A module with a `.met` must come out at the `.met`'s uncompressed size and
 *   without unknown codewords.
 * - A module without one is checked the way upstream checks it: its decompressed
 *   bytes must hash to one of the hashes the `pm` / `rbe` metadata table lists
 *   (`rbePmHashes`). With no such table there is only the size and the codewords
 *   to go on.
 *
 * Never throws; no dictionary skips everything.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.huffmanValidationIssues
 */
export function huffmanValidationIssues(
  codePartition: CodePartition,
  bytes: Uint8Array,
  baseOffset: number,
  identity: IdentityFacts,
  dictionaries: HuffmanDictionaries | undefined,
  rbePmHashes: readonly string[] = []
): Issue[] {
  const dictionary = usableDictionary(identity, dictionaries);
  if (dictionary === undefined) return [];
  const listed = new Set(rbePmHashes);
  const first = rbePmHashes[0];
  const issues: Issue[] = [];
  for (const slice of huffmanSlices(codePartition, bytes, baseOffset)) {
    const name = slice.module.name;
    if (slice.offset < 0 || slice.offset + slice.compressedSize > bytes.length) {
      issues.push({
        id: 7,
        severity: "warning",
        message:
          `Huffman module "${name}" extends past the end of the region; ` +
          "cannot verify its decompression.",
        module: name,
      });
      continue;
    }
    const result = decompressHuffman({
      module: bytes.subarray(slice.offset, slice.offset + slice.compressedSize),
      compressedSize: slice.compressedSize,
      decompressedSize: slice.uncompressedSize,
      dictionary,
    });
    if (result.output.length !== slice.uncompressedSize) {
      const source = slice.fromMetadata ? ".met-declared" : "$CPD";
      issues.push({
        id: 7,
        severity: "warning",
        message:
          `Huffman module "${name}" did not decompress to its ${source} size ` +
          `(got 0x${lowerHex(result.output.length)} bytes, expected ` +
          `0x${lowerHex(slice.uncompressedSize)}).`,
        module: name,
      });
    } else if (!slice.fromMetadata && first !== undefined) {
      if (!listed.has(digestOf(result.output, first.length))) {
        issues.push({
          id: 7,
          severity: "warning",
          message: `Hash of Huffman module "${name}" is invalid.`,
          module: name,
        });
      }
    } else if (!result.clean) {
      issues.push({
        id: 7,
        severity: "warning",
        message:
          `Huffman module "${name}" decompressed to the right size but hit ` +
          "unknown codewords / an early stream end.",
        module: name,
      });
    }
  }
  return issues;
}

/**
 * The `$CPD` at `offset` (region-relative) as a code partition: its directory,
 * with every `.met` body read as the operational partition's are. Undefined where
 * no `$CPD` header is.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.codePartition
 */
export function codePartitionAtCpd(
  offset: number,
  bytes: Uint8Array,
  baseOffset: number,
  family: ExtensionFamily
): CodePartition | undefined {
  const header = decodeCpdHeader(bytes, offset);
  if (header === undefined) return undefined;
  return {
    name: header.partitionName,
    offset: baseOffset + header.base,
    headerVersion: header.headerVersion,
    headerLength: header.headerLength,
    numModules: header.numModules,
    checksumValid: undefined,
    extensions: [],
    modules: cpdEntries(bytes, header).map((entry) => {
      const row = {
        name: entry.name,
        offset: baseOffset + header.base + entry.offset,
        size: entry.size,
        isHuffman: entry.isHuffman,
      };
      if (!entry.name.endsWith(".met") || entry.isHuffman || entry.size <= 0) return row;
      return {
        ...row,
        extensions: decodeMetadataChain({
          bytes,
          contentBase: header.base + entry.offset,
          bodySize: entry.size,
          family,
          baseOffset,
        }),
      };
    }),
  };
}

/**
 * Region-relative offsets of every non-empty partition the `$FPT` and the boot
 * BPDTs list, in that order, each once — the places a `$CPD` can be.
 */
function partitionOffsets(
  fpt: FPTResult | undefined,
  boots: readonly BootPartition[] | undefined,
  baseOffset: number
): number[] {
  const offsets: number[] = [];
  for (const part of fpt?.partitions ?? []) if (!part.empty) offsets.push(part.offset);
  for (const boot of boots ?? []) {
    for (const entry of boot.entries) if (!entry.empty) offsets.push(entry.offset - baseOffset);
  }
  return [...new Set(offsets)];
}

/** Region-relative `$CPD` offsets of the image's RBEP partitions, each listed once. */
function rbepOffsets(
  fpt: FPTResult | undefined,
  boots: readonly BootPartition[] | undefined,
  baseOffset: number
): number[] {
  const offsets: number[] = [];
  for (const part of fpt?.partitions ?? []) {
    if (part.name === "RBEP" && !part.empty) offsets.push(part.offset);
  }
  for (const boot of boots ?? []) {
    for (const entry of boot.entries) {
      if (entry.name === "RBEP" && !entry.empty) offsets.push(entry.offset - baseOffset);
    }
  }
  return [...new Set(offsets)];
}

/**
 * The hashes the `pm` / `rbe` metadata tables list that no module of the image
 * hashes to — upstream's leftover report (MEA.py 5814–5817, printed under
 * `-bypass`), which says what those tables name that the image does not account
 * for: most often a module that is encrypted (NFTP `pavp`, PCOD), which cannot be
 * hashed as it is loaded.
 *
 * Every module without metadata in `partitions` is hashed the way `mod_anl`
 * hashes it against the tables: a Huffman one decompressed; an uncompressed one
 * as stored; an LZMA one (its stream header says so) as stored, and else
 * decompressed (MEA.py 7120–7140, 7300–7330). `pavp` is skipped, as upstream
 * skips it. A module with a `.met` is checked against its own hash instead and
 * matches no table row. In table order, each once.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.unmatchedMetadataHashes
 */
export function unmatchedMetadataHashes(
  tables: readonly string[],
  partitions: readonly CodePartition[],
  bytes: Uint8Array,
  baseOffset: number,
  dictionary: HuffmanDictionary | undefined
): string[] {
  const length = tables[0]?.length;
  if (length === undefined) return [];
  const listed = new Set(tables);
  const matched = new Set<string>();
  for (const partition of partitions) {
    if (dictionary !== undefined) {
      for (const slice of huffmanSlices(partition, bytes, baseOffset)) {
        if (slice.fromMetadata) continue;
        if (slice.offset < 0 || slice.offset + slice.compressedSize > bytes.length) continue;
        const result = decompressHuffman({
          module: bytes.subarray(slice.offset, slice.offset + slice.compressedSize),
          compressedSize: slice.compressedSize,
          decompressedSize: slice.uncompressedSize,
          dictionary,
        });
        const hash = digestOf(result.output, length);
        if (listed.has(hash)) matched.add(hash);
      }
    }
    for (const module of partition.modules) {
      if (module.isHuffman || module.size <= 0) continue;
      const name = module.name;
      if (
        name.endsWith(".met") ||
        name.endsWith(".man") ||
        name === "pavp" ||
        partition.modules.some((one) => one.name === `${name}.met`)
      ) {
        continue;
      }
      const start = module.offset - baseOffset;
      if (start < 0 || start + module.size > bytes.length) continue;
      const stored = bytes.subarray(start, start + module.size);
      const hash = digestOf(stored, length);
      if (listed.has(hash)) {
        matched.add(hash);
        continue;
      }
      const size = lzmaUncompressedSize(stored);
      const decompressed = size === undefined ? undefined : decompressLzmaModule(stored, size);
      if (decompressed === undefined) continue;
      const unpacked = digestOf(decompressed, length);
      if (listed.has(unpacked)) matched.add(unpacked);
    }
  }
  const seen = new Set<string>();
  return tables.filter((hash) => {
    if (matched.has(hash) || seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

/**
 * The uncompressed size an LZMA module's stream header gives, when the bytes
 * open with the header upstream recognises one by (`36 00 40 00 00`, and zeros
 * at 0xE–0x10); undefined for anything else.
 */
function lzmaUncompressedSize(data: Uint8Array): number | undefined {
  if (data.length < 0x11) return undefined;
  if (STRAY_ZEROS_SIGNATURE.some((byte, index) => data[index] !== byte)) return undefined;
  if (data[0xe] !== 0 || data[0xf] !== 0 || data[0x10] !== 0) return undefined;
  let size = 0;
  for (let index = 0; index < 8; index++) size += (data[5 + index] ?? 0) * 2 ** (8 * index);
  return size > 0 && size < 0x7fff_ffff ? size : undefined;
}

/**
 * The hashes the `rbe` module's metadata table lists, in every RBEP partition at
 * `offsets` (region-relative `$CPD` bases). The operational partition is FTPR,
 * whose `pm` table lists only the modules `pm` loads; the ones the ROM boot
 * extensions load — kernel, syslib, bup and the rest — are listed by `rbe`, and
 * upstream checks a module without metadata against both (MEA.py 5623–5633). A
 * Huffman `rbe` is sliced and decompressed like any other module; one that does
 * not come out whole lists nothing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.rbeMetadataHashes
 */
export function rbeMetadataHashes(
  offsets: readonly number[],
  bytes: Uint8Array,
  baseOffset: number,
  family: ExtensionFamily,
  identity: IdentityFacts,
  dictionaries: HuffmanDictionaries | undefined
): string[] {
  const hashes: string[] = [];
  for (const offset of offsets) {
    // `rbe` has a `rbe.met` of its own, whose Module Attributes give its sizes.
    const partition = codePartitionAtCpd(offset, bytes, baseOffset, family);
    const module = partition?.modules.find((one) => one.name === "rbe");
    if (partition === undefined || module === undefined || module.size <= 0) continue;
    let body: Uint8Array;
    if (module.isHuffman) {
      const dictionary = usableDictionary(identity, dictionaries);
      const slice = huffmanSlices(partition, bytes, baseOffset).find(
        (one) => one.module === module
      );
      if (
        dictionary === undefined ||
        slice === undefined ||
        slice.offset < 0 ||
        slice.offset + slice.compressedSize > bytes.length
      ) {
        continue;
      }
      const result = decompressHuffman({
        module: bytes.subarray(slice.offset, slice.offset + slice.compressedSize),
        compressedSize: slice.compressedSize,
        decompressedSize: slice.uncompressedSize,
        dictionary,
      });
      if (result.output.length !== slice.uncompressedSize || !result.clean) continue;
      body = result.output;
    } else {
      const start = module.offset - baseOffset;
      if (start < 0 || start + module.size > bytes.length) continue;
      body = bytes.subarray(start, start + module.size);
    }
    hashes.push(...(decodeRbePmMetadata(body) ?? []).map((row) => row.hash));
  }
  return hashes;
}

/**
 * The `pm` / `rbe` module's metadata table. Best effort: an unreadable or short
 * body, or a Huffman one with no dictionary to read it with, is nothing.
 */
function rbePmMetadataOf(
  codePartition: CodePartition,
  bytes: Uint8Array,
  baseOffset: number,
  identity: IdentityFacts,
  dictionaries: HuffmanDictionaries | undefined
): RBEPMMetadata[] | undefined {
  const module = codePartition.modules.find((one) => one.name === "pm" || one.name === "rbe");
  if (module === undefined || module.size <= 0) return undefined;
  const moduleBase = module.offset - baseOffset;
  if (moduleBase < 0) return undefined;
  if (!module.isHuffman) {
    if (moduleBase + module.size > bytes.length) return undefined;
    return decodeRbePmMetadata(bytes.subarray(moduleBase, moduleBase + module.size));
  }
  const dictionary = usableDictionary(identity, dictionaries);
  const attributes = metAttributes(codePartition, module.name);
  if (
    dictionary === undefined ||
    attributes === undefined ||
    attributes.compression !== 1 ||
    attributes.encryption !== 0 ||
    attributes.compressedSize <= 0 ||
    attributes.uncompressedSize <= 0 ||
    moduleBase + attributes.compressedSize > bytes.length
  ) {
    return undefined;
  }
  const result = decompressHuffman({
    module: bytes.subarray(moduleBase, moduleBase + attributes.compressedSize),
    compressedSize: attributes.compressedSize,
    decompressedSize: attributes.uncompressedSize,
    dictionary,
  });
  if (result.output.length !== attributes.uncompressedSize || !result.clean) return undefined;
  return decodeRbePmMetadata(result.output);
}

/**
 * Upstream's LZMA module check: a module whose `.met` advertises LZMA and no
 * encryption is sliced by that `.met`'s compressed size — the `$CPD` row's size is
 * the uncompressed one — decompressed, and checked against the stored hash.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.lzmaValidationIssues
 */
export function lzmaValidationIssues(
  codePartition: CodePartition,
  bytes: Uint8Array,
  baseOffset: number
): Issue[] {
  const issues: Issue[] = [];
  for (const module of codePartition.modules) {
    if (module.name.endsWith(".met") || module.name.endsWith(".man")) continue;
    const attributes = metAttributes(codePartition, module.name);
    if (
      attributes === undefined ||
      attributes.compression !== 2 ||
      attributes.encryption !== 0 ||
      attributes.compressedSize <= 0
    ) {
      continue;
    }
    const moduleBase = module.offset - baseOffset;
    if (moduleBase < 0 || moduleBase + attributes.compressedSize > bytes.length) {
      issues.push({
        module: module.name,
        id: 19,
        severity: "warning",
        message: `LZMA module "${module.name}" extends past the end of the region; cannot verify it.`,
      });
      continue;
    }
    const stored = bytes.subarray(moduleBase, moduleBase + attributes.compressedSize);
    const decompressed = decompressLzmaModule(stored, attributes.uncompressedSize);
    if (decompressed === undefined) {
      issues.push({
        module: module.name,
        id: 19,
        severity: "warning",
        message: `LZMA module "${module.name}" does not decompress.`,
      });
      continue;
    }
    if (
      attributes.moduleHash.length > 0 &&
      !lzmaHashMatches(attributes.moduleHash, stored, decompressed)
    ) {
      issues.push({
        module: module.name,
        id: 19,
        severity: "warning",
        message: `Hash of LZMA module "${module.name}" is invalid.`,
      });
    }
  }
  return issues;
}

/** ME 7's blacklist, or nothing when neither line blacklists anything. */
function blacklist(bytes: Uint8Array, manifestBase: number): DowngradeBlacklist | undefined {
  const entries = downgradeBlacklist(bytes, manifestBase);
  if (entries.sevenZero === undefined && entries.sevenOne === undefined) return undefined;
  return entries;
}

/**
 * Where the independent firmware of an image sits, in the order the console
 * prints their tables: every PMC, then every PCHC, then every PHY. Both
 * inventories are searched, as upstream searches both — the region's own `$FPT`
 * and each boot partition's table — since a stitched PMC lives in one or the
 * other depending on how the image was built. Region-relative, clamped to what
 * was handed over.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.IndependentSlot
 */
function independentSlots(
  fpt: FPTResult | undefined,
  bootPartitions: readonly BootPartition[] | undefined,
  baseOffset: number,
  regionCount: number
): IndependentSlot[] {
  const candidates: {
    readonly name: string;
    readonly offset: number;
    readonly size: number;
    readonly place: string;
  }[] = [];
  for (const part of fpt?.partitions ?? []) {
    if (!part.empty) candidates.push({ ...part, place: "$FPT" });
  }
  for (const boot of bootPartitions ?? []) {
    for (const entry of boot.entries) {
      // Boot table offsets are absolute in the analysed image.
      if (!entry.empty) {
        candidates.push({ ...entry, offset: entry.offset - baseOffset, place: boot.partitionName });
      }
    }
  }

  const slots: IndependentSlot[] = [];
  for (const names of [PMC_PARTITION_NAMES, PCHC_PARTITION_NAMES, PHY_PARTITION_NAMES]) {
    for (const candidate of candidates) {
      if (!names.includes(candidate.name)) continue;
      const start = candidate.offset;
      if (start < 0 || candidate.size <= 0 || start >= regionCount) continue;
      const end = Math.min(candidate.offset + candidate.size, regionCount);
      // The same partition can be listed twice (a $FPT entry that also appears
      // in a boot table); one table per firmware.
      if (slots.some((one) => one.start === start && one.end === end)) continue;
      slots.push({ name: candidate.name, start, end, place: candidate.place });
    }
  }
  return slots;
}

/**
 * One partition of an independent firmware: its name, its region-relative bytes,
 * and the inventory that lists it — "$FPT", or the boot partition whose table
 * does ("Boot 1").
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.IndependentSlot
 */
export interface IndependentSlot {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.IndependentSlot.name */
  readonly name: string;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.IndependentSlot.range
   * @upstream-differs a half-open start and end
   */
  readonly start: number;
  readonly end: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.IndependentSlot.place */
  readonly place: string;
}

/**
 * The slots with every byte-identical copy folded into the first one that holds
 * those bytes, and the partitions listed in more than one place whose copies are
 * not the same bytes.
 *
 * CSE Redundancy keeps a backup of Boot 1 in Boot 2, so every independent
 * firmware of Boot 1 is there twice. Upstream prints a table for each (MEA.py
 * 11850–12070 walks every boot BPDT and never deduplicates); the two tables say
 * nothing the one does not, so the copy goes into the first's `copies`. Copies
 * that differ are two firmwares and stay two.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.mergingRedundantCopies
 */
export function mergingRedundantCopies(
  slots: readonly IndependentSlot[],
  bytes: Uint8Array
): {
  readonly unique: { readonly slot: IndependentSlot; readonly copies: string[] }[];
  readonly differing: { readonly name: string; readonly places: string[] }[];
} {
  const content = (slot: IndependentSlot) => bytes.subarray(slot.start, slot.end);
  const same = (left: Uint8Array, right: Uint8Array) =>
    left.length === right.length && left.every((byte, index) => byte === right[index]);
  const unique: { readonly slot: IndependentSlot; readonly copies: string[] }[] = [];
  const differing: { readonly name: string; readonly places: string[] }[] = [];
  for (const slot of slots) {
    const bytesOf = content(slot);
    const copy = unique.find(
      (one) => one.slot.name === slot.name && same(content(one.slot), bytesOf)
    );
    if (copy !== undefined) {
      copy.copies.push(slot.place);
      continue;
    }
    const other = unique.find((one) => one.slot.name === slot.name);
    if (other !== undefined) {
      const known = differing.find((one) => one.name === slot.name);
      if (known !== undefined) known.places.push(slot.place);
      else differing.push({ name: slot.name, places: [other.slot.place, slot.place] });
    }
    unique.push({ slot, copies: [] });
  }
  return { unique, differing };
}

/**
 * The region's own SHA-256, SHA-384 and CRC-32 — what `analyze` deliberately
 * leaves out. Each is an independent pass over the whole buffer, and together
 * they were about two thirds of the work of a parse while answering only three
 * detail rows, so they are the caller's to ask for when something is going to
 * read them. An empty region has nothing to measure.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.checksums
 * @upstream-differs synchronous; the worker it runs in keeps it off the page
 */
export function checksums(bytes: Uint8Array): Checksums {
  if (bytes.length === 0) return { sha256: undefined, sha384: undefined, crc32: undefined };
  return { sha256: hex(sha256(bytes)), sha384: hex(sha384(bytes)), crc32: crc32(bytes) };
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
