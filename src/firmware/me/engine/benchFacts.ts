import { uepMapForME, uepReadings } from "@/firmware/me/configuration/uepMap";
import type { FileTable } from "@/firmware/me/data/fileTable";
import {
  decideManufacturing,
  ManufacturingFileID,
  manufacturingLock,
} from "@/firmware/me/fileSystem/manufacturing";
import type { MFSVolumeInfo } from "@/firmware/me/fileSystem/mfs";
import {
  bootGuardProfileInCDMD,
  bootGuardProfileInRecordUEPArea,
  bootGuardProfileInUEPArea,
  oemPublicKeyHash,
} from "@/firmware/me/layout/bootGuard";
import { biosMaster } from "@/firmware/me/layout/flashDescriptor";
import type { OEMConfiguration } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";
import type {
  BootGuardProfile,
  HardwareBinding,
  ManufacturingBasis,
  ManufacturingLock,
  ManufacturingState,
  OEMKeyHash,
} from "@/firmware/me/models/manufacturingFacts";

/**
 * The facts a repair bench asks that MEAnalyzer does not print: whether this image
 * closes Manufacturing on its first boot, what the board the dump came from has done,
 * which Boot Guard profile the image is built for, which OEM public key hash it carries,
 * and whether it binds its SPI part to the chipset. Ours, upstream's too: none of them
 * is MEAnalyzer's.
 *
 * Read after the file systems and the identity, out of what the analysis already holds:
 * the MFS volume's files, the OEM Configuration partition's records and the FPT regions'
 * bytes. Every file is found by the File IDs `FileTable.dat` gives it, which is why the
 * live page needs the database: without it a built image's files carry no IDs, and the
 * page is left unread rather than guessed at.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.analyze
 * @upstream-differs a function of its own over what the analysis read, where upstream reads them in
 * the body of `analyze`
 */
export interface BenchFacts {
  readonly manufacturingState: ManufacturingState;
  readonly manufacturingBasis: ManufacturingBasis;
  readonly manufacturingLock: ManufacturingLock | undefined;
  readonly bootGuardProfile: BootGuardProfile | undefined;
  readonly oemPublicKeyHash: OEMKeyHash;
  readonly hardwareBinding: HardwareBinding;
}

