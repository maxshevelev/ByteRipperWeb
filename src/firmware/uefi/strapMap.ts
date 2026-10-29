import type { DescriptorGeneration } from "@/firmware/uefi/descriptorGeneration";
import {
  cpuStrapMaps,
  mipStrapMaps,
  pchStrapMaps,
  pmcStrapMaps,
  requiredStrapMap,
  sptCPUStrapMaps,
  sptStrapMaps,
  strapMapById,
} from "@/firmware/uefi/strapMapData";

/**
 * The chipset's own layout of a descriptor's strap section: every field the
 * build can set, the word and bits it takes, and the value Flash Image Tool
 * writes into it when a setting does not override it.
 *
 * Nothing in a dump names these fields, and no published specification names
 * them either. The tables are Intel's own, taken upstream from the strap layout
 * the Flash Image Tool executables carry and shipped compiled
 * (`StrapMaps.bin`, `strapMapData.ts`).
 *
 * **A table belongs to a length, not to a generation.** What an image states
 * about its section is how many words it has (`FLMAP1`), and the length is what
 * tells the layouts apart in practice. A length the tools do not agree on is
 * not here at all rather than guessed at.
 *
 * **The generation-keyed sets are FIT 11's SPT tables and the legacy guides'.**
 * SPT's lengths overlap the shared ones — 90 words is a PCH section in both, 3
 * words a processor section — without being the same section. Sunrise Point and
 * Lewisburg read those, and only where the descriptor's generation is certain.
 * Ibex Peak, Cougar Point and Lynx Point read tables written from Intel's SPI
 * Programming Guides: 16, 18 and 21 words, and a length is only theirs on the
 * generation that states it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap
 */
export interface DescriptorStrapMap {
  /**
   * The name of the document the table was read from, where the tool gives one
   * (`cnp_h_rvp.xml`); the tool and the length otherwise. For people, not for
   * the screen.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.name
   */
  readonly name: string;
  /**
   * How many words the section has: what picks this table.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.words
   */
  readonly words: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.fields */
  readonly fields: readonly StrapField[];
}

/**
 * One named field of the section: where it sits and what the tool writes there
 * by default. The name is the tool's own identifier — `PCH_Strap_SPI_ec_max_freq`
 * — in every language, so that it can be looked up in the tool.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field
 */
export interface StrapField {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.name */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.word */
  readonly word: number;
  /**
   * The field's first bit in its word, inclusive.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.bits
   * @upstream-differs the closed range is its two ends
   */
  readonly low: number;
  /** The field's last bit in its word, inclusive. */
  readonly high: number;
  /**
   * What the tool builds the strap with: its default for the field, not the
   * chipset's reset value, which is not documented anywhere. `undefined` where the
   * document states values per reference platform rather than a default — the CPU
   * strap message's layout does — and no value is claimed for it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.defaultValue
   */
  readonly defaultValue: number | undefined;
  /**
   * What the tool's panel calls the field, where the document says — "Disable
   * Hyperthreading" for `CPU_Strap_SMT_Disable`. `undefined` for the tables that
   * carry no interface text, and the panel then shows the identifier.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.label
   */
  readonly label: string | undefined;
  /**
   * The words a value may stand for, where the tool states them — `0: No, 1: Yes`
   * for a `no_yes_options` field. `undefined` otherwise, and the panel shows the
   * number.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.options
   */
  readonly options: ReadonlyMap<number, string> | undefined;
}

/**
 * A field with what an image's own section holds there.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Reading
 */
export interface StrapReading {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Reading.field */
  readonly field: StrapField;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Reading.value */
  readonly value: number;
}

/** A field as the decoder and the hand-written layouts state it. */
export function strapField(
  name: string,
  word: number,
  low: number,
  high: number,
  extra: { defaultValue?: number; label?: string; options?: ReadonlyMap<number, string> } = {}
): StrapField {
  return {
    name,
    word,
    low,
    high,
    defaultValue: extra.defaultValue,
    label: extra.label,
    options: extra.options,
  };
}

/**
 * The bits of `word` this field takes, as the number they stand for.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Field.value
 */
export function strapFieldValue(field: StrapField, word: number): number {
  const width = field.high - field.low + 1;
  const shifted = Math.floor((word >>> 0) / 2 ** field.low);
  return width >= 32 ? shifted >>> 0 : shifted % 2 ** width;
}

