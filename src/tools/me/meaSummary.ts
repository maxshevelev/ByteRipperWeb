import { L } from "@/core/localization/localization";
import type { MFSPCHInit } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import {
  type PowerDownMitigation,
  powerDownMitigationText,
} from "@/firmware/me/models/firmwareFacts";
import { fileSystemStateBasisText } from "@/tools/meaStateBasisText";
import {
  chipsetSteppingText,
  downgradeBlacklistText,
  familyText,
  firmwareVersionText,
  fwUpdateSupportText,
  meuText,
  nvmCompatibilityText,
  sizeText,
  titleText,
  yesNo,
} from "@/tools/meaText";
import { fileSystemStateWithBasis, stateBasis } from "@/tools/meaTones";
import { manufactureDate, pendingValue } from "@/tools/meaTree";
import { type MEAPending, NOTHING_PENDING } from "@/tools/mePending";
import { isStatusTone, type ToolValueTone } from "@/tools/toolValueTone";

/**
 * The «Summary» tab: MEA's console Field/Value table, a table of its own for each
 * independent firmware stitched into the image, then the analysis's messages.
 * Ported from upstream's `MEASummary`.
 *
 * The honesty rule a row lives by: a row that is always answerable (Family,
 * Version, Release, Size) shows its value; a row whose fact the model carries
 * only sometimes shows «Coming soon» when the fact is absent — but only once the
 * image is identified, because promised rows mean nothing on a file the engine
 * could not name. A row whose gate the model cannot prove is left out, as MEA
 * leaves it out.
 */

/** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryValue */
export type MEASummaryValue =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "comingSoon" }
  /**
   * The analysis on screen was read without a database this row depends on, and the
   * reading with it is on the way (`MEAPending`). Not the same thing as `comingSoon`:
   * this row will have its value in seconds.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryValue.pending
   */
  | { readonly kind: "pending" };

/** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryRow */
export interface MEASummaryRow {
  /** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryRow.label */
  readonly label: string;
  /** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryRow.value */
  readonly value: MEASummaryValue;
  /** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryRow.tone */
  readonly tone: ToolValueTone;
}

/**
 * A titled group of rows. The primary table has no title, as in the console.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryBlock
 */
export interface MEASummaryBlock {
  /** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryBlock.title */
  readonly title: string | undefined;
  /** @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryBlock.rows */
  readonly rows: readonly MEASummaryRow[];
}

export const shown = (text: string): MEASummaryValue => ({ kind: "value", text });
export const COMING_SOON: MEASummaryValue = { kind: "comingSoon" };
export const PENDING: MEASummaryValue = { kind: "pending" };

/**
 * What the row says — the one wording the panel and a copy of it share.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummaryValue.text
 */
export const summaryValueText = (value: MEASummaryValue): string =>
  value.kind === "value"
    ? value.text
    : value.kind === "pending"
      ? pendingValue()
      : L("Coming soon");

/**
 * Whether a row's value is drawn emphasized — bold as well as coloured, so the
 * state it names reads at a glance.
 *
 * Colour and weight are two answers to one question: is this row saying
 * something the reader should notice. The rule is stated here once because the
 * summary is drawn twice on this side of the port — the panel's rows and the
 * picture taken of them — and both ask it rather than each deciding for itself.
 *
 * A promise is never emphasized, whatever tone its row carries: there is no
 * fact behind it yet to draw attention to. Upstream says the same thing from
 * the value's own side of the switch.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.summaryRowView
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.richText
 */
export function isEmphasized(row: MEASummaryRow): boolean {
  return row.value.kind === "value" && isStatusTone(row.tone);
}

const nonEmpty = (text: string | undefined): text is string =>
  text !== undefined && text.length > 0;

/**
 * The blocks in reading order: the firmware table, the independent firmware, the messages.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummary
 * @upstream Modules/MEATool/Sources/MEATool/MEASummary.swift#MEASummary.build
 */
