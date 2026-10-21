import { authVssVariable, nvramVolume, vss2Store } from "@/firmware/testing/testNvram";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import {
  HP_FACTORY_GUID,
  HP_MUD_NAME,
  HP_MUD_SIZE,
  HP_SETTINGS_GUID,
} from "@/firmware/uefi/hpDmiArea";
import { NVRAM } from "@/firmware/uefi/nvramParser";

/**
 * HP's identity as the firmware writes it, for the tests of the reader (`hpDmiArea.ts`) and
 * of the detail (`uefiHPDMIDetail.ts`): `HP_MUD` and the variables beside it in a VSS2 store
 * of an NVRAM volume. The layout is read off the dumps it was surveyed from, so the tests
 * carry synthetic variables in it.
 */

export const HP_SERIAL = "5CDTEST001";

/** The UUID as SMBIOS stores it: 78563412-AB90-4788-89CD-EF0102030405. */
export const HP_UUID: readonly number[] = [
  0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0x88, 0x47, 0x89, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05,
];

/** `text` as UTF-16LE into `bytes` at `offset`. */
export function putUTF16(text: string, bytes: Uint8Array, offset: number): void {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    bytes[offset + 2 * index] = unit & 0xff;
    bytes[offset + 2 * index + 1] = unit >> 8;
  }
}

/** `text` as UTF-16LE at the start of `size` zero bytes. */
export function utf16Field(text: string, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  putUTF16(text, bytes, 0);
  return bytes;
}

/** An `HP_MUD` value with every field written. */
export function hpMud(
  options: { readonly serial?: string; readonly productName?: string } = {}
): Uint8Array {
  const bytes = new Uint8Array(HP_MUD_SIZE);
  putUTF16(options.serial ?? HP_SERIAL, bytes, 0x000);
  putUTF16("TEST123#ABD", bytes, 0x042);
  putUTF16("103C_5336AN HP EliteBook", bytes, 0x0a4);
  putUTF16("PTXTEST01JK100B", bytes, 0x106);
  putUTF16(options.productName ?? "HP EliteBook 645 14 inch G11 Notebook PC", bytes, 0x124);
  bytes.set(HP_UUID, 0x19e);
  return bytes;
}

/** An HP variable as the firmware writes one: the authenticated header, attributes 07. */
export function hpVariable(
  name: string,
  data: Uint8Array,
  options: { readonly guid?: EFIGUID; readonly state?: number } = {}
): Uint8Array {
  return authVssVariable({
    name,
    data,
    vendorGuid: options.guid ?? HP_FACTORY_GUID,
    state: options.state ?? NVRAM.vssVariableAdded,
    attributes: 0x07,
  });
}

/** `HP_MUD` and the variables beside it, the asset tag the serial unless said. */
export function hpVariables(
  options: {
    readonly mudState?: number;
    readonly assetTag?: string;
    readonly mud?: Uint8Array;
    readonly featureByte?: string;
  } = {}
): Uint8Array[] {
  return [
    hpVariable("Timeout", Uint8Array.of(5, 0), { guid: HP_SETTINGS_GUID }),
    hpVariable("BuildId", utf16Field("24WWTEST602#SABD#DABD", 112)),
    hpVariable("FactoryConfig", utf16Field(options.featureByte ?? "476J6S6b7B7H.TR", 500)),
    hpVariable(HP_MUD_NAME, options.mud ?? hpMud(), {
      state: options.mudState ?? NVRAM.vssVariableAdded,
    }),
    hpVariable("HP_TAGS", utf16Field(options.assetTag ?? HP_SERIAL, 324), {
      guid: HP_SETTINGS_GUID,
    }),
  ];
}

/** An NVRAM volume holding one VSS2 store of `variables`. */
export function hpImage(variables: readonly Uint8Array[] = hpVariables()): Uint8Array {
  return nvramVolume({ stores: [vss2Store({ variables })] });
}
