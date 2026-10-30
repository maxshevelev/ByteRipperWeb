import { bitField } from "@/firmware/me/configuration/bitField";
import type {
  MapCondition,
  MapSetting,
  MEConfigurationFileLayout,
  MEConfigurationMap,
} from "@/firmware/me/configuration/meConfigurationMap";
import type {
  ConfigurationCondition,
  ConfigurationPage,
  ConfigurationSetting,
} from "@/firmware/me/models/configurationFacts";

/**
 * Reading the ME configuration out of an image: a file's bytes, the map's layout of it,
 * and the values that come out. Generation-agnostic — it takes whichever map belongs to
 * the image — and the same read for both copies an image keeps of a file, the build's
 * and the file system's.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationDecoder
 */

/**
 * What an image's two pages say about a map's conditional places.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationConditions
 */
export interface ConfigurationConditions {
  /**
   * Setting name → the branch file the image holds it in.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationConditions.branch
   */
  readonly branch: ReadonlyMap<string, string | undefined>;
  /**
   * The condition each conditionally placed setting was placed by.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationConditions.placed
   */
  readonly placed: ReadonlyMap<string, ConfigurationCondition>;
  /**
   * The condition each switched-off setting is off under.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationConditions.disabled
   */
  readonly disabled: ReadonlyMap<string, ConfigurationCondition>;
}

/**
 * Whether the map's place of `setting` in `path` is the one the image holds: a place
 * that always holds, or the branch chosen for it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationConditions.holds
 */
export const conditionsHold = (
  conditions: ConfigurationConditions,
  setting: MapSetting,
  path: string
): boolean => setting.condition === undefined || conditions.branch.get(setting.name) === path;

const hexByte = (byte: number) => byte.toString(16).toUpperCase().padStart(2, "0");

/**
 * The settings a file's bytes carry, in the map's order. A setting whose field runs past
 * the bytes there are is left out: a value read out of the next file's bytes would be
 * worse than no value.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationDecoder.settings
 */
export function configurationSettings(
  file: MEConfigurationFileLayout,
  bytes: Uint8Array
): ConfigurationSetting[] {
  const result: ConfigurationSetting[] = [];
  for (const setting of file.settings) {
    if (
      setting.length <= 0 ||
      setting.offset < 0 ||
      setting.offset + setting.length > bytes.length
    ) {
      continue;
    }
    const base = {
      name: setting.name,
      auto: setting.auto,
      condition: undefined,
      disabled: undefined,
    };
    // Wider than a machine word: carried as the bytes themselves, which is all a 256-byte
    // PKI suffix or a SHA-384 hash is. A bitfield is never one of these.
    if (setting.length > 8) {
      if (setting.bits !== undefined) continue;
      const field = bytes.subarray(setting.offset, setting.offset + setting.length);
      result.push({ ...base, number: undefined, bytes: [...field].map(hexByte).join("") });
      continue;
    }
    let value: bigint | undefined;
    if (setting.bits !== undefined) {
      const { low, high } = setting.bits;
      if (low < 0 || high >= setting.length * 8) continue;
      value = bitField(bytes, setting.offset, low, high - low + 1);
    } else {
      value = bitField(bytes, setting.offset, 0, setting.length * 8);
    }
    if (value === undefined) continue;
    // A value a JavaScript number cannot hold exactly goes as its hex.
    result.push(
      value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? { ...base, number: Number(value), bytes: undefined }
        : { ...base, number: undefined, bytes: value.toString(16).toUpperCase() }
    );
  }
  return result;
}

/**
 * The branch of each conditionally placed setting the image holds, and the settings the
 * tool switches off in it.
 *
 * A condition's own value is read from the same two pages the tab shows, the build's
 * copy first. Where neither page carries the file the condition lives in, the branch is
 * the one whose file the image does carry, marked `assumed`. Where neither branch's file
 * is there, neither is kept.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationDecoder.conditions
 */
export function configurationConditions(
  map: MEConfigurationMap,
  imageBytes: ReadonlyMap<string, Uint8Array>,
  liveBytes: ReadonlyMap<string, Uint8Array>
): ConfigurationConditions {
  const branch = new Map<string, string | undefined>();
  const placed = new Map<string, ConfigurationCondition>();
  const disabled = new Map<string, ConfigurationCondition>();

  const conditionValue = (condition: MapCondition): number | undefined => {
    for (const pages of [imageBytes, liveBytes]) {
      for (const file of map.files) {
        const setting = file.settings.find((one) => one.name === condition.name);
        const data = pages.get(file.path);
        if (setting === undefined || data === undefined) continue;
        const number = configurationSettings({ ...file, settings: [setting] }, data)[0]?.number;
        if (number !== undefined) return number;
      }
    }
    return undefined;
  };
  const present = (path: string) => imageBytes.has(path) || liveBytes.has(path);

  // The conditions themselves first: the value each must have is one fact, and every
  // setting placed under it takes the same one.
  const conditional = new Map<string, MapCondition>();
  for (const file of map.files) {
    for (const setting of file.settings) {
      if (setting.condition !== undefined && !conditional.has(setting.name)) {
        conditional.set(setting.name, setting.condition);
      }
    }
  }
  const values = new Map<string, { readonly value: number; readonly assumed: boolean }>();
  for (const name of new Set([...conditional.values()].map((one) => one.name))) {
    const decided = conditionValue({ name, value: 0 });
    if (decided !== undefined) {
      values.set(name, { value: decided, assumed: false });
      continue;
    }
    // Not in the image: the branch whose file is here names the value, and the reading
    // is marked assumed. The two branches of one condition live in different files.
    for (const file of map.files) {
      const setting = file.settings.find((one) => one.condition?.name === name);
      if (setting?.condition !== undefined && present(file.path)) {
        values.set(name, { value: setting.condition.value, assumed: true });
        break;
      }
    }
  }
  for (const [setting, condition] of conditional) {
    const decided = values.get(condition.name);
    if (decided === undefined) continue;
    branch.set(
      setting,
      map.files.find((file) =>
        file.settings.some((one) => one.name === setting && one.condition?.value === decided.value)
      )?.path
    );
    placed.set(setting, { name: condition.name, value: decided.value, assumed: decided.assumed });
  }
  // The settings the tool switches off, where the image holds the value the condition
  // names. Nothing is claimed where the value is not in the image.
  for (const file of map.files) {
    for (const setting of file.settings) {
      const condition = setting.disabledBy;
      if (condition === undefined || disabled.has(setting.name)) continue;
      if (conditionValue(condition) !== condition.value) continue;
      disabled.set(setting.name, { name: condition.name, value: condition.value, assumed: false });
    }
  }
  return { branch, placed, disabled };
}

/**
 * One of a file's two copies, as the bytes an image carries give it. Nothing where the
 * bytes hold none of the map's settings — a file of another shape rather than an empty
 * one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/ConfigurationDecoder.swift#ConfigurationDecoder.page
 */
export function configurationPage(
  layout: MEConfigurationFileLayout,
  bytes: Uint8Array
): ConfigurationPage | undefined {
  const settings = configurationSettings(layout, bytes);
  return settings.length === 0 ? undefined : { size: bytes.length, settings };
}
