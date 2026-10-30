import {
  conditionsHold,
  configurationConditions,
  configurationPage,
} from "@/firmware/me/configuration/configurationDecoder";
import { gpioPinMapForME, gpioPins } from "@/firmware/me/configuration/gpioPinMap";
import {
  cpuStrapMapForME,
  mipCPUStraps,
  mipStrapContainers,
  mipStrapMapForME,
  sphyNvarMapForME,
  sphyNvarReadings,
} from "@/firmware/me/configuration/layoutMaps";
import {
  configurationFileAt,
  configurationMapForME,
  platformFamilyOfStrapWords,
} from "@/firmware/me/configuration/meConfigurationMap";
import { uepMapForME, uepReadings } from "@/firmware/me/configuration/uepMap";
import type { FileTable } from "@/firmware/me/data/fileTable";
import { regionBytes } from "@/firmware/me/engine/benchFacts";
import { fitcConfigPayload } from "@/firmware/me/fileSystem/efs";
import type { MFSVolumeInfo } from "@/firmware/me/fileSystem/mfs";
import { pchStrapWords } from "@/firmware/me/layout/flashDescriptor";
import type {
  ConfigurationFile,
  ConfigurationPage,
  CPUStrapReadings,
  GPIOPinReadings,
  MEPlatformFamily,
  MIPStrapContainerReadings,
  MIPStrapReading,
  UEPReading,
} from "@/firmware/me/models/configurationFacts";
import type {
  MFSHomeRecord,
  MFSVolume,
  OEMConfiguration,
} from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/**
 * The ME configuration an image carries, read through the tools' own layouts: the MFS
 * configuration files (both copies), the feature pins, the FPF/UEP bits and CSME 18's
 * MIP, CPU-message and SPHY containers. Ours: none of it is MEAnalyzer's.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/MEFirmwareAnalyzer.swift#MEFirmwareAnalyzer.analyze
 * @upstream-differs a function of its own over what the analysis read, where upstream reads them in
 * the body of `analyze`
 */
export interface ConfigurationFacts {
  readonly platformFamily: MEPlatformFamily | undefined;
  readonly configuration: readonly ConfigurationFile[] | undefined;
  readonly gpioPins: GPIOPinReadings | undefined;
  readonly uepSettings: readonly UEPReading[] | undefined;
  readonly cpuStraps: CPUStrapReadings | undefined;
  readonly mipStraps: readonly MIPStrapContainerReadings[] | undefined;
  readonly sphyNvar: readonly MIPStrapReading[] | undefined;
}