/**
 * The image does not leave the field at the value the tool builds with: its own
 * build set it. A table that states no default has nothing to compare against,
 * and no field of it is emphasised.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.Reading.isSet
 */
export const isStrapSet = (reading: StrapReading): boolean =>
  reading.field.defaultValue !== undefined && reading.value !== reading.field.defaultValue;

/**
 * The section as its fields, in the table's order — its words, not the table's,
 * decide how far this reaches: a section cut short by the end of the descriptor
 * names only the fields still inside it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.readings
 */
export function strapReadings(map: DescriptorStrapMap, section: readonly number[]): StrapReading[] {
  const readings: StrapReading[] = [];
  for (const field of map.fields) {
    const word = section[field.word];
    if (word === undefined) continue;
    readings.push({ field, value: strapFieldValue(field, word) });
  }
  return readings;
}

/**
 * The fields of one word, in the table's order.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.fields
 */
export const fieldsInWord = (map: DescriptorStrapMap, word: number): StrapField[] =>
  map.fields.filter((field) => field.word === word);

/**
 * What the fields of one word have in common, as the tool spells it —
 * `GPCOM4_gpio_sstrap`, `SPI`, `CSME_SMT1` — or `undefined` where they have
 * nothing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.group
 */
export const strapWordGroup = (map: DescriptorStrapMap, word: number): string | undefined =>
  strapGroupOf(fieldsInWord(map, word));

/**
 * The same, for the fields of one word however they were come by — the readings
 * of a section carry their fields, not the table.
 *
 * The tool gives a strap word no name of its own: its documents mark the words
 * with their offsets and nothing else. But its field names are the block that
 * owns the field, then the field — `PCH_Strap_GPCOM4_gpio_sstrap_sataxpcie_0` —
 * and a word's fields belong to one block, so the words they share say what the
 * word is. Reserved and spare fields are left out: they are named after their
 * place, not their block.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.group
 */
export function strapGroupOf(fields: readonly StrapField[]): string | undefined {
  const names = fields
    .map((field) => strapLocalName(field.name))
    .filter((name) => !isReservedStrap(name));
  if (names.length === 0) return undefined;
  const parts = names.map((name) => name.split("_"));
  const first = parts[0] ?? [];
  // A word of one field gives its block, the first word of the name — but only where
  // the name is underscore-separated. FIT 11's CamelCase spellings (`PchStrapSMB0RQ`)
  // have no block to give, and the word gets no group rather than its field's name over again.
  if (parts.length === 1) return first.length > 1 ? first[0] : undefined;
  let shared = 0;
  while (parts.every((one) => shared < one.length && one[shared] === first[shared])) shared += 1;
  // A prefix that is a whole name is that field, not the word's block.
  if (parts.some((one) => one.length === shared)) shared -= 1;
  if (shared <= 0) return undefined;
  return first.slice(0, shared).join("_");
}

/**
 * A field's name without the section's namespace (`PCH_Strap_`).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.localName
 */
export function strapLocalName(name: string): string {
  const at = name.indexOf("_Strap_");
  return at < 0 ? name : name.slice(at + "_Strap_".length);
}

/**
 * A field the tool names after its place rather than its block.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.isReserved
 */
export function isReservedStrap(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("rsvd") || lower.startsWith("reserved") || lower.startsWith("spare");
}

/**
 * The tables at hand, one per section length — the PCH set first, then FIT 11's
 * SPT set, which shares some lengths without sharing their layout. A resource
 * that cannot be used leaves the list empty, and the panel then shows a
 * section's words as numbers.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.all
 */
export const allStrapMaps = (): DescriptorStrapMap[] => [...pchStrapMaps(), ...sptStrapMaps()];

/**
 * Whether the generation's straps are FIT 11's SPT spellings — the Sunrise Point
 * boards, whose descriptor is the one FIT 11 builds.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.usesSPTLayout
 */
export const usesSPTLayout = (generation: DescriptorGeneration): boolean =>
  generation === "sunrisePoint" || generation === "lewisburg";

/**
 * The PCH table for a section of `words` words on `generation`: SPT's table set
 * where the board is Sunrise Point or Lewisburg, the legacy guides' own table
 * where the board is Ibex Peak, Cougar Point or Lynx Point, the shared ones
 * otherwise.
 *
 * An uncertain generation reads no SPT table, and a shared one only where the SPT
 * set has no section of that length: a 90-word section of a board that may be
 * Sunrise Point is not the shared 90-word layout, and reading it as that would
 * name a protected range and an eSPI clock out of another chipset's words.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.forSection
 */
