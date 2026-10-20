import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { type EFIGUID, guid, guidEquals, guidFromBytes, guidText } from "@/firmware/uefi/efiGuid";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import {
  decodedVssName,
  isValidVssVariable,
  readVssEntry,
  type VSSVariable,
} from "@/firmware/uefi/vssVariable";

/**
 * Where HP's firmware keeps the machine's identity (`UEFI_IMAGE_FORMAT.md` §9): NVRAM
 * variables in the main VSS2 store, not a block of their own. What HP BIOS Configuration
 * Utility (BCU) reports and writes as Serial Number, SKU Number, Product Family, CT Number,
 * Product Name, System UUID, Build ID, Feature Byte and Asset Tracking Number.
 *
 * ```
 * HP_MUD       20AB3EB1-…  430 bytes, UTF-16, each field NUL-padded
 *   0x000  the serial number            ("5CD4432P9B")
 *   0x042  the SKU                      ("B8AL7E8#ABD")
 *   0x0A4  the product family           ("103C_5336AN HP EliteBook")
 *   0x106  the CT number                ("PTXNK028JK100B")
 *   0x124  the product name             ("HP EliteBook 645 14 inch G11 Notebook PC")
 *   0x19E  the UUID, 16 bytes, as SMBIOS stores one
 * BuildId      20AB3EB1-…  UTF-16      ("24WWROBZ602#SABD#DABD")
 * FactoryConfig 20AB3EB1-… UTF-16      the feature byte, ".XX" at its end
 * HP_TAGS      FB3B9ECE-…  UTF-16      the asset tracking number at 0x000
 * ```
 *
 * The variable names are HP's own: a driver of the firmware lists `HP_MUD`, `BuildId`,
 * `FactoryConfig` and `FactoryConfigFlags` under the one GUID. The layout of `HP_MUD` is read
 * off the dumps of HP EliteBooks of 2023–2025 (AMD and Intel), not a published one, and the
 * help says so. The rest of `HP_TAGS` — 324 bytes, of which the asset tracking number takes the
 * first field — was blank in every dump, and is not read.
 *
 * On three of the four boards the store marks every copy of `HP_MUD` deleted and keeps no
 * current one, yet the copy is whole: the area is read from the last copy where there is no
 * current one, and says so.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.init
 */
export interface HPDMIArea {
  /**
   * The `HP_MUD` entry the fields are read from.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.entry
   */
  readonly entry: ImageRange;
  /**
   * Its value, `HP_DMI.mudSize` bytes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.mud
   */
  readonly mud: Uint8Array;
  /**
   * The store marks the entry deleted, and holds no current copy.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.isDeleted
   */
  readonly isDeleted: boolean;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.buildID */
  readonly buildID?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.featureByte */
  readonly featureByte?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.assetTag */
  readonly assetTag?: string | undefined;
}

/** HP's names and numbers. */
export const HP_DMI = {
  /**
   * The GUID HP's factory variables are written under.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.factoryGuid
   */
  factoryGuid: guid("20AB3EB1-3C8F-4A4C-B87E-372426066D97"),
  /**
   * The GUID HP's Setup settings are written under, `HP_TAGS` among them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.settingsGuid
   */
  settingsGuid: guid("FB3B9ECE-4ABA-4933-B49D-B4D67D892351"),
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.mudName */
  mudName: "HP_MUD",
  /**
   * The size of `HP_MUD` on every board read from; another size is a layout nobody has read.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.mudSize
   */
  mudSize: 0x1ae,
} as const;

/**
 * Where each text of `HP_MUD` sits, the field it is NUL-padded to: `[start, end)`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.serialField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.skuField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.familyField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.ctNumberField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.productNameField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.uuidField
 */
const FIELDS = {
  serial: [0x000, 0x042],
  sku: [0x042, 0x0a4],
  family: [0x0a4, 0x106],
  ctNumber: [0x106, 0x124],
  productName: [0x124, 0x19e],
  uuid: [0x19e, 0x1ae],
} as const;

const fieldText = (area: HPDMIArea, field: readonly [number, number]): string =>
  hpText(area.mud.subarray(field[0], field[1])) ?? "";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.serialNumber */
export const hpSerialNumber = (area: HPDMIArea): string => fieldText(area, FIELDS.serial);
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.sku */
export const hpSKU = (area: HPDMIArea): string => fieldText(area, FIELDS.sku);
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.productFamily */
export const hpProductFamily = (area: HPDMIArea): string => fieldText(area, FIELDS.family);
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.ctNumber */
export const hpCTNumber = (area: HPDMIArea): string => fieldText(area, FIELDS.ctNumber);
/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.productName */
export const hpProductName = (area: HPDMIArea): string => fieldText(area, FIELDS.productName);

/**
 * The UUID, spelled the way the bench spells it: the first three groups read back the way
 * SMBIOS stores them, the rest as-is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.uuidText
 */
export const hpUUIDText = (area: HPDMIArea): string =>
  guidText(guidFromBytes(area.mud.subarray(FIELDS.uuid[0], FIELDS.uuid[1])));

/**
 * Something about HP's identity a technician should know before trusting it: the store marks
 * the copy deleted and keeps no current one; the asset tracking number is not the serial
 * number, which HP writes there by default.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIFinding
 */
export type HPDMIFinding = "deletedCopy" | "assetTagIsNotTheSerial";

/**
 * What a technician should know before trusting the fields.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.findings
 */