export function buildSummary(
  a: FirmwareAnalysis,
  pending: MEAPending = NOTHING_PENDING
): MEASummaryBlock[] {
  const rows: MEASummaryRow[] = [];
  const add = (label: string, value: MEASummaryValue, tone: ToolValueTone = "standard") =>
    rows.push({ label, value, tone });
  // Only for an image the engine named do unanswered rows become promises.
  const identified = a.manifest !== undefined;
  /** A fact when there is one, a promise when there is not and the image is named. */
  const fact = (label: string, text: string | undefined) => {
    if (nonEmpty(text)) add(label, shown(text));
    else if (identified) add(label, COMING_SOON);
  };
  const { major } = a.version;

  // 1 · Family. 2 · Version, in the shape this family writes it. 3 · Release.
  add("Family", shown(familyText(a.family)));
  add(
    L("Version"),
    shown(firmwareVersionText(a.variant, major, a.version.minor, a.version.hotfix, a.version.build))
  );
  add(L("Release"), shown(releaseText(a)));

  // 4 · Type — only an image on the Stock / Update / Extracted axis has a word.
  if (identified) fact(L("Type"), axisType(a.type));
  // 5 · SKU.
  fact("SKU", a.sku);
  // 6 · One chipset row: every chipset the initialisation tables named, else the
  // recorded stepping letters, else upstream's own "Unknown".
  if (identified && hasChipsetRow(a)) {
    const chipset = chipsetCell(a.chipsetInit);
    if (chipset !== undefined) add(L("Chipset"), shown(chipset));
    else if (nonEmpty(a.chipsetStepping)) {
      add("Chipset Stepping", shown(chipsetSteppingText(a.chipsetStepping)));
    } else add(L("Chipset"), shown(L("Unknown")));
  }
  // 7 · NVM Compatibility — Undefined prints no row, and nor does no R2 extension.
  if (a.nvmCompatibility !== undefined && a.nvmCompatibility !== 0) {
    add("NVM Compatibility", shown(nvmCompatibilityText(a.nvmCompatibility)));
  }
  // 8–10 · the security numbers, for the families whose firmware carries them.
  if (hasSecurityVersionRow(a)) fact("TCB Security Version Number", a.securityVersion);
  if (hasARBRow(a)) fact("ARB Security Version Number", numberText(a.arbSvn));
  if (hasSecurityVersionRow(a)) fact("Version Control Number", numberText(a.vcn));
  // 11 · Production Ready.
  if (hasProductionReadyRow(a)) {
    const ready = a.manifest?.productionReady;
    fact("Production Ready", ready === undefined ? undefined : yesNo(ready));
  }
  // 12 · CSME 11's two rows.
  if (a.family === "csme" && major === 11) {
    fact("Power Down Mitigation", powerDownText(a.powerDownMitigation));
    fact(
      "Workstation Support",
      a.workstationSupport === undefined ? undefined : yesNo(a.workstationSupport)
    );
  }
  // 13 · ME 7's Patsburg support.
  if (a.family === "me" && major === 7) {
    fact(
      "Patsburg Support",
      a.patsburgSupport === undefined ? undefined : yesNo(a.patsburgSupport)
    );
  }
  // 14 · OEM Configuration.
  if (isOEMFamily(a) && identified) {
    add(
      L("OEM Configuration"),
      a.oemCustomized === undefined ? COMING_SOON : shown(yesNo(a.oemCustomized))
    );
  }
  // 15 · FWUpdate Support.
  if (a.family === "csme" && major >= 12) {
    fact(
      "FWUpdate Support",
      a.fwUpdateSupport === undefined ? undefined : fwUpdateSupportText(a.fwUpdateSupport)
    );
  }
  // 16 · Date.
  fact(L("Date"), manufactureDate(a));
  // 17 · File System State, in the colour of the state.
  if (isMFSFamily(a)) {
    // An EFS volume lists no files until the file table is read, and whether it holds
    // any is half of what makes the volume Initialized rather than Configured.
    if (pending.fileTable && a.efsVolume !== undefined && a.mfsState !== undefined) {
      add("File System State", PENDING);
    } else if (a.mfsState !== undefined) {
      add(
        "File System State",
        shown(titleText(a.mfsState)),
        fileSystemStateWithBasis(a.mfsState, a.mfsStateBasis)
      );
      // Under it, what the state rests on — the same paragraph as the Firmware row's detail in Full
      // Info. Not upstream's row: MEAnalyzer prints the state alone, and a state that a step which
      // could not be taken left standing then reads as settled, in green, with the reason only in
      // the messages at the bottom.
      if (a.mfsStateBasis !== undefined) {
        add(
          L("State basis"),
          shown(fileSystemStateBasisText(a.mfsState, a.mfsStateBasis)),
          stateBasis(a.mfsStateBasis)
        );
      }
    } else if (identified) {
      add("File System State", COMING_SOON);
    }
  }
  // 18 · Size — how far the firmware reaches from its $FPT, and the region
  // analysed only where that could not be worked out.
  add(L("Size"), shown(sizeText(a.firmwareSizeBytes ?? a.sizeBytes)));
  // 19 · Flash Image Tool: the first boot BPDT with a real FIT on an IFWI, the
  // $FPT header's otherwise.
  if (a.bootPartitions !== undefined) {
    const fit = a.bootPartitions.find((one) => one.fit !== undefined)?.fit;
    add(
      "Flash Image Tool",
      shown(
        fit === undefined
          ? "N/A"
          : firmwareVersionText(a.variant, fit.major, fit.minor, fit.hotfix, fit.build)
      )
    );
  } else if (a.fptHeaderFIT !== undefined) {
    const fit = a.fptHeaderFIT;
    add(
      "Flash Image Tool",
      shown(firmwareVersionText(a.variant, fit.major, fit.minor, fit.hotfix, fit.build))
    );
  }
  // 20 · Manifest Extension Utility — only for a manifest MEU actually built.
  const meu = meuVersion(a);
  if (meu !== undefined) add("Manifest Extension Utility", shown(meu));
  // 21 · ME 7's downgrade blacklists, where "Empty" is an answer of its own.
  if (a.family === "me" && major === 7) {
    const blacklist = a.downgradeBlacklist;
    add(
      "Downgrade Blacklist 7.0",
      shown(
        blacklist?.sevenZero === undefined
          ? L("Empty")
          : downgradeBlacklistText(blacklist.sevenZero)
      )
    );
    add(
      "Downgrade Blacklist 7.1",
      shown(
        blacklist?.sevenOne === undefined ? L("Empty") : downgradeBlacklistText(blacklist.sevenOne)
      )
    );
  }
  // 22 · Chipset Support — only where the engine could name the platform.
  if (nonEmpty(a.platform)) add("Chipset Support", shown(a.platform));

  const blocks: MEASummaryBlock[] = [{ title: undefined, rows }];
  // A table of its own for each independent firmware, in the order the console
  // prints them: PMC, then PCHC, then PHY.
  for (const firmware of a.independentFirmware ?? []) {
    const block = independentBlock(firmware, a);
    if (block !== undefined) blocks.push(block);
  }
  if (a.issues.length > 0 || pending.huffman) {
    const messages: MEASummaryRow[] = a.issues.map((issue) => ({
      label: titleText(issue.severity),
      value: shown(issue.message),
      tone: "standard",
    }));
    // The module checks are the half of the messages that wait for the dictionaries.
    if (pending.huffman) {
      messages.push({ label: L("Module checks"), value: PENDING, tone: "standard" });
    }
    blocks.push({ title: L("Messages"), rows: messages });
  }
  return blocks;
}

