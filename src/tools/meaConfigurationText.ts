import { L } from "@/core/localization/localization";
import type {
  MapSetting,
  MEConfigurationMap,
} from "@/firmware/me/configuration/meConfigurationMap";
import type {
  ConfigurationCondition,
  ConfigurationFile,
  ConfigurationSetting,
} from "@/firmware/me/models/configurationFacts";

/**
 * The «Configuration» tab's words: the value of one configuration setting in one of the two
 * copies, and the heading of the file they belong to. The value is written the way MFIT writes
 * it: the label its database gives a number where it has one, the number itself where not.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText
 */

/**
 * The two copies of a configuration file, as the tab's column headings name them — the trade's
 * words, the names MFIT's own panel uses.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationFITC
 */
export const configurationFITC = (): string => L("FITC");
/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationMFS */
export const configurationMFS = (): string => L("MFS");

/**
 * What a column shows where that copy of the file is not there at all: a dash rather than a
 * zero — zero is a value, and this is its absence.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationAbsent
 */
export const CONFIGURATION_ABSENT = "—";

/**
 * One setting's value as one column reads it, or nothing where that copy of the file does not
 * carry the setting. A bitfield or a single byte as a number, a number of its own in hex as MFIT
 * writes it, a number the map enumerates by its label, text as its characters.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationValue
 */
export function configurationValue(
  setting: ConfigurationSetting | undefined,
  layout: MapSetting | undefined
): string | undefined {
  if (setting === undefined) return undefined;
  if (layout?.text === true) {
    const text = textOf(setting);
    if (text !== undefined) return text;
  }
  // Wider than eight bytes — or past what a number holds exactly: the bytes themselves, in hex.
  if (setting.number === undefined) return setting.bytes;
  const label = layout?.options?.get(setting.number);
  if (label !== undefined) return label;
  const hex = layout?.hex ?? setting.bytes !== undefined;
  return hex ? `0x${setting.number.toString(16).toUpperCase()}` : `${setting.number}`;
}

/**
 * A text field's characters: the bytes as they stand, cut at the first null.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.text
 */
function textOf(setting: ConfigurationSetting): string | undefined {
  const hex = setting.bytes;
  if (hex === undefined) return undefined;
  const characters: number[] = [];
  for (let at = 0; at + 2 <= hex.length; at += 2) {
    const byte = Number.parseInt(hex.slice(at, at + 2), 16);
    if (Number.isNaN(byte)) return undefined;
    if (byte === 0) break;
    characters.push(byte);
  }
  return new TextDecoder().decode(Uint8Array.from(characters));
}

/**
 * The quiet half of a file's heading: where the file lives, without the `/home` every one of
 * these paths begins with, and how long it is in decimal.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationFileDetail
 */
export function configurationFileDetail(file: ConfigurationFile): string {
  const path = file.path.startsWith("/home/") ? file.path.slice("/home".length) : file.path;
  const size = file.mfs?.size ?? file.fitc?.size ?? 0;
  return L("%1$@, %2$@ bytes", path, `${size}`);
}

/**
 * The mark MFIT puts on a setting it fills in itself rather than taking from a build.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationAuto
 */
export const configurationAuto = (auto: boolean): string => (auto ? L("auto") : "");

/**
 * What placed a setting the tool places conditionally — `eSpiEnabled = No` — and `, assumed`
 * where the branch was told from the files the image carries.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationCondition
 */
export function configurationCondition(
  condition: ConfigurationCondition,
  map: MEConfigurationMap
): string {
  const text = L("%1$@ = %2$@", condition.name, conditionWord(condition, map));
  return condition.assumed ? L("%1$@, assumed", text) : text;
}

/**
 * What switches a setting off in this image: `disabled by eSpiEnabled = Yes`.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.configurationDisabled
 */
export const configurationDisabled = (
  condition: ConfigurationCondition,
  map: MEConfigurationMap
): string => L("disabled by %1$@", configurationCondition(condition, map));

/**
 * The word a condition's number stands for, where the tool's own value class says.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAConfigurationText.swift#MEAText.conditionWord
 */
function conditionWord(condition: ConfigurationCondition, map: MEConfigurationMap): string {
  const setting = map.files
    .flatMap((file) => file.settings)
    .find((one) => one.name === condition.name);
  return setting?.options?.get(condition.value) ?? `${condition.value}`;
}
