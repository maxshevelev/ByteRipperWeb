import {
  configurationFileAt,
  configurationMapForME,
} from "@/firmware/me/configuration/meConfigurationMap";
import type { ConfigurationCondition } from "@/firmware/me/models/configurationFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import {
  configurationAuto,
  configurationCondition,
  configurationDisabled,
  configurationFileDetail,
  configurationValue,
} from "@/tools/meaConfigurationText";

/**
 * One row of the Configuration tab: a setting, and the value each copy of the file it lives in
 * gives it — kept apart rather than resolved into one, because they answer different
 * questions: what the build wrote is what a board is meant to get, and what the file system
 * holds is what it has. Undefined is a copy that does not carry the setting at all.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.init
 */
export interface MEAConfigurationRow {
  /**
   * The setting's name in MFIT's own words, with its `Auto` mark where the database gives one.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.name
   */
  readonly name: string;
  /**
   * The identifier the map lays the setting out by (`MELanPowerWell`), which heads its help.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.identifier
   */
  readonly identifier: string;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.help */
  readonly help: string | undefined;
  /**
   * What the row's `?` says under the identifier: what placed the setting, and what switches it
   * off. The popover's subtitle, not the row's.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.note
   */
  readonly note: string | undefined;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.condition */
  readonly condition: ConfigurationCondition | undefined;
  /**
   * The tool switches the setting off in this image: its value is there and does not apply.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.disabled
   */
  readonly disabled: boolean;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.fitc */
  readonly fitc: string | undefined;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.mfs */
  readonly mfs: string | undefined;
}

/**
 * Whether the two copies disagree. A copy that is not there at all is not a disagreement.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationRow.differs
 */
export const configurationRowDiffers = (row: MEAConfigurationRow): boolean =>
  row.fitc !== undefined && row.mfs !== undefined && row.fitc !== row.mfs;

/**
 * One configuration file's rows, under the heading that names it: MFIT's own name for the
 * file, drawn bold, and where it lives and how long it is, drawn plain.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationBlock
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationBlock.init
 */
export interface MEAConfigurationBlock {
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationBlock.alias */
  readonly alias: string;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationBlock.detail */
  readonly detail: string;
  /** @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfigurationBlock.rows */
  readonly rows: readonly MEAConfigurationRow[];
}

/**
 * The tab's blocks — one per file, in the map's order — or none where the image's generation
 * has no map. The map is the one the engine read the values through, so a row's labels and its
 * values cannot come from two layouts.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfiguration
 * @upstream Modules/MEATool/Sources/MEATool/MEAConfiguration.swift#MEAConfiguration.build
 */
export function buildConfiguration(analysis: FirmwareAnalysis): MEAConfigurationBlock[] {
  const map = configurationMapForME(analysis.version.major, analysis.platformFamily);
  if (map === undefined) return [];
  return (analysis.configuration ?? []).map((file) => {
    const layout = configurationFileAt(map, file.path);
    const copies = [...(file.fitc?.settings ?? []), ...(file.mfs?.settings ?? [])];
    // The map's own order first, then anything a copy carries that the map does not know. A
    // conditionally placed setting is a row of the file the image holds it in, and of no other.
    const names = (layout?.settings ?? [])
      .filter(
        (setting) =>
          setting.condition === undefined || copies.some((one) => one.name === setting.name)
      )
      .map((setting) => setting.name);
    for (const one of copies) if (!names.includes(one.name)) names.push(one.name);
    const rows = names.map((name): MEAConfigurationRow => {
      const setting = layout?.settings.find((one) => one.name === name);
      // The tool's own name for the setting where it has one, and the identifier where not.
      const auto = configurationAuto(setting?.auto === true);
      const label = (setting?.label ?? name) + (auto === "" ? "" : ` · ${auto}`);
      const condition = copies.find((one) => one.condition !== undefined)?.condition;
      const disabled = copies.find((one) => one.disabled !== undefined)?.disabled;
      const note = [
        ...(condition === undefined ? [] : [configurationCondition(condition, map)]),
        ...(disabled === undefined ? [] : [configurationDisabled(disabled, map)]),
      ];
      return {
        name: label,
        identifier: name,
        help: setting?.help,
        note: note.length === 0 ? undefined : note.join(" · "),
        condition,
        disabled: disabled !== undefined,
        fitc: configurationValue(
          file.fitc?.settings.find((one) => one.name === name),
          setting
        ),
        mfs: configurationValue(
          file.mfs?.settings.find((one) => one.name === name),
          setting
        ),
      };
    });
    return { alias: file.alias, detail: configurationFileDetail(file), rows };
  });
}