/**
 * One independent firmware's table: the same reading as the engine's over its
 * own bytes. Its Type is always "Independent", and its Size the partition's own.
 * Nothing for a family with no table, so an unnamed firmware is left out.
 */
function independentBlock(
  firmware: FirmwareAnalysis,
  host: FirmwareAnalysis
): MEASummaryBlock | undefined {
  const title = independentTitle(firmware);
  if (title === undefined) return undefined;
  const rows: MEASummaryRow[] = [];
  const add = (label: string, text: string) =>
    rows.push({ label, value: shown(text), tone: "standard" });
  const platform = firmware.platform ?? "";

  add("Family", familyText(firmware.family));
  add(
    L("Version"),
    firmwareVersionText(
      firmware.variant,
      firmware.version.major,
      firmware.version.minor,
      firmware.version.hotfix,
      firmware.version.build
    )
  );
  add(L("Release"), releaseText(firmware));
  add(L("Type"), "Independent");

  if (firmware.family === "pmc") {
    // A modern host prints the chipset SKU whatever the platform; otherwise only
    // a platform with more than one chipset has one worth a row.
    const hostSaysSo =
      (host.family === "csme" && host.version.major >= 12) ||
      (host.family === "cssps" && host.version.major >= 5);
    const onePlatform = ["APL", "BXT", "GLK", "DG"].some((one) => platform.startsWith(one));
    if ((hostSaysSo || !onePlatform) && nonEmpty(firmware.sku)) add("Chipset SKU", firmware.sku);
    // A discrete-graphics PMC has no stepping row at all.
    if (!platform.startsWith("DG")) {
      const stepping = firmware.chipsetStepping;
      add("Chipset Stepping", stepping === undefined || stepping === "U" ? L("Unknown") : stepping);
    }
  } else if (firmware.family === "phy" && nonEmpty(firmware.sku)) {
    add("SKU", firmware.sku);
  }

  add("TCB Security Version Number", firmware.securityVersion ?? "0");
  add("ARB Security Version Number", String(firmware.arbSvn ?? 0));
  add("Version Control Number", String(firmware.vcn ?? 0));
  const ready = firmware.manifest?.productionReady;
  if (ready !== undefined) add("Production Ready", yesNo(ready));
  const date = manufactureDate(firmware);
  if (date !== undefined) add(L("Date"), date);
  add(L("Size"), sizeText(firmware.sizeBytes));
  const meu = meuVersion(firmware);
  if (meu !== undefined) add("Manifest Extension Utility", meu);
  if (platform.length > 0) add("Chipset Support", platform);
  // Not a console row: upstream prints the copy as a second, identical table,
  // and this one says where it is.
  const copies = firmware.redundantCopies;
  if (copies !== undefined && copies.length > 0) add("Redundant Copy", copies.join(", "));
  return { title, rows };
}

