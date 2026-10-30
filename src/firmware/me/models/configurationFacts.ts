/**
 * The ME configuration an image carries, read through Intel's own tools' layouts:
 * the MFS configuration files, the FPF/UEP bits, the feature pins and CSME 18's MIP,
 * CPU-message and SPHY containers. Ours, upstream's too: MEAnalyzer reads none of it.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift` and the
 * `Configuration/` readers' result types, the window `9ceb2c4..bb5e9a2`.
 */

/**
 * Which half of a chipset generation a board is: the mobile parts — the tool's `_lp`
 * and `_p` families — or the desktop ones, its `_h` and `_s`. A few settings are laid
 * out differently between the two, so the map that reads them has to be the board's
 * own. The firmware does not say; the descriptor's PCH strap section length does.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.MEPlatformFamily
 */
export type MEPlatformFamily = "mobile" | "desktop";

/**
 * One configuration file of an image: a file the ME configuration keeps settings in,
 * and the two copies of it a dump carries — the build's, in the OEM Configuration
 * (FITC) partition, and the file system's, the state in force. A setting the platform
 * rewrote and a setting the build chose look the same in one column, so neither copy is
 * dropped: the panel shows them side by side and marks the pairs that disagree.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.init
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.id
 */
export interface ConfigurationFile {
  /**
   * The MFS path, as the panel's tree prints it (`/home/mca/eom_config`).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.path
   */
  readonly path: string;
  /**
   * MFIT's own name for the file, as its panel's file list shows it.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.alias
   */
  readonly alias: string;
  /**
   * The build's copy. Undefined where the image has no such partition, the partition no
   * such record, or the record is shorter than the map's first field.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.fitc
   */
  readonly fitc: ConfigurationPage | undefined;
  /**
   * The file system's copy: the state in force. Undefined where the volume holds no such
   * file, or its File IDs could not be resolved.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.mfs
   */
  readonly mfs: ConfigurationPage | undefined;
}

/**
 * One of the two copies: how many bytes of it there are, and the settings they hold.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.Page
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.Page.init
 */
export interface ConfigurationPage {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.Page.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationFile.Page.settings */
  readonly settings: readonly ConfigurationSetting[];
}

/**
 * One setting of one configuration file, as the bytes gave it: MFIT's name for the
 * setting, and the value. A setting the file is too short to hold is left out rather
 * than guessed at.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.init
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.id
 */
export interface ConfigurationSetting {
  /**
   * The setting's identifier, the same word in every language.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.name
   */
  readonly name: string;
  /**
   * The value as a number: the bits of a bitfield where the catalogue gives bits, the
   * field's own little-endian value otherwise, up to eight bytes.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.number
   * @upstream-differs a field whose value is past 2^53 is carried in `bytes` as its value in hex,
   * since a JavaScript number cannot hold it exactly
   */
  readonly number: number | undefined;
  /**
   * The value as hex where the field is wider than eight bytes.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.bytes
   */
  readonly bytes: string | undefined;
  /**
   * Whether MFIT marks the setting `Auto`: the platform writes it, and a build carries
   * only a placeholder.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.auto
   */
  readonly auto: boolean;
  /**
   * The condition the tool placed the setting under, where it placed it conditionally —
   * and which branch this image holds. Undefined for a place that always holds.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.condition
   */
  readonly condition: ConfigurationCondition | undefined;
  /**
   * The condition the tool switches the setting off under, where the image holds the
   * value the condition names: the value is there and does not apply.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationSetting.disabled
   */
  readonly disabled: ConfigurationCondition | undefined;
}

/**
 * A condition a configuration setting is placed — or switched off — by, as this image
 * answers it: the other setting's identifier and the value it has.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationCondition
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationCondition.init
 */
export interface ConfigurationCondition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationCondition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationCondition.value */
  readonly value: number;
  /**
   * The branch was chosen because the condition's own value was not in the image, and
   * the file that carries the setting was: the reading rests on which files are there.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ConfigurationCondition.assumed
   */
  readonly assumed: boolean;
}

/**
 * The feature pins `/home/gpio/csme_pins` records, decoded through the tool's own value
 * classes. `fromImage` says which copy the bytes came from — the OEM Configuration
 * partition's record (what the build wrote) or the live MFS.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GPIOPinReadings
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GPIOPinReadings.init
 */
export interface GPIOPinReadings {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GPIOPinReadings.path */
  readonly path: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GPIOPinReadings.fromImage */
  readonly fromImage: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#GPIOPinReadings.pins */
  readonly pins: readonly GPIOPin[];
}

/**
 * One configured feature pin.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.init
 */
export interface GPIOPin {
  /**
   * The feature set's name (`GPIO_TOUCH_FEATURE_ID`); undefined on CSME 11, whose record
   * carries none, and where the number has no name in the map.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.feature
   */
  readonly feature: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.featureID */
  readonly featureID: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.usage */
  readonly usage: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.usageID */
  readonly usageID: number;
  /**
   * The group's name (`GPP_E`), undefined where the tool's documents disagree.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.group
   */
  readonly group: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.groupID */
  readonly groupID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.pad */
  readonly pad: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.ownership */
  readonly ownership: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.ownershipID */
  readonly ownershipID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.padMode */
  readonly padMode: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.padModeID */
  readonly padModeID: number;
}

/**
 * The pin as the tool writes a setting (`GPP_E_4`), or its number where the group's
 * name is one the documents disagree about.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPin.pinName
 */
export const gpioPinName = (pin: GPIOPin): string =>
  pin.group === undefined ? `${pin.groupID}:${pin.pad}` : `${pin.group}_${pin.pad}`;

/**
 * One setting of the UEP area as an image holds it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReading
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReading.init
 */
export interface UEPReading {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReading.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReading.value */
  readonly value: number;
}

/**
 * One field of a strap container or the SPHY nvar, as an image holds it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapReading
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapReading.init
 */
export interface MIPStrapReading {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapReading.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapReading.value */
  readonly value: number;
}

/**
 * One of the MIP table's strap containers as an image holds it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings.init
 */
export interface MIPStrapContainerReadings {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings.blockType */
  readonly blockType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings.length */
  readonly length: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapContainerReadings.readings */
  readonly readings: readonly MIPStrapReading[];
}

/**
 * One field of the CPU strap message as an image holds it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReading
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReading.init
 */
export interface CPUStrapReading {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReading.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReading.value */
  readonly value: number;
}

/**
 * The CPU strap message a CSME 18 image keeps in its FITC partition's MIP table: its
 * fields, its length and its CRC-16, checked.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings.init
 */
export interface CPUStrapReadings {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings.readings */
  readonly readings: readonly CPUStrapReading[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings.messageLengthWords */
  readonly messageLengthWords: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings.crcStored */
  readonly crcStored: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapReadings.crcValid */
  readonly crcValid: boolean;
}
