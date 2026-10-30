import { describe, expect, it } from "vitest";
import {
  configurationConditions,
  configurationSettings,
} from "@/firmware/me/configuration/configurationDecoder";
import { meConfigurationMapById } from "@/firmware/me/configuration/meConfigurationData";
import {
  configurationFileAt,
  configurationMapForME,
  type MapSetting,
  type MEConfigurationFileLayout,
  type MEConfigurationMap,
  mapSetting,
  platformFamilyOfStrapWords,
} from "@/firmware/me/configuration/meConfigurationMap";

/**
 * The ME configuration map, and the decoder that reads a file through it.
 *
 * The map is emitted from the vendor's own database rather than typed out, so what is
 * worth pinning here is not a list of offsets but the three things a regeneration could
 * quietly break: which generation reads which map, the one record every generation
 * shares, and the places two generations *disagree* about.
 */

function required(id: string): MEConfigurationMap {
  const map = meConfigurationMapById(id);
  if (map === undefined) throw new Error(`no map ${id}`);
  return map;
}

function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

const settingsOf = (map: MEConfigurationMap): MapSetting[] =>
  map.files.flatMap((file) => file.settings);

const settingIn = (
  map: MEConfigurationMap,
  path: string,
  find: (setting: MapSetting) => boolean
): MapSetting =>
  present(configurationFileAt(map, path)?.settings.find(find), `${path} in ${map.name}`);

const csme11 = () => required("csme11");
const csme12 = () => required("csme12");
const csme12Desktop = () => required("csme12Desktop");
const csme13 = () => required("csme13");
const csme14 = () => required("csme14");
const csme15 = () => required("csme15");
const csme16 = () => required("csme16");
const csme18 = () => required("csme18");