/** The FPT regions as the analysis lists them. */
interface Region {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

export function readBenchFacts(options: {
  readonly bytes: Uint8Array;
  readonly baseOffset: number;
  readonly regions: readonly Region[];
  readonly identity: { readonly family: FirmwareFamily; readonly major: number };
  readonly mfsInfo: MFSVolumeInfo | undefined;
  readonly oemConfiguration: OEMConfiguration | undefined;
  readonly fileTable: FileTable | undefined;
  readonly descriptorBytes: Uint8Array | undefined;
}): BenchFacts {
  const { bytes, baseOffset, regions, identity, mfsInfo, oemConfiguration, fileTable } = options;

  // The Manufacturing switch is one setting written in two places: the OEM
  // Configuration (FITC) partition holds the record the build wrote — the setting the
  // platform applies when it enters End of Manufacturing — and the MFS volume's own
  // files hold it as the file system carries it, the only copy in a region handed over
  // without its OEM Configuration partition.
  const liveFileIDs = new Map<number, number>();
  let liveFilesResolved = false;
  // Only an FTBL volume's files carry File IDs: an older volume names its records the
  // other way, and the switch does not exist there at all.
  if (
    mfsInfo !== undefined &&
    fileTable !== undefined &&
    mfsInfo.files.length > 0 &&
    mfsInfo.usesFTBL
  ) {
    const naming = namingOf(mfsInfo, fileTable);
    liveFilesResolved = naming.size > 0;
    const wanted: readonly number[] = [
      ManufacturingFileID.eomConfig,
      ManufacturingFileID.eom,
      ManufacturingFileID.manufLock,
    ];
    for (const file of mfsInfo.files) {
      const entry = naming.get(file.index);
      const fileID = entry === undefined ? Number.NaN : Number.parseInt(entry.fileID, 16);
      const first = file.content[0];
      if (!wanted.includes(fileID) || first === undefined) continue;
      // The record is 2 bytes and little-endian: the flag is byte 0's bit 0,
      // `FlexibleEomSettings` its bits 1–2, so the first byte is the whole of it.
      liveFileIDs.set(fileID, first);
    }
  }
  let imageEOMConfig: number | undefined;
  const payload = oemConfiguration?.payloadOffset;
  if (payload !== undefined) {
    for (const record of oemConfiguration?.recordsByID ?? []) {
      if (record.fileID !== ManufacturingFileID.eomConfig) continue;
      const at = payload - baseOffset + record.offset;
      if (at >= 0 && at < bytes.length) imageEOMConfig = bytes[at];
    }
  }
  // The board's own record of having been through End of Manufacturing: read only where
  // the file system's File IDs are, and nothing where the volume never booted.
  const lockByte = liveFileIDs.get(ManufacturingFileID.manufLock);
  const master =
    options.descriptorBytes === undefined ? undefined : biosMaster(options.descriptorBytes);
  const manufacturing = decideManufacturing({
    imageEOMConfig,
    liveEOMConfig: liveFileIDs.get(ManufacturingFileID.eomConfig),
    // The descriptor's BIOS master: all ones in both masks is a descriptor the host may
    // still rewrite. No descriptor (an extracted region) leaves the check out.
    descriptorOpen:
      master === undefined ? undefined : master.read === 0xfff && master.write === 0xfff,
    // CSME 11 and later decide this: their descriptors carry the v2 access rights the
    // verdict is read from. An older family has neither, and answers `noSwitch`.
    hasSwitch: identity.family === "csme" && identity.major >= 11,
    liveFilesResolved,
  });

  // Boot Guard: the profile is one fact with two keepings — the JSON record of the CDMD
  // configuration partition where the image has one, and the UEP area's bits where it
  // does not — and the key hash a value the UEP area repeats. The shape of container the
  // bits sit in is the generation's: the area's own record on CSME 12, 13 and 14, the
  // first bit array of CSME 15 and 16.
  const uepArea = regionBytes("UEP", regions, bytes, baseOffset);
  const profileFromUEP = (area: Uint8Array): BootGuardProfile | undefined => {
    if (identity.family !== "csme") return undefined;
    if (identity.major >= 12 && identity.major <= 14) {
      return bootGuardProfileInRecordUEPArea(area, identity.major);
    }
    if (identity.major >= 15 && identity.major <= 16) return bootGuardProfileInUEPArea(area);
    // CSME 18 is read through the tool's own UEP layout: its `BTG_PROFILE` setting is the
    // profile's own number (0, 3, 4 or 5).
    const map = identity.major >= 18 ? uepMapForME(identity.major) : undefined;
    const value =
      map === undefined
        ? undefined
        : uepReadings(area, map)?.find((one) => one.name === "BTG_PROFILE")?.value;
    return value === 0 || value === 3 || value === 4 || value === 5
      ? (`${value}` as BootGuardProfile)
      : undefined;
  };
  const cdmd = regionBytes("CDMD", regions, bytes, baseOffset);
  const bootGuardProfile =
    (cdmd === undefined ? undefined : bootGuardProfileInCDMD(cdmd)) ??
    (uepArea === undefined ? undefined : profileFromUEP(uepArea));
  // An image with no UEP area at all is the finding that this layout has none where the
  // key would be, which is what CSME 11 answers. Which record holds the key depends on
  // the generation, so the reading needs the identity.
  const keyHash = oemPublicKeyHash(uepArea ?? new Uint8Array(), identity.major);

  // The hardware binding — Flash Image Tool's "Hardware Binding Enabled". The tool keeps
  // it in a file of its own, one byte of `DisabledEnabledValues`. The file system's copy
  // is the state in force, the build's the fallback; neither leaves it `notInImage`.
  const bindingPath = "/home/bup/bup_sku/hw_binding";
  const bindingBytes =
    fileBytes(bindingPath, mfsInfo, fileTable) ??
    recordBytes(bindingPath, oemConfiguration, fileTable, mfsInfo, bytes, baseOffset);
  const bindingByte = bindingBytes?.[0];
  const hardwareBinding: HardwareBinding =
    bindingByte === undefined
      ? { kind: "notInImage" }
      : bindingByte === 0
        ? { kind: "disabled" }
        : bindingByte === 1
          ? { kind: "enabled" }
          : { kind: "other", byte: bindingByte };

  return {
    manufacturingState: manufacturing.state,
    manufacturingBasis: manufacturing.basis,
    manufacturingLock: lockByte === undefined ? undefined : manufacturingLock(lockByte),
    bootGuardProfile,
    oemPublicKeyHash: keyHash,
    hardwareBinding,
  };
}

/** The `FileTable.dat` entries naming an FTBL volume's low-level files, by index. */
function namingOf(info: MFSVolumeInfo, table: FileTable) {
  const resolution = table.resolve(info.ftblPlatform, info.ftblDictionary);
  return table.recordsForFileIndices(
    info.files.map((file) => file.index),
    resolution.platform,
    resolution.dictionary
  );
}

/**
 * The bytes of one FPT region, by its name. Nothing when the image has no such region,
 * or its declared range runs past the bytes the analyser was handed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.regionBytes
 */
export function regionBytes(
  name: string,
  regions: readonly Region[],
  bytes: Uint8Array,
  baseOffset: number
): Uint8Array | undefined {
  const part = regions.find((one) => one.name === name && one.size > 0);
  if (part === undefined) return undefined;
  const start = part.offset - baseOffset;
  if (start < 0 || start + part.size > bytes.length) return undefined;
  return bytes.subarray(start, start + part.size);
}

/**
 * The bytes of one file the ME file system carries, by its path — the file itself, not a
 * setting of a map. Nothing where the volume has none, or the file table cannot name it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.fileBytes
 */
export function fileBytes(
  path: string,
  volume: MFSVolumeInfo | undefined,
  table: FileTable | undefined
): Uint8Array | undefined {
  // Only an FTBL volume's file indices are FTBL's.
  if (
    volume === undefined ||
    table === undefined ||
    !volume.usesFTBL ||
    volume.files.length === 0
  ) {
    return undefined;
  }
  const resolution = table.resolve(volume.ftblPlatform, volume.ftblDictionary);
  const naming = namingOf(volume, table);
  for (const file of volume.files) {
    const entry = naming.get(file.index);
    if (entry === undefined) continue;
    const id = Number.parseInt(entry.fileID, 16);
    if (table.recordForFileID(id, resolution.platform, resolution.dictionary)?.path !== path)
      continue;
    // The file's own bytes; any integrity trailer follows them.
    return file.content;
  }
  return undefined;
}

/**
 * The bytes the OEM Configuration partition keeps of one file, by its path — the build's
 * copy of the same file `fileBytes` reads from the volume.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.recordBytes
 */
export function recordBytes(
  path: string,
  fitc: OEMConfiguration | undefined,
  table: FileTable | undefined,
  mfsInfo: MFSVolumeInfo | undefined,
  bytes: Uint8Array,
  baseOffset: number
): Uint8Array | undefined {
  const payload = fitc?.payloadOffset;
  const records = fitc?.recordsByID;
  if (payload === undefined || records === undefined || table === undefined) return undefined;
  const resolution = table.resolve(mfsInfo?.ftblPlatform ?? -1, mfsInfo?.ftblDictionary ?? -1);
  for (const record of records) {
    if (
      table.recordForFileID(record.fileID, resolution.platform, resolution.dictionary)?.path !==
      path
    ) {
      continue;
    }
    const at = payload - baseOffset + record.offset;
    if (at < 0 || record.size <= 0 || at + record.size > bytes.length) continue;
    return bytes.subarray(at, at + record.size);
  }
  return undefined;
}