/** The FPT regions as the analysis lists them. */
interface Region {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

/**
 * Which half of the generation the board is — mobile or desktop — is the descriptor's
 * answer: the two halves lay the PCH strap section out over different lengths, and
 * nothing else in a dump says which it is. A fact about the board rather than the
 * firmware, so it is answered even by an analysis with no manifest.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.platformFamily
 */
export function platformFamilyOf(
  descriptorBytes: Uint8Array | undefined
): MEPlatformFamily | undefined {
  const words = descriptorBytes === undefined ? undefined : pchStrapWords(descriptorBytes);
  return words === undefined ? undefined : platformFamilyOfStrapWords(words);
}

const GPIO_PATH = "/home/gpio/csme_pins";

export function readConfigurationFacts(options: {
  readonly bytes: Uint8Array;
  readonly baseOffset: number;
  readonly regions: readonly Region[];
  readonly identity: { readonly family: FirmwareFamily; readonly major: number };
  readonly mfsInfo: MFSVolumeInfo | undefined;
  readonly mfsVolume: MFSVolume | undefined;
  readonly oemConfiguration: OEMConfiguration | undefined;
  readonly fileTable: FileTable | undefined;
  readonly platformFamily: MEPlatformFamily | undefined;
}): ConfigurationFacts {
  const { bytes, baseOffset, regions, identity, mfsInfo, mfsVolume, oemConfiguration, fileTable } =
    options;
  const major = identity.major;

  // The map is the one this generation and this half of it have: a generation nobody
  // has mapped reads no configuration at all, and a half a dump cannot name is read as
  // the mobile one.
  const map = configurationMapForME(major, options.platformFamily);
  const imageBytes = new Map<string, Uint8Array>();
  const liveBytes = new Map<string, Uint8Array>();
  let gpio: GPIOPinReadings | undefined;

  if (map !== undefined && mfsInfo !== undefined && mfsInfo.files.length > 0) {
    // How long each file's content is, where the Integrity split said: the raw chain
    // carries the trailer and the table after it, and a setting is never read out of those.
    const contentSizes = new Map<number, number>();
    for (const recorded of mfsVolume?.files ?? []) {
      if (recorded.contentSize !== undefined)
        contentSizes.set(recorded.index, recorded.contentSize);
    }
    // The tool's path for each file: the image's file table where the volume is an FTBL
    // one, and otherwise the volume's own home directory — a CSME 11 or 12 volume keeps
    // its names there and carries no `FileTable.dat`.
    const pathByIndex = new Map<number, string>();
    if (mfsInfo.usesFTBL && fileTable !== undefined) {
      const resolution = fileTable.resolve(mfsInfo.ftblPlatform, mfsInfo.ftblDictionary);
      const naming = fileTable.recordsForFileIndices(
        mfsInfo.files.map((file) => file.index),
        resolution.platform,
        resolution.dictionary
      );
      for (const file of mfsInfo.files) {
        const entry = naming.get(file.index);
        if (entry === undefined) continue;
        const path = fileTable.recordForFileID(
          Number.parseInt(entry.fileID, 16),
          resolution.platform,
          resolution.dictionary
        )?.path;
        if (path !== undefined) pathByIndex.set(file.index, path);
      }
    } else if (mfsVolume?.homeDirectory !== undefined) {
      const walk = (records: readonly MFSHomeRecord[], prefix: string) => {
        for (const record of records) {
          const path = `${prefix}/${record.name}`;
          if (record.isFolder) walk(record.children, path);
          else pathByIndex.set(record.fileIndex, path);
        }
      };
      walk(mfsVolume.homeDirectory.entries, "/home");
    }
    for (const file of mfsInfo.files) {
      const path = pathByIndex.get(file.index);
      if (path === undefined || configurationFileAt(map, path) === undefined) continue;
      const size = contentSizes.get(file.index);
      liveBytes.set(path, size === undefined ? file.content : file.content.subarray(0, size));
    }

    // `/home/gpio/csme_pins` is the file the tool's `MeFeaturePins` settings are built
    // into, read on its own. On CSME 11 and 12 it is a record of the MFS's Intel
    // Configuration stream — the OEM stream (owning file 7) overriding the Intel one (6) —
    // and where the volume names its files by ID, a file of its own.
    let pinBytes: Uint8Array | undefined;
    const pinStreams = (mfsVolume?.configurations ?? []).filter((stream) =>
      stream.records.some((record) => record.name === "csme_pins" && !record.isFolder)
    );
    const pinStream = pinStreams.find((stream) => stream.owningFile === 7) ?? pinStreams[0];
    const pin = pinStream?.records.find(
      (record) => record.name === "csme_pins" && !record.isFolder
    );
    const owning = mfsInfo.files.find((file) => file.index === pinStream?.owningFile);
    if (
      pin !== undefined &&
      owning !== undefined &&
      pin.size > 0 &&
      pin.offset + pin.size <= owning.content.length
    ) {
      pinBytes = owning.content.subarray(pin.offset, pin.offset + pin.size);
    } else {
      const pinIndex = [...pathByIndex].find(([, path]) => path === GPIO_PATH)?.[0];
      const file = mfsInfo.files.find((one) => one.index === pinIndex);
      if (pinIndex !== undefined && file !== undefined && file.content.length > 0) {
        pinBytes = file.content.subarray(0, contentSizes.get(pinIndex) ?? file.content.length);
      }
    }
    const pinMap = gpioPinMapForME(major);
    const pins =
      pinBytes === undefined || pinBytes.length === 0 || pinMap === undefined
        ? undefined
        : gpioPins(pinBytes, pinMap, major);
    if (pins !== undefined && pins.length > 0) gpio = { path: GPIO_PATH, fromImage: false, pins };
  }

  // The build's copy of each file: the OEM Configuration partition's record of it.
  const records = buildRecords(oemConfiguration, fileTable, mfsInfo, bytes, baseOffset);
  if (map !== undefined) {
    for (const [path, record] of records) {
      if (configurationFileAt(map, path) !== undefined) imageBytes.set(path, record);
    }
  }
  // Where the live file system does not carry the pin file, the build's copy is read.
  const pinMap = gpioPinMapForME(major);
  const builtPins = records.find(([path]) => path === GPIO_PATH)?.[1];
  if (gpio === undefined && pinMap !== undefined && builtPins !== undefined) {
    const pins = gpioPins(builtPins, pinMap, major);
    if (pins !== undefined && pins.length > 0) gpio = { path: GPIO_PATH, fromImage: true, pins };
  }

  let configuration: ConfigurationFile[] | undefined;
  if (map !== undefined) {
    // Which branch of each conditionally placed setting the image holds — read once,
    // from the same two pages the files are, so a value and the place it was read from agree.
    const conditions = configurationConditions(map, imageBytes, liveBytes);
    const marked = (page: ConfigurationPage | undefined): ConfigurationPage | undefined =>
      page === undefined
        ? undefined
        : {
            size: page.size,
            settings: page.settings.map((setting) => ({
              ...setting,
              condition: conditions.placed.get(setting.name),
              disabled: conditions.disabled.get(setting.name),
            })),
          };
    configuration = [];
    for (const layout of map.files) {
      // A conditional place the image does not hold is not a row of this file.
      const settings = layout.settings.filter((setting) =>
        conditionsHold(conditions, setting, layout.path)
      );
      if (settings.length === 0) continue;
      const kept = { ...layout, settings };
      const image = imageBytes.get(layout.path);
      const live = liveBytes.get(layout.path);
      const fitc = image === undefined ? undefined : configurationPage(kept, image);
      const mfs = live === undefined ? undefined : configurationPage(kept, live);
      if (fitc === undefined && mfs === undefined) continue;
      configuration.push({
        path: layout.path,
        alias: layout.alias,
        fitc: marked(fitc),
        mfs: marked(mfs),
      });
    }
  }

  // The FPF settings the area's bit arrays record, through the tool's own layout for
  // this generation. Most of them read zero on a vendor dump; that is the state the build wrote.
  const uepArea = regionBytes("UEP", regions, bytes, baseOffset);
  const uepMap = uepMapForME(major);
  const uepSettings =
    uepArea === undefined || uepMap === undefined ? undefined : uepReadings(uepArea, uepMap);

  // CSME 18 keeps the CPU strap message and the MIP table's other containers in the FITC
  // partition's MIP table (`smip` nvar), and the SPHY OEM configuration beside it.
  const fitcRegion = regions.find((one) => one.name === "FITC");
  const payload =
    fitcRegion === undefined
      ? undefined
      : fitcConfigPayload(bytes, fitcRegion.offset - baseOffset, fitcRegion.size);
  const cpuMap = cpuStrapMapForME(major);
  const mipMap = mipStrapMapForME(major);
  const sphyMap = sphyNvarMapForME(major);

  return {
    platformFamily: options.platformFamily,
    configuration:
      configuration === undefined || configuration.length === 0 ? undefined : configuration,
    gpioPins: gpio,
    uepSettings,
    cpuStraps:
      payload === undefined || cpuMap === undefined ? undefined : mipCPUStraps(payload, cpuMap),
    mipStraps:
      payload === undefined || mipMap === undefined
        ? undefined
        : mipStrapContainers(payload, mipMap),
    sphyNvar:
      payload === undefined || sphyMap === undefined
        ? undefined
        : sphyNvarReadings(payload, sphyMap),
  };
}

/** The OEM Configuration partition's records, in its order, with the path the file table gives each. */
function buildRecords(
  fitc: OEMConfiguration | undefined,
  table: FileTable | undefined,
  mfsInfo: MFSVolumeInfo | undefined,
  bytes: Uint8Array,
  baseOffset: number
): [string, Uint8Array][] {
  const found: [string, Uint8Array][] = [];
  const payload = fitc?.payloadOffset;
  if (payload === undefined || fitc?.recordsByID === undefined || table === undefined) return found;
  const resolution = table.resolve(mfsInfo?.ftblPlatform ?? -1, mfsInfo?.ftblDictionary ?? -1);
  for (const record of fitc.recordsByID) {
    const path = table.recordForFileID(
      record.fileID,
      resolution.platform,
      resolution.dictionary
    )?.path;
    const at = payload - baseOffset + record.offset;
    if (path === undefined || at < 0 || record.size <= 0 || at + record.size > bytes.length)
      continue;
    found.push([path, bytes.subarray(at, at + record.size)]);
  }
  return found;
}