function independentTitle(firmware: FirmwareAnalysis): string | undefined {
  switch (firmware.family) {
    case "pmc":
      return "Power Management Controller";
    case "pchc":
      return "Platform Controller Hub Configuration";
    case "phy":
      return "USB Type C Physical";
    default:
      return undefined;
  }
}

/** The release word; an engineering build says so. */
const releaseText = (a: FirmwareAnalysis): string =>
  titleText(a.release) + (a.version.build >= 7000 ? ", Engineering" : "");

const numberText = (value: number | undefined) => (value === undefined ? undefined : `${value}`);

const POWER_DOWN_VALUES: readonly string[] = ["yes", "no", "unknown", "unknown1", "unknown2"];

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.powerDownMitigation */
function powerDownText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return POWER_DOWN_VALUES.includes(value)
    ? powerDownMitigationText(value as PowerDownMitigation)
    : value;
}

/**
 * The MEU version, or nothing for an R0 manifest and the 0 / 0xFFFF no-MEU markers.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#Version.meText
 */
function meuVersion(a: FirmwareAnalysis): string | undefined {
  const { meMajor, meMinor, meHotfix, meBuild } = a.version;
  if (meMajor === undefined || meMajor === 0 || meMajor === 0xffff) return undefined;
  if (meMinor === undefined || meHotfix === undefined || meBuild === undefined) return undefined;
  return meuText(meMajor, meMinor, meHotfix, meBuild);
}

/**
 * The Chipset cell, over the image's *final* aggregate (the FTPR `intl.cfg`
 * replaces the MFS volume's own copy, so `mfsVolume.pchInit` is not always the
 * answer): **every** chipset the initialisation tables named, each as
 * `"<chipset> <letters,comma-joined>"` and one per line. That is upstream's own
 * cell — it prints `pch_init_final[-1][0]`, the total row its aggregation
 * appends, which is exactly this join (MEA.py 9126–9130). An image with one
 * chipset, which is most of them, reads as that one chipset; a chipset that
 * carried no stepping letters reads as its name alone.
 */
function chipsetCell(pchInit: MFSPCHInit | undefined): string | undefined {
  const rows = (pchInit?.chipsets ?? [])
    .filter((one) => one.chipset.length > 0)
    .map((one) => {
      const letters = [...one.steppings].join(",");
      return letters.length === 0 ? one.chipset : `${one.chipset} ${letters}`;
    });
  return rows.length === 0 ? undefined : rows.join("\n");
}

function axisType(type: FirmwareAnalysis["type"]): string | undefined {
  switch (type) {
    case "stock":
      return "Stock";
    case "update":
      return L("Update");
    case "extracted":
      return "Extracted";
    default:
      return undefined;
  }
}

/** Rows 8 and 10: an ME from major 8, never a plain SPS, every other named family. */
function hasSecurityVersionRow(a: FirmwareAnalysis): boolean {
  switch (a.family) {
    case "me":
      return a.version.major >= 8;
    case "sps":
    case "unknown":
      return false;
    default:
      return true;
  }
}

/** Row 9: the anti-rollback number arrived with CSME 12 and the families after it. */
function hasARBRow(a: FirmwareAnalysis): boolean {
  switch (a.family) {
    case "csme":
      return a.version.major >= 12;
    case "cstxe":
    case "cssps":
    case "gsc":
    case "pmc":
    case "pchc":
    case "phy":
    case "orom":
      return true;
    default:
      return false;
  }
}

/** Row 11: an ME before major 8 has no production bit, and a plain SPS none either. */
function hasProductionReadyRow(a: FirmwareAnalysis): boolean {
  return hasSecurityVersionRow(a);
}

/** Row 6: a CS / PMC / GSC variant, except a discrete-graphics PMC. */
function hasChipsetRow(a: FirmwareAnalysis): boolean {
  if (a.variant.startsWith("PMCDG")) return false;
  return ["csme", "cstxe", "cssps", "pmc", "gsc"].includes(a.family);
}

function isOEMFamily(a: FirmwareAnalysis): boolean {
  return ["csme", "cstxe", "cssps", "txe", "gsc"].includes(a.family);
}

function isMFSFamily(a: FirmwareAnalysis): boolean {
  return ["csme", "cstxe", "cssps", "gsc"].includes(a.family);
}