export function hpFindings(area: HPDMIArea): HPDMIFinding[] {
  const found: HPDMIFinding[] = [];
  if (area.isDeleted) found.push("deletedCopy");
  if (area.assetTag !== undefined && area.assetTag !== hpSerialNumber(area)) {
    found.push("assetTagIsNotTheSerial");
  }
  return found;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIFinding.text */
export function hpFindingText(finding: HPDMIFinding): string {
  switch (finding) {
    case "deletedCopy":
      return L(
        "The store marks this copy deleted and keeps no current one. The values are whole, and on most HP boards read so far the store holds them this way; where the firmware takes them from on such a board, the dump does not show."
      );
    case "assetTagIsNotTheSerial":
      return L(
        "The asset tracking number is not the serial number. HP writes the serial number there by default: the owner set another value, or it came over from another machine."
      );
  }
}

/**
 * The UTF-16 text a field holds, to its first NUL; nothing where a unit is not printable
 * ASCII — no field read from has held anything else.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.text
 */
export function hpText(bytes: Uint8Array): string | undefined {
  let text = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (unit === 0) break;
    if (unit < 0x20 || unit > 0x7e) return undefined;
    text += String.fromCharCode(unit);
  }
  return text;
}

/**
 * Whether `mud` reads as an `HP_MUD` value: the size of the layout, a serial number, and
 * printable text or NUL in every text field.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.isMUD
 */
export function isHPMUD(mud: Uint8Array): boolean {
  if (mud.length !== HP_DMI.mudSize) return false;
  const serial = hpText(mud.subarray(FIELDS.serial[0], FIELDS.serial[1]));
  if (serial === undefined || serial.length === 0) return false;
  return [FIELDS.sku, FIELDS.family, FIELDS.ctNumber, FIELDS.productName].every(
    (field) => hpText(mud.subarray(field[0], field[1])) !== undefined
  );
}

/**
 * One copy of a variable in a store: its entry, and the variable read from it — marked or
 * not, since a marked entry is named Invalid.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.Copy
 */
interface Copy {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.Copy.entry */
  readonly entry: UEFINode;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.Copy.variable */
  readonly variable: VSSVariable;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.Copy.name */
  readonly name: string;
}

/**
 * Every VSS entry of `store` read as a variable, in store order.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.copies
 */
function copies(store: UEFINode, reader: ImageReader): Copy[] {
  if (store.kind !== "vssStore" && store.kind !== "vss2Store") return [];
  const found: Copy[] = [];
  for (const entry of store.children) {
    if (entry.kind !== "vssEntry") continue;
    const variable = readVssEntry(entry, store.kind === "vss2Store", reader);
    const name = variable === undefined ? undefined : decodedVssName(variable, reader);
    if (variable === undefined || name === undefined) continue;
    found.push({ entry, variable, name });
  }
  return found;
}

/**
 * The copy that stands for the variable: the current one, or the last one where the store
 * keeps none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.standing
 */
function standing(name: string, owner: EFIGUID, all: readonly Copy[]): Copy | undefined {
  const mine = all.filter(
    (copy) =>
      copy.name === name &&
      copy.variable.vendorGuid !== undefined &&
      guidEquals(copy.variable.vendorGuid, owner)
  );
  return mine.findLast((copy) => isValidVssVariable(copy.variable)) ?? mine.at(-1);
}

/**
 * HP's identity as `store` holds it; nothing when it holds no `HP_MUD` that reads as one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.read
 */
export function readHPDMIArea(store: UEFINode, reader: ImageReader): HPDMIArea | undefined {
  const all = copies(store, reader);
  const mud = standing(HP_DMI.mudName, HP_DMI.factoryGuid, all);
  const value = mud === undefined ? undefined : reader.bytes(mud.variable.data);
  if (mud === undefined || value === undefined || !isHPMUD(value)) return undefined;
  const textOf = (
    name: string,
    owner: EFIGUID,
    field?: readonly [number, number]
  ): string | undefined => {
    const copy = standing(name, owner, all);
    const bytes = copy === undefined ? undefined : reader.bytes(copy.variable.data);
    if (bytes === undefined) return undefined;
    const window =
      field === undefined
        ? bytes
        : bytes.subarray(Math.min(field[0], bytes.length), Math.min(field[1], bytes.length));
    const text = hpText(window);
    return text === undefined || text.length === 0 ? undefined : text;
  };
  const buildID = textOf("BuildId", HP_DMI.factoryGuid);
  const featureByte = textOf("FactoryConfig", HP_DMI.factoryGuid);
  const assetTag = textOf("HP_TAGS", HP_DMI.settingsGuid, [0, 0xa2]);
  return {
    entry: nodeRange(mud.entry),
    mud: value,
    isDeleted: !isValidVssVariable(mud.variable),
    ...(buildID === undefined ? {} : { buildID }),
    ...(featureByte === undefined ? {} : { featureByte }),
    ...(assetTag === undefined ? {} : { assetTag }),
  };
}

/**
 * Whether `entry` is the `HP_MUD` copy the area of `store` is read from.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/HPDMIArea.swift#HPDMIArea.isAreaEntry
 */
export function isHPDMIAreaEntry(entry: UEFINode, store: UEFINode, reader: ImageReader): boolean {
  if (entry.kind !== "vssEntry" || entry.guid === undefined) return false;
  if (!guidEquals(entry.guid, HP_DMI.factoryGuid)) return false;
  const area = readHPDMIArea(store, reader);
  const range = nodeRange(entry);
  return area !== undefined && area.entry.start === range.start && area.entry.end === range.end;
}
