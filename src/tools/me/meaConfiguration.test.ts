import { describe, expect, it } from "vitest";
import type {
  ConfigurationCondition,
  ConfigurationFile,
  ConfigurationPage,
  ConfigurationSetting,
  MEPlatformFamily,
} from "@/firmware/me/models/configurationFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { buildConfiguration, configurationRowDiffers } from "@/tools/me/meaConfiguration";
import { analysisWith, manifestFixture, versionWith } from "@/tools/meaTesting";

/**
 * The «Configuration» tab's builder. Ported from upstream's `MEASummaryTests`, whose
 * Configuration-tab cases test `MEAConfiguration`.
 */

/** One setting of one copy, with what a test leaves out absent. */
const setting = (
  name: string,
  number: number,
  extra: { condition?: ConfigurationCondition; disabled?: ConfigurationCondition } = {}
): ConfigurationSetting => ({
  name,
  number,
  bytes: undefined,
  auto: false,
  condition: extra.condition,
  disabled: extra.disabled,
});
const page = (size: number, settings: readonly ConfigurationSetting[]): ConfigurationPage => ({
  size,
  settings,
});
const file = (
  path: string,
  alias: string,
  copies: { fitc?: ConfigurationPage | undefined; mfs?: ConfigurationPage | undefined }
): ConfigurationFile => ({ path, alias, fitc: copies.fitc, mfs: copies.mfs });
const csme = (major: number, minor: number, hotfix: number, build: number) =>
  analysisWith({
    family: "csme",
    manifest: manifestFixture(),
    version: versionWith(major, minor, hotfix, build),
  });
const condition = (name: string, value: number, assumed = false): ConfigurationCondition => ({
  name,
  value,
  assumed,
});