describe("the ME configuration map", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testEachMappedGenerationReadsItsOwnMap
  it("reads each mapped generation through its own map", () => {
    expect(configurationMapForME(11)?.name).toBe(csme11().name);
    expect(configurationMapForME(12)?.name).toBe(csme12().name);
    expect(configurationMapForME(13)?.name).toBe(csme13().name);
    expect(configurationMapForME(14)?.name).toBe(csme14().name);
    expect(configurationMapForME(15)?.name).toBe(csme15().name);
    expect(configurationMapForME(16)?.name).toBe(csme16().name);
    expect(configurationMapForME(18)?.name).toBe(csme18().name);
    // A generation nobody has mapped reads nothing rather than another generation's
    // offsets.
    expect(configurationMapForME(17)).toBeUndefined();
    expect(configurationMapForME(7)).toBeUndefined();
  });

  // FIT 13's own map, and the mark it shares with the other FIT maps and not with MFIT's:
  // no setting is `Auto`, because the attribute is MFIT's — of the four maps only the
  // CSME 16 one, which comes from MFIT, carries it.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheThirteenMapIsWhatFit13LaysOut
  it("lays the 13 map out as FIT 13 does", () => {
    const map = csme13();
    // The platform document and the common one it includes: the settings the family
    // shares — the FPF hardware binding, the ICC profile keys, Boot Guard's files — are
    // bound in the common document, so the map reads both.
    expect(map.files.length).toBe(31);
    expect(settingsOf(map).length).toBe(67);
    for (const fit of [csme11(), csme12(), csme13(), csme14(), csme15()]) {
      expect(
        settingsOf(fit).some((setting) => setting.auto),
        fit.name
      ).toBe(false);
    }
    expect(
      settingsOf(csme16()).some((setting) => setting.auto),
      "MFIT's map is the one with the mark"
    ).toBe(true);
  });

  // FIT 12's map: the older class shape, one document per platform half, so the mobile
  // and desktop halves are two maps with different file lists.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheTwelveMapIsWhatFit12LaysOut
  it("lays the 12 map out as FIT 12 does", () => {
    expect(csme12().files.length).toBe(25);
    expect(settingsOf(csme12()).length).toBe(52);
    expect(csme12Desktop().files.length).toBe(31);
    expect(settingsOf(csme12Desktop()).length).toBe(70);
    const eom = present(configurationFileAt(csme12(), "/home/mca/eom_config"));
    expect(eom.settings.map((setting) => setting.name)).toEqual([
      "EomFirstBootEnabled",
      "FlexibleEomSettings",
    ]);
  });

  // FIT 11's SPT layout: one set of documents for both halves, so one map serves either
  // family and there is no desktop twin.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheElevenMapIsWhatFit11LaysOut
  it("lays the 11 map out as FIT 11 does", () => {
    // FIT 11's SPT layout is one set of documents for both halves, and the map reads its
    // common documents too: Boot Guard's policy files, the OEM key hash and the OEM
    // certificates are bound there.
    expect(csme11().files.length).toBe(43);
    expect(settingsOf(csme11()).length).toBe(82);
    const lan = settingIn(
      csme11(),
      "/home/policy/cfgmgr/cfg_rules",
      (one) => one.name === "MELanPowerWell"
    );
    expect(lan.offset).toBe(188);
    expect(configurationMapForME(11, "desktop")?.name).toBe(
      configurationMapForME(11, "mobile")?.name
    );
  });

  // Every map carries the one file that is ours and no tool's: the board's own
  // `manuf_lock`, so the Configuration tab can show the build's zero and the platform's
  // byte side by side. It is appended by `forME`, not written into a generated map — a
  // regeneration must not lose it.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testEveryMapCarriesTheBoardsLockRecord
  it("carries the board's lock record in every map", () => {
    for (const major of [11, 12, 13, 14, 15, 16]) {
      const map = present(configurationMapForME(major), `${major}`);
      const lock = present(configurationFileAt(map, "/home/mca/manuf_lock"), `${major}`);
      expect(lock.alias).toBe("ManufLock");
      expect(lock.settings.map((setting) => setting.name)).toEqual(["ManufLock"]);
      const setting = present(lock.settings[0]);
      expect(setting.offset).toBe(0);
      expect(setting.length).toBe(1);
      expect(setting.label).toBe("Manufacturing Lock");
      expect(setting.options).toEqual(
        new Map([
          [0, "Not locked"],
          [1, "Locked"],
        ])
      );
    }
    expect(
      configurationFileAt(csme16(), "/home/mca/manuf_lock"),
      "the generated map itself does not carry the curated file"
    ).toBeUndefined();
  });

  // A file MFIT gives no place to is read where the file **is** the setting — one
  // logical setting of a numeric kind, `bup_sku/hw_binding`'s `HwBindingEn` — with the
  // width its kind names; a file the tool keeps several settings in is left to its
  // plugin, and so is every file whose setting has no numeric kind (certificates, the
  // ICC profiles).
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testAFileThatIsOneSettingIsRead
  it("reads a file that is one setting", () => {
    const map = csme16();
    const binding = settingIn(
      map,
      "/home/bup/bup_sku/hw_binding",
      (one) => one.name === "HwBindingEn"
    );
    expect(binding.offset).toBe(0);
    expect(binding.length).toBe(1);
    expect(binding.label).toBe("Hardware Binding Enabled");
    expect(binding.options).toEqual(
      new Map([
        [0, "Disabled"],
        [1, "Enabled"],
      ])
    );

    // The same rule gives the two-byte file its word.
    const timeout = settingIn(
      map,
      "/home/amt/rtfd/amt.wol",
      (one) => one.name === "AmtIdleTimeout"
    );
    expect(timeout.length, "the width its kind says").toBe(2);
    expect(timeout.hex).toBe(true);

    // A file with several settings: only the one the tool places is read.
    const ports = present(configurationFileAt(map, "/home/pavp/hdcp_ports"));
    expect(ports.settings.map((setting) => setting.name)).toEqual(["Hdcp5kedisp1"]);
    expect(configurationFileAt(map, "/home/icc/hash")).toBeUndefined();
  });

  // The 18 map is MFIT 18's rewritten database: `<nvar>` places and `<ui_item>` words.
  // Its whole-file settings — the ones the tool states as `length="dynamic"` in a file
  // that is one setting — are read at offset 0, and a setting its platform documents
  // call two different kinds is dropped.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheEighteenMapIsMfitsRewrittenDatabase
  it("reads the 18 map as MFIT's rewritten database", () => {
    const map = csme18();
    expect(map.files.length).toBe(32);
    expect(settingsOf(map).length).toBe(67);

    const binding = settingIn(
      map,
      "/home/bup/bup_sku/hw_binding",
      (one) => one.name === "HwBindingEn"
    );
    expect(binding.offset).toBe(0);
    expect(binding.length, "the file is the setting").toBe(1);
    expect(binding.label).toBe("Hardware Binding Enabled");
    expect(binding.options).toEqual(
      new Map([
        [0, "Disabled"],
        [1, "Enabled"],
      ])
    );

    const eom = settingIn(map, "/home/mca/eom_config", (one) =>
      one.name.startsWith("EomFirstBootEnabled")
    );
    expect(eom.bits).toEqual({ low: 0, high: 0 });
    expect(eom.label).toBe("EOM on First Boot Enabled");

    const lan = settingIn(
      map,
      "/home/policy/cfgmgr/cfg_rules",
      (one) => one.name === "MELanPowerWell"
    );
    expect(lan.label).toBe("LAN Power Well");
    expect(lan.options?.get(3)).toBe("SLP_LAN#");

    expect(
      settingsOf(map).find((one) => one.name === "IshSupported"),
      "the platform documents call it two different kinds"
    ).toBeUndefined();
    for (const file of map.files) {
      for (const setting of file.settings) {
        expect(setting.length, setting.name).toBeGreaterThan(0);
        expect(setting.offset, setting.name).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // The 16 map is merged from two builds: the settings 16.1.42 adds are there, the file
  // only 16.0.15 lists is read, and one whose lists disagree only on the `Auto` mark is
  // kept.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheSixteenMapCarriesEveryBuildsSettings
  it("carries every build's settings in the 16 map", () => {
    const settings = settingsOf(csme16());
    for (const name of [
      "OEMInfo",
      "OEMMakeInfo",
      "OEMModelInfo",
      "OEMDataStore",
      "MfgCountryOfOrigin",
      "PSRSupported",
      "SpiSwSeqEnable",
      "ECOOBSmbusAddr",
      "BindingSigType",
      "icmEntitlement",
    ]) {
      expect(
        settings.find((one) => one.name === name),
        name
      ).toBeDefined();
    }
    expect(
      settings.find((one) => one.name === "icpsSwSkuing"),
      "the lists disagree only on Auto, which is not a place"
    ).toBeDefined();
    expect(
      settings.filter((one) => one.name === "MctpEcAddress").length,
      "a file a newer build's lists dropped is still read"
    ).toBe(3);
  });

  // The lists spell a label or a help text differently — one truncates the sentence —
  // and that is not a layout conflict: the setting stays, with the fuller wording.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testASettingTheListsWordDifferentlyKeepsItsPlace
  it("keeps the place of a setting the lists word differently", () => {
    const map = csme16();
    const ish = settingIn(
      map,
      "/home/policy/cfgmgr/cfg_rules",
      (one) => one.name === "IshPowerUpState"
    );
    expect(ish.offset).toBe(404);
    expect(ish.length).toBe(4);
    expect(ish.label).toBe("Integrated Sensor Hub Initial Power Up State");
    expect(
      settingsOf(map).filter((one) => one.name === "MctpEcAddress").length,
      "the conditional files the tool places it in"
    ).toBe(3);

    // A bitfield is its offset and bits; the lists read different windows around it (8
    // bytes here, 32 in one list), and that is not a move.
    const icps = present(configurationFileAt(map, "/home/mca/icps")?.settings[0]);
    expect(icps.name).toBe("icpsSwSkuing");
    expect(icps.offset).toBe(0);
    expect(icps.bits).toEqual({ low: 0, high: 0 });
  });

  // The tool's own name for a setting travels with it: the identifier is what a report
  // and Intel's documents call it (`MELanPowerWell`), the label is what the tool's panel
  // shows ("LAN Power Well"), and a setting whose tool states no label of its own carries
  // none — repeating the identifier would say a panel shows something it does not.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheToolsOwnNamesForSettingsTravelWithThem
  it("carries the tool's own names for settings", () => {
    for (const map of [csme13(), csme14(), csme15(), csme16()]) {
      const setting = present(
        settingsOf(map).find((one) => one.name === "MELanPowerWell"),
        map.name
      );
      expect(setting.label, map.name).toBe("LAN Power Well");
    }
    // The End of Manufacturing flag carries its label on every map that lays the file
    // out — all but the 14 one, which has no `eom_config` at all.
    for (const map of [csme13(), csme15(), csme16()]) {
      const setting = settingIn(
        map,
        "/home/mca/eom_config",
        (one) => one.name === "EomFirstBootEnabled"
      );
      expect(setting.label, map.name).toBe("EOM on First Boot Enabled");
    }
    // FIT 15 states no label for these: its panel shows the identifiers.
    for (const identifier of ["FID_PAV", "FID_ISH"]) {
      expect(
        settingsOf(csme15()).find((one) => one.name === identifier)?.label,
        identifier
      ).toBeUndefined();
    }
  });

  // What the tools say about a setting travels with it, in the reader's words: prose,
  // with the tool's own breaks and none of its markup — FIT writes them as
  // `&lt;br /&gt;` and MFIT as `&#13;&#10;`, and both are lines by the time a map carries
  // them.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheToolsHelpAboutASettingTravelsWithIt
  it("carries the tool's help about a setting", () => {
    // Every generation's map carries help for most of what it lays out, and the flag
    // every one of them has is among the settings that do.
    for (const map of [csme13(), csme14(), csme15(), csme16()]) {
      const settings = settingsOf(map);
      const withHelp = settings.filter((one) => one.help !== undefined && one.help.length > 0);
      expect(withHelp.length, map.name).toBeGreaterThan(Math.floor(settings.length / 2));
    }
    // The flag every map but the 14 one lays out: its help is the tool's, and says what
    // the setting does.
    for (const map of [csme13(), csme15(), csme16()]) {
      const flag = present(
        settingsOf(map).find((one) => one.name === "EomFirstBootEnabled"),
        map.name
      );
      expect(flag.help?.startsWith("This setting det"), `${map.name}: ${flag.help ?? "—"}`).toBe(
        true
      );
      expect(flag.help?.includes("End of Manufacturing"), map.name).toBe(true);
    }
    const help = present(
      settingIn(csme15(), "/home/mca/eom_config", (one) => one.name === "EomFirstBootEnabled").help
    );
    expect(help.includes("\nNote: When this setting is enabled"), help).toBe(true);
    expect(help.includes("<br"), help).toBe(false);
    expect(help.includes("&#"), help).toBe(false);
  });

  // CSME 12, 13, 14 and 15 have a map for each half of the generation — the mobile parts
  // and the desktop ones lay a few settings out differently — and CSME 16 has one for
  // both, MFIT's database merging the platform lists it builds from.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testEachGenerationHasAMapForEachHalfOfIt
  it("has a map for each half of a generation", () => {
    expect(present(configurationMapForME(15, "mobile")).name).toContain("tgp_lp");
    expect(present(configurationMapForME(15, "desktop")).name).toContain("tgp_h");

    // The setting the two halves moved, and one only the desktop half has.
    const offset = (name: string, map: MEConfigurationMap) =>
      settingsOf(map).find((one) => one.name === name)?.offset;
    const mobile = present(configurationMapForME(15, "mobile"));
    const desktop = present(configurationMapForME(15, "desktop"));
    expect(offset("SecureTouch", mobile)).toBe(8);
    expect(offset("SecureTouch", desktop)).toBe(18);
    expect(offset("ProcMissingDetect", mobile)).toBeUndefined();
    expect(offset("ProcMissingDetect", desktop)).toBe(212);

    // 12, 13 and 14 too, under the tool's own names for their desktop parts.
    expect(present(configurationMapForME(12, "desktop")).name).toContain("cnp_h");
    expect(configurationMapForME(12, "desktop")?.name).not.toBe(
      configurationMapForME(12, "mobile")?.name
    );
    expect(present(configurationMapForME(13, "desktop")).name).toContain("icl_h");
    expect(present(configurationMapForME(14, "desktop")).name).toContain("cml_h");
    expect(configurationMapForME(14, "desktop")?.name).not.toBe(
      configurationMapForME(14, "mobile")?.name
    );

    // MFIT's 16 map serves both halves, and 18's does too.
    expect(configurationMapForME(16, "desktop")?.name).toBe(
      configurationMapForME(16, "mobile")?.name
    );
    expect(configurationMapForME(18, "desktop")?.name).toBe(
      configurationMapForME(18, "mobile")?.name
    );
    // And a dump that did not say which half it is reads as the mobile one, which is
    // what every map was before the choice existed.
    expect(configurationMapForME(15)?.name).toBe(mobile.name);
  });

  // Which half a PCH strap section's length names: the lengths the two halves use,
  // measured on the dumps at hand, and no claim about others.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheHalvesAreToldByTheStrapSectionsLength
  it("tells the halves by the strap section's length", () => {
    for (const words of [69, 70, 74]) {
      expect(platformFamilyOfStrapWords(words), `${words}`).toBe("mobile");
    }
    for (const words of [90, 101, 115]) {
      expect(platformFamilyOfStrapWords(words), `${words}`).toBe("desktop");
    }
    for (const words of [0, 68, 75, 89, 128, 0xff]) {
      expect(platformFamilyOfStrapWords(words), `${words}`).toBeUndefined();
    }
  });

  // A setting the tool names by its file alone is the file: the value is its first byte,
  // and the width comes from the declaration's type — a value class is one byte. The
  // tool's own words for the values come with the class, and their order is the class's
  // (`DisabledEnabledValues` is Disabled at 0, `EnabledDisabledValues` the other way
  // round).
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testAPlaceTheToolNamesByAFileAloneIsTheFile
  it("reads a place the tool names by a file alone as the file", () => {
    const map = csme13();
    const binding = settingIn(
      map,
      "/home/bup/bup_sku/hw_binding",
      (one) => one.name === "HwBindingEn"
    );
    expect(binding.offset).toBe(0);
    expect(binding.length).toBe(1);
    expect(binding.label).toBe("Hardware Binding Enabled");
    expect(binding.options?.get(0)).toBe("Disabled");
    expect(binding.options?.get(1)).toBe("Enabled");
    expect(binding.bits, "the whole byte, not a bitfield").toBeUndefined();

    // Every FIT map that reads its family's common document has it: the binding lives
    // there, not in the platform document, which is why the 15 map lacked it before the
    // includes were followed.
    const tgp = present(settingsOf(csme15()).find((one) => one.name === "HwBindingEn"));
    expect(tgp.offset).toBe(0);
    expect(tgp.length).toBe(1);
    const timeout = present(settingsOf(csme15()).find((one) => one.name === "AmtIdleTimeout"));
    expect(timeout.offset).toBe(0);
    expect(timeout.length, "a `word`").toBe(2);
  });

  // A place the tool gives only under another setting's value is kept, with its
  // condition — both branches of it — and a setting the tool switches off says what
  // switches it off. The desktop half's place is unconditional.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testAConditionalPlaceIsKeptWithItsCondition
  it("keeps a conditional place with its condition", () => {
    const setting = (name: string, path: string, map: MEConfigurationMap) =>
      settingIn(map, path, (one) => one.name === name);
    const mobile = csme15();
    const smt2 = setting("MctpEcAddress", "/home/mctp/smt2_devices", mobile);
    expect(smt2.condition).toEqual({ name: "eSpiEnabled", value: 0 });
    expect(smt2.offset).toBe(4);
    const eSpi = setting("MctpEcAddress", "/home/mctp/espi_devices", mobile);
    expect(eSpi.condition).toEqual({ name: "eSpiEnabled", value: 1 });
    expect(eSpi.offset).toBe(0);
    // The mirrored place: it clears the copy in the file the address left.
    const reset = setting("ResetMctpEcAddress", "/home/mctp/smt2_devices", mobile);
    expect(reset.condition).toEqual({ name: "eSpiEnabled", value: 1 });

    const bus = setting("SmlinkBusSelection", "/home/smbus/smlink_bus", mobile);
    expect(bus.disabledBy).toEqual({ name: "eSpiEnabled", value: 1 });

    // The condition is the tool's word resolved through its own value class:
    // `eSpiEnabled` is `NoYesValues`, where No is 0.
    const switchSetting = setting("eSpiEnabled", "/home/mctp/espi_en", mobile);
    expect(switchSetting.options?.get(0)).toBe("No");
    expect(switchSetting.options?.get(1)).toBe("Yes");

    const desktop = present(configurationMapForME(15, "desktop"));
    expect(
      setting("MctpEcAddress", "/home/mctp/smt3_devices", desktop).condition,
      "the desktop half lays it out once, unconditionally"
    ).toBeUndefined();
  });

  // The End of Manufacturing record: the one thing the newer layouts do not bind (the
  // tool writes it through its own `EomNvar`), and the one record whose place every
  // generation agrees on — bit 0 of the two bytes of `/home/mca/eom_config`, and the same
  // bit of the single byte of `/home/mca/eom`.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheEndOfManufacturingRecordIsTheSameInEveryMap
  it("places the End of Manufacturing record the same in every map", () => {
    for (const map of [csme13(), csme15(), csme16()]) {
      const config = present(
        configurationFileAt(map, "/home/mca/eom_config"),
        `${map.name} EOM_Config`
      );
      expect(config.alias).toBe("EOM_Config");
      const flag = present(config.settings.find((one) => one.name === "EomFirstBootEnabled"));
      expect(flag.offset).toBe(0);
      expect(flag.bits).toEqual({ low: 0, high: 0 });
      expect(flag.options?.get(0)).toBe("No");
      expect(flag.options?.get(1)).toBe("Yes");

      const eom = present(configurationFileAt(map, "/home/mca/eom"), `${map.name} EOM`);
      expect(eom.settings.find((one) => one.name === "EomFirstBootEnabled")?.bits).toBeUndefined();
    }
  });

  // What the 14 map does *not* have: ME 14 lays out no End of Manufacturing record. FIT
  // 14 binds `/home/mca/eom` — the byte the board itself wrote — and no `eom_config`,
  // which is why the panel's Manufacturing row leans on the descriptor for an image of
  // that generation instead of on the flag. FIT 13, one generation older, does bind it.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheFourteenMapHasNoEOMRecord
  it("has no End of Manufacturing record in the 14 map", () => {
    const fourteen = csme14();
    expect(configurationFileAt(fourteen, "/home/mca/eom")).toBeDefined();
    expect(configurationFileAt(fourteen, "/home/mca/eom_config")).toBeUndefined();
    for (const newer of [csme13(), csme15(), csme16()]) {
      expect(
        configurationFileAt(newer, "/home/mca/eom_config"),
        `${newer.name} should carry the flag the 14 map has not got`
      ).toBeDefined();
    }
  });

  // The maps are the tools' own layouts, so which files a generation knows is a fact of
  // its own map. Four files every one of them lays out — that set is what a bench reads
  // first on any of them — one the newest three have and the oldest has not, and the
  // four iunit files the two oldest have and the newer two have not, which is where
  // reading one generation through another's map shows.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testThePlatformFilesAreTheToolsOwn
  it("knows the platform files the tools lay out", () => {
    for (const path of [
      "/home/mca/eom",
      "/home/policy/cfgmgr/cfg_rules",
      "/home/bup/si_features",
      "/home/mctp/smt2_devices",
    ]) {
      for (const map of [csme13(), csme14(), csme15(), csme16()]) {
        expect(configurationFileAt(map, path), `${map.name} has no ${path}`).toBeDefined();
      }
    }
    // FIT 14's cml_lp lays the host-interface file out and FIT 13's icl_lp does not;
    // every newer map has it again.
    expect(configurationFileAt(csme13(), "/home/amt/skip_rtfd/ncsi")).toBeUndefined();
    for (const map of [csme14(), csme15(), csme16()]) {
      expect(configurationFileAt(map, "/home/amt/skip_rtfd/ncsi"), map.name).toBeDefined();
    }
    // FIT 13's icl_lp and FIT 14's cml_lp bind the iunit files the newer families
    // replaced with `iunit_oem_cfg` and `iunit_privacy_mode`; neither newer map knows
    // them at all.
    for (const path of [
      "/home/iunit/port_cfg",
      "/home/iunit/sec_ctl",
      "/home/iunit/sec_touch",
      "/home/iunit/camera_mask",
    ]) {
      expect(configurationFileAt(csme13(), path)).toBeDefined();
      expect(configurationFileAt(csme14(), path)).toBeDefined();
      expect(configurationFileAt(csme15(), path)).toBeUndefined();
      expect(configurationFileAt(csme16(), path)).toBeUndefined();
    }
  });

  // Where the two generations differ, and how much: the config-rule file's layout is the
  // same in both — the same cells, the same bits — while the iunit file's is not. That
  // difference is the reason a generation reads its own map and not the newer one's.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheTwoGenerationsAgreeOnThePolicyFileAndNotOnIunit
  it("agrees on the policy file across two generations, and not on iunit", () => {
    const fifteen = present(configurationFileAt(csme15(), "/home/policy/cfgmgr/cfg_rules"));
    const sixteen = present(configurationFileAt(csme16(), "/home/policy/cfgmgr/cfg_rules"));
    const powerWell = (file: MEConfigurationFileLayout) =>
      file.settings.find((one) => one.name === "MELanPowerWell");
    expect(powerWell(fifteen)?.offset).toBe(188);
    expect(powerWell(fifteen)?.offset).toBe(powerWell(sixteen)?.offset);
    expect(powerWell(fifteen)?.bits).toEqual({ low: 0, high: 2 });

    const iunit = present(configurationFileAt(csme15(), "/home/iunit/iunit_oem_cfg"));
    const newer = present(configurationFileAt(csme16(), "/home/iunit/iunit_oem_cfg"));
    // FIT 15 puts the secure-touch switch at byte 8 of the file; MFIT 16 puts it at 18.
    // Reading one generation through the other's map would have called byte 18 a
    // setting.
    expect(iunit.settings.find((one) => one.name === "SecureTouch")?.offset).toBe(8);
    expect(newer.settings.find((one) => one.name === "SecureTouch")?.offset).toBe(18);
  });

  // A file's bytes read through the map: a bitfield out of the little-endian word the map
  // names, a plain field as itself, and a field the bytes do not reach left out rather
  // than guessed at.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationMapTests.testTheDecoderReadsThePlacesTheMapNames
  it("decodes the places the map names", () => {
    const file = present(configurationFileAt(csme16(), "/home/mca/eom_config"));
    const bytes = new Uint8Array(2);
    bytes[0] = 0b0000_0110; // bit 0 clear (no EOM flag), bits 1-2 = 3
    const settings = configurationSettings(file, bytes);
    expect(settings.map((setting) => setting.name)).toEqual([
      "EomFirstBootEnabled",
      "FlexibleEomSettings",
    ]);
    expect(settings[0]?.number).toBe(0);
    expect(settings[1]?.number).toBe(3);

    // A file shorter than the map's first field is a file of another shape, not an empty
    // one.
    expect(configurationSettings(file, new Uint8Array(0))).toEqual([]);

    // A field wider than eight bytes comes back as its bytes, which is all a 256-byte PKI
    // suffix or a SHA-384 hash is.
    const wide = mapSetting("Wide", 0, 16);
    const long = configurationSettings(
      { path: "/home/x", alias: "X", settings: [wide] },
      new Uint8Array(16).fill(0xab)
    );
    expect(long[0]?.number).toBeUndefined();
    expect(long[0]?.bytes).toBe("AB".repeat(16));
  });
});

/**
 * The conditional places of a map, as an image's two pages answer them: a setting the
 * tool lays out in one of two files, by another setting's value.
 */
describe("the configuration's conditions", () => {
  /** `/a` holds the switch; `/b` and `/c` are the two branches of one setting. */
  const map: MEConfigurationMap = {
    name: "test",
    files: [
      {
        path: "/a",
        alias: "A",
        settings: [
          mapSetting("Switch", 0, 1, {
            options: new Map([
              [0, "No"],
              [1, "Yes"],
            ]),
          }),
          mapSetting("Off", 1, 1, { disabledBy: { name: "Switch", value: 1 } }),
        ],
      },
      {
        path: "/b",
        alias: "B",
        settings: [mapSetting("Address", 4, 2, { condition: { name: "Switch", value: 0 } })],
      },
      {
        path: "/c",
        alias: "C",
        settings: [mapSetting("Address", 0, 2, { condition: { name: "Switch", value: 1 } })],
      },
    ],
  };

  const pages = (entries: Record<string, number[]>) =>
    new Map(Object.entries(entries).map(([path, values]) => [path, new Uint8Array(values)]));
  const none = new Map<string, Uint8Array>();

  // The condition's own value names the branch, and it is not assumed.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationConditionTests.testTheConditionsValueNamesTheBranch
  it("names the branch by the condition's value", () => {
    const off = configurationConditions(
      map,
      pages({ "/a": [0, 0], "/b": [0, 0, 0, 0, 0, 0] }),
      none
    );
    expect(off.branch.get("Address")).toBe("/b");
    expect(off.placed.get("Address")).toEqual({ name: "Switch", value: 0, assumed: false });

    const on = configurationConditions(map, pages({ "/a": [1, 0], "/c": [0, 0] }), none);
    expect(on.branch.get("Address")).toBe("/c");
    expect(on.placed.get("Address")?.value).toBe(1);
    expect(on.placed.get("Address")?.assumed).toBe(false);
  });

  // Not in the image: the branch is the one whose file is here, and the reading says it
  // was assumed.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationConditionTests.testAValueNotInTheImagePicksTheBranchWhoseFileIsHere
  it("picks the branch whose file is here where the value is not in the image", () => {
    const assumed = configurationConditions(map, pages({ "/b": [0, 0, 0, 0, 0, 0] }), none);
    expect(assumed.branch.get("Address")).toBe("/b");
    expect(assumed.placed.get("Address")).toEqual({ name: "Switch", value: 0, assumed: true });
    // Both branch files here and no value: the map's first branch wins, and it is still
    // assumed.
    const both = configurationConditions(
      map,
      pages({ "/b": [0, 0, 0, 0, 0, 0], "/c": [0, 0] }),
      none
    );
    expect(both.branch.get("Address")).toBe("/b");
    expect(both.placed.get("Address")?.assumed).toBe(true);
    // Neither file: the image holds the setting nowhere, and no branch is claimed.
    const neither = configurationConditions(map, none, none);
    expect(neither.branch.get("Address")).toBeUndefined();
    expect(neither.placed.get("Address")).toBeUndefined();
  });

  // A branch chosen per setting would let a setting and its mirror disagree about one
  // condition: the value is decided once, for the condition.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationConditionTests.testTheMirroredPlaceFollowsTheSameBranch
  it("takes the mirrored place along the same branch", () => {
    const mirrored: MEConfigurationMap = {
      name: "test",
      files: [
        { path: "/a", alias: "A", settings: [mapSetting("Switch", 0, 1)] },
        {
          path: "/b",
          alias: "B",
          settings: [
            mapSetting("Address", 4, 2, { condition: { name: "Switch", value: 0 } }),
            mapSetting("Reset", 4, 2, { condition: { name: "Switch", value: 1 } }),
          ],
        },
        {
          path: "/c",
          alias: "C",
          settings: [
            mapSetting("Address", 0, 2, { condition: { name: "Switch", value: 1 } }),
            mapSetting("Reset", 0, 2, { condition: { name: "Switch", value: 0 } }),
          ],
        },
      ],
    };
    const assumed = configurationConditions(mirrored, pages({ "/b": [0, 0, 0, 0, 0, 0] }), none);
    expect(assumed.branch.get("Address"), "the switch is off, so the address is here").toBe("/b");
    expect(
      assumed.branch.get("Reset"),
      "and the reset copy is the one in the file that is not here"
    ).not.toBe("/b");
  });

  // A setting the tool switches off is marked where the image holds the value the
  // condition names, and not where the value is absent.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationConditionTests.testASwitchedOffSettingIsMarkedWhereTheValueSaysSo
  it("marks a switched-off setting where the value says so", () => {
    const on = configurationConditions(map, pages({ "/a": [1, 1] }), none);
    expect(on.disabled.get("Off")).toEqual({ name: "Switch", value: 1, assumed: false });
    const off = configurationConditions(map, pages({ "/a": [0, 1] }), none);
    expect(off.disabled.get("Off")).toBeUndefined();
    expect(
      configurationConditions(map, none, none).disabled.get("Off"),
      "no value, no claim"
    ).toBeUndefined();
  });

  // The tool's `NoYesValues`: No is 0 and Yes is 1, which is what the generated maps'
  // conditions are stated in.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ConfigurationMapTests.swift#ConfigurationConditionTests.testTheConditionWordsAreResolvedThroughTheToolsClasses
  it("resolves the condition words through the tool's classes", () => {
    const switchSetting = settingsOf(csme15()).find((one) => one.name === "eSpiEnabled");
    expect(switchSetting?.options?.get(0)).toBe("No");
    expect(switchSetting?.options?.get(1)).toBe("Yes");
  });
});