export function strapMapForSection(
  words: number,
  generation: DescriptorGeneration,
  generationIsCertain = true
): DescriptorStrapMap | undefined {
  if (generationIsCertain && usesSPTLayout(generation)) {
    return sptStrapMaps().find((map) => map.words === words);
  }
  if (generationIsCertain) {
    const table = legacyStrapTable(generation);
    if (table !== undefined && table.words === words) return table;
  }
  if (!generationIsCertain && sptStrapMaps().some((map) => map.words === words)) return undefined;
  return sharedStrapMap(words);
}

/**
 * The tables of the generations before FIT's layout documents, written from
 * Intel's SPI Programming Guides. A section of another length is not theirs.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.legacyTables
 */
export const legacyStrapTables = (): DescriptorStrapMap[] =>
  ["pch16", "pch18", "pch21"].map(requiredStrapMap);

/**
 * The legacy table of a generation, or `undefined` where the generations at hand
 * have none. Lynx Point's 21-word section is read with the Cougar Point field set
 * carried forward.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.legacyTable
 */
export function legacyStrapTable(generation: DescriptorGeneration): DescriptorStrapMap | undefined {
  const id =
    generation === "ibexPeak"
      ? "pch16"
      : generation === "cougarPoint"
        ? "pch18"
        : generation === "lynxPoint"
          ? "pch21"
          : undefined;
  return id === undefined ? undefined : strapMapById(id);
}

/**
 * The shared layout of a strap section of `words` words, or `undefined` where no
 * tool at hand carries one: the words then stand as numbers, and nothing about
 * them is claimed. Never an SPT table.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.forSection
 */
export const sharedStrapMap = (words: number): DescriptorStrapMap | undefined =>
  pchStrapMaps().find((map) => map.words === words);

/**
 * The processor section's layout of `words` words, or `undefined` where the
 * tools state none. Their layout is the weaker key — the documents of one length
 * can disagree, and a table carries only what they agree on — so they are kept
 * apart from the PCH tables.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.processorTables
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.forProcessorSection
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.sptProcessorTables
 */
export function processorStrapMap(
  words: number,
  generation?: DescriptorGeneration,
  generationIsCertain = true
): DescriptorStrapMap | undefined {
  if (generation !== undefined && generationIsCertain && usesSPTLayout(generation)) {
    return sptCPUStrapMaps().find((map) => map.words === words);
  }
  return cpuStrapMaps().find((map) => map.words === words);
}

/**
 * The PMC block's layout of `words` words — the words the MIP area's PMC and CPU
 * block holds before the CPU strap message — or `undefined` where no tool at hand
 * states one. A PMC length and a PCH one are the same number by accident, never
 * the section.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.pmcTables
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.forPMC
 */
export const pmcStrapMap = (words: number): DescriptorStrapMap | undefined =>
  pmcStrapMaps().find((map) => map.words === words);

/**
 * The CPU strap **message**'s layout of `words` words — the form from Tiger Point
 * on, where the descriptor's MIP area carries the message instead of a strap
 * section. A message's fields say what they are ("Disable Hyperthreading") and
 * what their values mean, and state no default.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.mipProcessorTables
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.forMIPProcessorSection
 */
export const mipProcessorStrapMap = (words: number): DescriptorStrapMap | undefined =>
  mipStrapMaps().find((map) => map.words === words);

/**
 * The word the SPI controller loads its GPR0 register from — the flash range the
 * chipset protects from the host. `undefined` on a generation whose table does
 * not carry it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.protectedRangeField
 */
export const protectedRangeField = (map: DescriptorStrapMap): StrapField | undefined =>
  map.fields.find((field) => field.name.endsWith("_SPI_GLOBAL_PROTECTED_RNG_DEF"));

/**
 * The bits of the word the chipset drives the eSPI bus to the EC at. `undefined`
 * where the section's table does not carry it: the clock is a strap of the
 * desktop layouts, and the 69- and 74-word mobile sections have no such field.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMap.swift#DescriptorStrapMap.espiClockField
 */
export const espiClockField = (map: DescriptorStrapMap): StrapField | undefined =>
  map.fields.find((field) => field.name.endsWith("_SPI_ec_max_freq"));
