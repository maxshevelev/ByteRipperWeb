/**
 * The module-name fallback: when no database key claims a manifest, the modules
 * of its own `$CPD` name the firmware.
 *
 * That is how every stitched independent firmware is recognised — Intel
 * publishes no key line for each PMC, PCHC or PHY — and how a CSME or SPS image
 * signed with an unpublished key still gets a family.
 *
 * The rules are upstream's, in upstream's order, and the order is load-bearing:
 * one pass over the names, each match *assigning* rather than returning, so the
 * last module that matches decides. Most rules pair a module name with the
 * firmware's own major and sometimes the MEU version behind it, which is what
 * tells one platform's PMC from another's — every PMC carries a module called
 * `PMCC000`.
 *
 * Ported from `Packages/MEFirmware/Identify/VariantByModule.swift`.
 */

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/VariantByModule.swift#VariantByModule
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/VariantByModule.swift#VariantByModule.variant
 */
export function variantByModule(options: {
  readonly moduleNames: readonly string[];
  readonly major: number;
  readonly minor: number;
  /** The manifest's calendar year: upstream's test is "2017 or earlier". */
  readonly year: number;
  readonly meuMajor: number | undefined;
  readonly meuMinor: number | undefined;
}): string | undefined {
  const { moduleNames, major, minor, year, meuMajor, meuMinor } = options;
  // Whether the manifest has an MEU block at all, which only the CSE formats do.
  const isMEU = meuMajor !== undefined;
  let found: string | undefined;

  for (const module of moduleNames) {
    if (module === "fwupdate") found = "CSME";
    else if (module === "bup_rcv" || module === "sku_mgr" || module === "manuf") found = "CSSPS";
    else if (module.startsWith("dkl") && major === 10 && isMEU && meuMajor === 13) {
      found = "PHYSLKF";
    } else if (
      module.startsWith("dkl") &&
      (major === 11 || major === 0) &&
      isMEU &&
      meuMajor === 100
    ) {
      found = "PHYDG1";
    } else if (
      module.startsWith("PCIE") &&
      (major === 11 || major === 0) &&
      isMEU &&
      meuMajor === 101
    ) {
      found = "PHYDG2";
    } else if (module === "gen4_i" && (major === 13 || major === 14) && isMEU && meuMajor === 16) {
      found = "PHYNADP";
    } else if (module === "SNPMULTI" && major === 13 && isMEU && meuMajor === 16) {
      found = "PHYSADP";
    } else if (module === "nphy" && (major === 9 || major === 7) && isMEU && meuMajor === 13) {
      found = "PHYNICP";
    } else if (
      module === "nphy" &&
      (major === 16 || major === 15 || major === 11) &&
      isMEU &&
      meuMajor === 15
    ) {
      found = "PHYNTGP";
    } else if (
      module === "pphy" &&
      (major === 12 || major === 14 || major === 11) &&
      isMEU &&
      meuMajor === 15
    ) {
      found = "PHYPTGP";
    } else if (module === "pphy" && major === 12 && isMEU && meuMajor === 0) {
      found = "PHYPEBG";
    } else if (module === "pphy" && (major === 12 || major === 0)) {
      found = "PHYPCMP";
    } else if (module === "IntelRec" && major === 16) found = "PCHCADP";
    else if (module === "IntelRec" && major === 15 && isMEU && meuMinor === 40) found = "PCHCMCC";
    else if (module === "IntelRec" && major === 15 && isMEU && meuMinor === 0) found = "PCHCTGP";
    else if (module === "IntelRec" && major === 14 && minor === 5) found = "PCHCCMPV";
    else if (module === "IntelRec" && major === 14 && minor === 0) found = "PCHCCMP";
    else if (module === "IntelRec" && major === 13 && minor === 30) found = "PCHCLKF";
    else if (module === "IntelRec" && major === 13 && minor === 5) found = "PCHCJSP";
    else if (module === "IntelRec" && major === 13 && minor === 0) found = "PCHCICP";
    else if (
      module === "PMCC000" &&
      (major === 300 || major === 30 || major === 3232 || (major < 30 && year <= 2017))
    ) {
      found = "PMCCNP";
    } else if (module === "PMCC000" && major === 133) found = "PMCLKF";
    else if (module === "PMCC000" && (major === 135 || major === 130) && isMEU && meuMinor === 50) {
      found = "PMCJSP";
    } else if (module === "PMCC000" && (major === 400 || major === 130)) found = "PMCICP";
    else if (module === "PMCC000" && major === 140 && isMEU && meuMinor === 5) found = "PMCCMPV";
    else if (module === "PMCC000" && major === 140) found = "PMCCMP";
    else if (module === "PMCC000" && major === 150) found = "PMCTGP";
    else if (module === "PMCC000" && major === 154) found = "PMCMCC";
    else if (module === "PMCC000" && major === 160) found = "PMCADP";
    else if (module === "PMCC000" && major === 1 && !isMEU) found = "PMCWTL";
    else if (module === "PMCC000" && major === 14) found = "PMCIDV";
    else if (module === "PMCC002") found = "PMCAPLA";
    else if (module === "PMCC003") found = "PMCAPLB";
    else if (module === "PMCC004") found = "PMCGLKA";
    else if (module === "PMCC005") found = "PMCBXTC";
    else if (module === "PMCC006") found = "PMCGLKB";
    else if (module === "gfx_srv" || module === "chassis") found = "GSC";
    else if (module.startsWith("PCOD") && isMEU && meuMajor === 100) found = "PMCDG1";
    else if (
      module.startsWith("PCOD") &&
      isMEU &&
      (major === 4 || major === 2 || meuMajor === 101)
    ) {
      found = "PMCDG2";
    } else if (module === "VBT" && major === 19) found = "OROMDG1";
    else if (module === "VBT" && major === 20) found = "OROMDG2";
    else if (module === "VBT") found = "OROM";
  }

  // Modules present but none of them recognised: these two versions are a
  // CSTXE, which has no module name of its own to go by.
  if (found === undefined && moduleNames.length > 0) {
    if ((major === 4 && minor === 0) || (major === 3 && minor === 0)) found = "CSTXE";
  }
  return found;
}
