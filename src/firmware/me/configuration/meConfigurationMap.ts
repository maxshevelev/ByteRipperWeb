import { meConfigurationMapById } from "@/firmware/me/configuration/meConfigurationData";
import type { MEPlatformFamily } from "@/firmware/me/models/configurationFacts";

/**
 * The ME configuration, file by file: which settings MFIT's own settings database says
 * live in which MFS file, at what offset, in which bits, and what their values may say.
 *
 * **A map is per generation, because MFIT's own database is.** The file lists differ
 * between tool versions and platforms, the offsets inside a file move, and a generation
 * nobody has mapped is read as *no* configuration rather than through another
 * generation's layout — a wrong offset read as a value is worse than a row that is not
 * there. The maps are compiled data upstream (`ConfigMaps.bin`); the FPF/UEP settings
 * are not files of the MFS and are read by `uepMap.ts` and `layout/bootGuard.ts`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.init
 */
export interface MEConfigurationMap {
  /**
   * What the map is, and which MFIT build it was curated from — said in the panel, so a
   * reader knows whose layout a value came out of.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.name
   */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.files */
  readonly files: readonly MEConfigurationFileLayout[];
}

/**
 * The value another setting must have for a place to hold, or for a setting to be
 * switched off — the tool's `source` and `conditionalVal` / `sourceVal`, resolved to the
 * number it stands for.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Condition
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Condition.init
 */
export interface MapCondition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Condition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Condition.value */
  readonly value: number;
}

/**
 * One setting of one file, as MFIT lays it out.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.init
 */
export interface MapSetting {
  /**
   * The setting's identifier (`MELanPowerWell`), as the tool's own layouts spell it — so
   * it stays untranslated.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.name
   */
  readonly name: string;
  /**
   * What the tool's panel shows for the setting where that is not the identifier — "LAN
   * Power Well". Undefined where the tool states none.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.label
   */
  readonly label: string | undefined;
  /**
   * Byte offset into the file's content.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.offset
   */
  readonly offset: number;
  /**
   * The field's length in bytes — of the word the bits are counted in, for a bitfield.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.length
   */
  readonly length: number;
  /**
   * Which bits of that word the setting is, inclusive, where it is a bitfield.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.bits
   * @upstream-differs the closed range is its two ends
   */
  readonly bits: { readonly low: number; readonly high: number } | undefined;
  /**
   * What the tool's panel says about the setting, in its own English words.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.help
   */
  readonly help: string | undefined;
  /**
   * The values the setting may take, by their number, in MFIT's words.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.options
   */
  readonly options: ReadonlyMap<number, string> | undefined;
  /**
   * True where MFIT marks the setting `Auto`: the tool works it out and writes it, so a
   * file carries only what the tool put there.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.auto
   */
  readonly auto: boolean;
  /**
   * True where the field is a number MFIT writes in hex.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.hex
   */
  readonly hex: boolean;
  /**
   * True where the field is text rather than a number — a PKI suffix, a domain name.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.text
   */
  readonly text: boolean;
  /**
   * Where the tool places the setting here only under a condition — its
   * `buildConditional` actions. Undefined for a place that always holds.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.condition
   */
  readonly condition: MapCondition | undefined;
  /**
   * What the tool switches the setting off under — its `DisableIf` action.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.Setting.disabledBy
   */
  readonly disabledBy: MapCondition | undefined;
}

/** A setting with the fields a hand-written one leaves out filled in as upstream's initialiser does. */
export function mapSetting(
  name: string,
  offset: number,
  length: number,
  extra: Partial<Omit<MapSetting, "name" | "offset" | "length">> = {}
): MapSetting {
  return {
    name,
    offset,
    length,
    label: extra.label,
    help: extra.help,
    condition: extra.condition,
    disabledBy: extra.disabledBy,
    bits: extra.bits,
    options: extra.options,
    auto: extra.auto ?? false,
    hex: extra.hex ?? false,
    text: extra.text ?? false,
  };
}

/**
 * One configuration file: the path the MFS knows it by, MFIT's alias for it, and the
 * settings it holds.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.File
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.File.init
 */
export interface MEConfigurationFileLayout {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.File.path */
  readonly path: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.File.alias */
  readonly alias: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.File.settings */
  readonly settings: readonly MapSetting[];
}

/**
 * The half a PCH strap section of `words` words belongs to, or nothing where the length
 * is one neither half uses. 69, 70 and 74 are Cannon Point LP, Tiger Point LP and Ice
 * Point LP; 90, 101 and 115 are Cannon Point H, Tiger Point H and Alder Point S —
 * measured upstream on the dumps at hand.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.MEPlatformFamily.init
 */
export function platformFamilyOfStrapWords(words: number): MEPlatformFamily | undefined {
  if (words === 69 || words === 70 || words === 74) return "mobile";
  if (words === 90 || words === 101 || words === 115) return "desktop";
  return undefined;
}

/**
 * The map for a ME generation's major number, or nothing where none has been made for
 * it yet. `family` names the half of the generation the board is, where the dump says:
 * CSME 12, 13, 14 and 15 have a map for each, and CSME 11 and 16 one for both. Nothing
 * is a dump that did not say, and is read as the mobile one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.forME
 */
export function configurationMapForME(
  major: number,
  family?: MEPlatformFamily
): MEConfigurationMap | undefined {
  const desktop = family === "desktop";
  const ids: Readonly<Record<number, string>> = {
    11: "csme11",
    12: desktop ? "csme12Desktop" : "csme12",
    13: desktop ? "csme13Desktop" : "csme13",
    14: desktop ? "csme14Desktop" : "csme14",
    15: desktop ? "csme15Desktop" : "csme15",
    16: "csme16",
    18: "csme18",
  };
  const id = ids[major];
  const map = id === undefined ? undefined : meConfigurationMapById(id);
  return map === undefined ? undefined : addingManufacturingLock(map);
}

/**
 * The live record of the board's End of Manufacturing, appended to every map — the one
 * entry whose words are ours, not the tool's. The build writes `/home/mca/manuf_lock`
 * with a zero and the platform sets it to 1 when it closes End of Manufacturing. The
 * tool's own entry is replaced where a map has one: the byte is one fact, and a bench
 * reads it by the name the Summary uses.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.addingManufacturingLock
 */
function addingManufacturingLock(map: MEConfigurationMap): MEConfigurationMap {
  const path = "/home/mca/manuf_lock";
  const entry: MEConfigurationFileLayout = {
    path,
    alias: "ManufLock",
    settings: [
      mapSetting("ManufLock", 0, 1, {
        label: "Manufacturing Lock",
        options: new Map([
          [0, "Not locked"],
          [1, "Locked"],
        ]),
      }),
    ],
  };
  const at = map.files.findIndex((file) => file.path === path);
  const files = [...map.files];
  if (at >= 0) files[at] = entry;
  else files.push(entry);
  return { ...map, files };
}

/**
 * The map's entry for a path, where it has one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationMap.swift#MEConfigurationMap.file
 */
export const configurationFileAt = (
  map: MEConfigurationMap,
  path: string
): MEConfigurationFileLayout | undefined => map.files.find((file) => file.path === path);