describe("the Configuration tab", () => {
  // The tab's blocks: one per configuration file, MFIT's own words for the file and for the
  // values it enumerates, both copies of a file read side by side, and no tab at all where the
  // image's generation has no map — a generation nobody has mapped reads nothing rather than
  // another generation's offsets.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheConfigurationTabReadsBothCopiesOfAFileSettingBySetting
  it("reads both copies of a file setting by setting", () => {
    const eomConfig = file("/home/mca/eom_config", "EOM_Config", {
      fitc: page(2, [setting("EomFirstBootEnabled", 0), setting("FlexibleEomSettings", 0)]),
      mfs: page(2, [setting("EomFirstBootEnabled", 0), setting("FlexibleEomSettings", 2)]),
    });
    const a: FirmwareAnalysis = { ...csme(16, 1, 25, 1991), configuration: [eomConfig] };
    const blocks = buildConfiguration(a);
    expect(blocks.length).toBe(1);
    // The heading is two parts: Intel's own name for the file, which the tab draws bold, and the
    // path without its `/home` with the length.
    expect(blocks[0]?.alias).toBe("EOM_Config");
    expect(blocks[0]?.detail).toBe("/mca/eom_config, 2 bytes");
    // The row reads as the tool's panel does: its own name for the setting where it states one,
    // the identifier where it shows that instead.
    const rows = blocks[0]?.rows ?? [];
    expect(rows.map((row) => row.name)).toEqual([
      "EOM on First Boot Enabled",
      "Flexible EOM setting options",
    ]);
    // Each row carries the build's value and the file system's, and the pair that disagrees is
    // the one the view marks. MFIT's own words for the flag, which its database calls a Yes/No
    // setting rather than a bit that reads 0 or 1.
    expect(rows.map((row) => row.fitc)).toEqual(["No", "Lock Descriptor and OEM Configs"]);
    expect(rows.map((row) => row.mfs)).toEqual(["No", "Lock Descriptor Only"]);
    expect(rows.map(configurationRowDiffers)).toEqual([false, true]);

    // A copy that is not there at all is an absent value, not a disagreement: an image nobody
    // has booted has one column and no argument — and the tab still shows the setting.
    const unbooted: FirmwareAnalysis = {
      ...a,
      configuration: [file("/home/mca/eom_config", "EOM_Config", { fitc: eomConfig.fitc })],
    };
    const unbootedRows = buildConfiguration(unbooted)[0]?.rows ?? [];
    expect(unbootedRows.map((row) => row.mfs)).toEqual([undefined, undefined]);
    expect(unbootedRows.map(configurationRowDiffers)).toEqual([false, false]);
    expect(unbootedRows.map((row) => row.fitc)).toEqual(["No", "Lock Descriptor and OEM Configs"]);

    // A generation whose map has not been emitted reads nothing rather than a guess, even with
    // the same files in hand. (18 has a map — `MEConfigurationMap+CSME18`, emitted from MFIT
    // 18.1 — 17 has none.)
    const unmapped: FirmwareAnalysis = { ...csme(17, 0, 0, 0), configuration: a.configuration };
    expect(buildConfiguration(unmapped)).toEqual([]);

    // A setting the map does not list has only its identifier to show: the tool's own words for
    // a setting are the map's, and where there is no map entry there is nothing to borrow them
    // from. The map's own order holds, so the unknown one comes last and the setting the copy
    // has not got is still a row — with an absent value rather than a zero.
    const unknown: FirmwareAnalysis = {
      ...a,
      configuration: [
        file("/home/mca/eom_config", "EOM_Config", {
          mfs: page(2, [setting("EomFirstBootEnabled", 1), setting("NotInTheMap", 1)]),
        }),
      ],
    };
    const unknownRows = buildConfiguration(unknown)[0]?.rows ?? [];
    expect(unknownRows.map((row) => row.name)).toEqual([
      "EOM on First Boot Enabled",
      "Flexible EOM setting options",
      "NotInTheMap",
    ]);
    expect(unknownRows.map((row) => row.mfs)).toEqual(["Yes", undefined, "1"]);
  });

  // A setting the tool places conditionally carries what placed it, after its name — and says
  // so when the branch had to be told from the files the image carries. A setting the tool
  // switches off carries that too, and its values are drawn quiet.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testAConditionalSettingCarriesItsConditionInTheRow
  it("carries a conditional setting's condition in the row", () => {
    const a: FirmwareAnalysis = {
      ...csme(15, 0, 1, 100),
      configuration: [
        file("/home/mctp/smt2_devices", "Smt2Devices", {
          mfs: page(6, [
            setting("MctpEcAddress", 0, { condition: condition("eSpiEnabled", 0, true) }),
          ]),
        }),
        file("/home/smbus/smlink_bus", "SmlinkBus", {
          mfs: page(1, [
            setting("SmlinkBusSelection", 0, { disabled: condition("eSpiEnabled", 1) }),
          ]),
        }),
        file("/home/mca/eom_config", "EOM_Config", {
          mfs: page(2, [setting("EomFirstBootEnabled", 0)]),
        }),
      ],
    };
    const rows = buildConfiguration(a).flatMap((block) => block.rows);

    const address = rows.find((row) => row.identifier === "MctpEcAddress");
    // The row's name stays the tool's name for it.
    expect(address?.name).toBe("MCTP EC Address");
    // The condition is the `?`'s subtitle, in the tool's own words.
    expect(address?.note).toBe("eSpiEnabled = No, assumed");
    expect(address?.condition).toEqual(condition("eSpiEnabled", 0, true));
    expect(address?.disabled).toBe(false);

    const bus = rows.find((row) => row.identifier === "SmlinkBusSelection");
    expect(bus?.name).toBe("Bus Selection");
    expect(bus?.note).toBe("disabled by eSpiEnabled = Yes");
    // Which is what the panel draws quiet.
    expect(bus?.disabled).toBe(true);
    expect(bus?.condition).toBeUndefined();

    // A row with neither a condition nor a switch-off is not given a note, and one with no help
    // at all still has none: no empty subtitle.
    const flag = rows.find((row) => row.identifier === "EomFirstBootEnabled");
    expect(flag).toBeDefined();
    expect(flag?.note).toBeUndefined();
  });

  // A condition and a switch-off are the setting's own, not its file's: in a file that holds a
  // conditional setting, a switched-off one and a plain one, each row carries only what the tool
  // says about that setting.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testAConditionBelongsToItsSettingNotToItsFile
  it("gives a condition to its setting, not to its file", () => {
    const a: FirmwareAnalysis = {
      ...csme(15, 0, 1, 100),
      configuration: [
        file("/home/mctp/smt2_devices", "Smt2Devices", {
          mfs: page(8, [
            setting("Plain", 1),
            setting("MctpEcAddress", 0, { condition: condition("eSpiEnabled", 0, true) }),
            setting("SwitchedOff", 2, { disabled: condition("eSpiEnabled", 1) }),
          ]),
        }),
      ],
    };
    const rows = buildConfiguration(a)[0]?.rows ?? [];
    const row = (identifier: string) => rows.find((one) => one.identifier === identifier);

    // A plain setting beside a conditional one has nothing to add, and is not drawn quiet.
    expect(row("Plain")?.note).toBeUndefined();
    expect(row("Plain")?.condition).toBeUndefined();
    expect(row("Plain")?.disabled).toBe(false);

    // The switch-off is the other setting's.
    expect(row("MctpEcAddress")?.note).toBe("eSpiEnabled = No, assumed");
    expect(row("MctpEcAddress")?.disabled).toBe(false);

    // And the condition is the other setting's.
    expect(row("SwitchedOff")?.note).toBe("disabled by eSpiEnabled = Yes");
    expect(row("SwitchedOff")?.condition).toBeUndefined();
    expect(row("SwitchedOff")?.disabled).toBe(true);
  });

  // The tab reads the board's own half of the generation's map: a file the mobile map lays out
  // and the desktop one does not is labelled from the mobile map and reaches the desktop tab by
  // its identifier alone — the same map the engine read the values through.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testTheConfigurationTabReadsTheBoardsOwnHalfOfTheMap
  it("reads the board's own half of the map", () => {
    const rows = (family: MEPlatformFamily | undefined) =>
      buildConfiguration({
        ...csme(15, 0, 1, 100),
        platformFamily: family,
        configuration: [
          file("/home/smbus/smlink_bus", "SmlinkBus", {
            mfs: page(1, [setting("SmlinkBusSelection", 1)]),
          }),
        ],
      })[0]?.rows ?? [];

    expect(rows("mobile").map((row) => row.name)).toEqual(["Bus Selection"]);
    // The desktop map does not lay this file out: the identifier is all there is.
    expect(rows("desktop").map((row) => row.name)).toEqual(["SmlinkBusSelection"]);
    // A dump that did not say which half reads as the mobile one.
    expect(rows(undefined).map((row) => row.name)).toEqual(["Bus Selection"]);
  });

  // A row carries what the tool says about its setting, under the identifier the row itself
  // does not show — the heading of the `?` beside the name. A setting the map does not list, or
  // one MFIT has nothing to say about, has neither.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEASummaryTests.swift#MEASummaryTests.testARowCarriesTheToolsHelpAndTheIdentifier
  it("carries the tool's help and the identifier on a row", () => {
    const a: FirmwareAnalysis = {
      ...csme(16, 1, 25, 1991),
      configuration: [
        file("/home/mca/eom_config", "EOM_Config", {
          mfs: page(2, [setting("EomFirstBootEnabled", 1), setting("NotInTheMap", 1)]),
        }),
      ],
    };
    const rows = buildConfiguration(a)[0]?.rows ?? [];
    const flag = rows.find((row) => row.name === "EOM on First Boot Enabled");

    // The name a document or a report calls the setting by.
    expect(flag?.identifier).toBe("EomFirstBootEnabled");
    expect(flag?.help?.startsWith("This setting det")).toBe(true);
    // The tool's paragraph break, as the line it is.
    expect(flag?.help?.includes("\nNote:")).toBe(true);
    for (const row of rows) {
      if (row.help !== undefined) expect(row.help.includes("<br")).toBe(false);
    }
  });
});
