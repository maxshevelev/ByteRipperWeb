import type { DescriptorGeneration } from "@/firmware/uefi/descriptorGeneration";
import { registerMapById } from "@/firmware/uefi/descriptorRegisterMapData";
import { type StrapReading, strapField } from "@/firmware/uefi/strapMap";

/**
 * The flash descriptor's registers, field by field — the map words, the flash
 * component's registers, the masters' access masks, the recovery policy and the
 * VSCC/MIP map.
 *
 * No published document names these bits; the layouts are Intel's own, taken
 * upstream from the documents Flash Image Tool carries and shipped compiled
 * (`RegisterMaps.bin`). A register is placed either absolutely in the descriptor
 * (`FLMAP0/1/2` at 0x14, `FLDRPLCY` at 0x340, `FLUMAP1` at 0xEFC) or at a base the
 * descriptor itself states — `FLCOMP`/`FLIL` at `FCBA << 4`, `FLMSTR` at
 * `FMBA << 4`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap
 */
export interface DescriptorRegisterMap {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.registers */
  readonly registers: readonly DescriptorRegister[];
}

/**
 * Where a register lives in the descriptor: at an offset in it, or at the flash
 * component base (`FLMAP0[0:8] << 4`) or the flash master base (`FLMAP1[0:8] << 4`)
 * plus an offset.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Place
 */
export interface RegisterPlace {
  readonly kind: "absolute" | "flashComponent" | "flashMaster";
  readonly offset: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field */
export interface RegisterField {
  /**
   * The tool's identifier, without its `Base_Descriptor_SOC_Strap_` prefix
   * (`FLMAP0_Flash_Component_Base_Address`).
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.name
   */
  readonly name: string;
  /**
   * The first bit of the register.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.bitOffset
   */
  readonly bitOffset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.count */
  readonly count: number;
  /**
   * The tool's panel name for it, where it gives one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.label
   */
  readonly label: string | undefined;
  /**
   * The words a value may stand for, where the tool states them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.options
   */
  readonly options: ReadonlyMap<number, string> | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Register */
export interface DescriptorRegister {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Register.name */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Register.place */
  readonly place: RegisterPlace;
  /**
   * The register's length in dwords.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Register.words
   */
  readonly words: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Register.fields */
  readonly fields: readonly RegisterField[];
}

/**
 * The bits of `word` this field takes, as the number they stand for.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.Field.value
 */
export function registerFieldValue(field: RegisterField, word: number): number {
  const shifted = Math.floor((word >>> 0) / 2 ** field.bitOffset);
  return field.count >= 32 ? shifted >>> 0 : shifted % 2 ** field.count;
}

const GENERATION_MAPS: Partial<Record<DescriptorGeneration, string>> = {
  sunrisePoint: "sunrisePoint",
  cannonPoint: "cannonPoint",
  tigerPoint: "tigerPoint",
  elkhartLake: "elkhartLake",
  jasperLake: "jasperLake",
  meteorLake: "csme18",
  pantherLake: "csme18",
  wildcatLake: "csme18",
  novaLake: "csme18",
};

/**
 * The map for a generation, or `undefined` where none has been emitted.
 *
 * The older maps are partial: a FIT build states only the registers its platform
 * documents carry, and some of those sit in a common document the build does not
 * embed (the CNP build's `FLMAP0`, Tiger Point's masters 1, 2 and 4). What a map does
 * not hold is not named, rather than named from another generation's layout.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.forGeneration
 */
export function registerMapForGeneration(
  generation: DescriptorGeneration
): DescriptorRegisterMap | undefined {
  const id = GENERATION_MAPS[generation];
  return id === undefined ? undefined : registerMapById(id);
}

/**
 * Every generation's map at hand.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterMap.all
 */
export const allRegisterMaps = (): DescriptorRegisterMap[] =>
  ["sunrisePoint", "cannonPoint", "elkhartLake", "jasperLake", "tigerPoint", "csme18"]
    .map(registerMapById)
    .filter((map): map is DescriptorRegisterMap => map !== undefined);

/**
 * One register as an image holds it: where it is and its words.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterReading
 */
export interface DescriptorRegisterReading {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterReading.register */
  readonly register: DescriptorRegister;
  /**
   * The register's first byte, in the file's own offsets.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterReading.base
   */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterReading.words */
  readonly words: readonly number[];
}

/**
 * Every field of the register with what the image holds there, as a strap reading —
 * the word it sits in and its bits there — so the panel draws both kinds alike.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMap.swift#DescriptorRegisterReading.readings
 */
export function registerReadings(reading: DescriptorRegisterReading): StrapReading[] {
  const readings: StrapReading[] = [];
  for (const field of reading.register.fields) {
    const word = Math.floor(field.bitOffset / 32);
    const inWord = field.bitOffset % 32;
    const value = reading.words[word];
    if (value === undefined || field.count <= 0 || field.count > 32 || inWord + field.count > 32) {
      continue;
    }
    const shifted = Math.floor((value >>> 0) / 2 ** inWord);
    readings.push({
      field: strapField(field.name, word, inWord, inWord + field.count - 1, {
        ...(field.label === undefined ? {} : { label: field.label }),
        ...(field.options === undefined ? {} : { options: field.options }),
      }),
      value: field.count >= 32 ? shifted >>> 0 : shifted % 2 ** field.count,
    });
  }
  return readings;
}
