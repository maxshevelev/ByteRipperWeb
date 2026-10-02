import type { ImageReader } from "@/firmware/imageReader";
import { Descriptor } from "@/firmware/uefi/descriptorParser";

/**
 * The chipset generation a flash descriptor was written for, told from the
 * descriptor's own layout (`UEFI_IMAGE_FORMAT.md` §2.5).
 *
 * Nothing in a descriptor states it. The version field is reserved before
 * Cannon Point and says nothing after it — a Skylake board leaves it
 * `0xFFFFFFFF` and a Cougar Point one writes `0x25` there — yet the generation
 * decides how the rest reads: how many regions the table holds, whether a
 * master's masks are a byte or twelve bits, how wide a chip's density is and
 * what a clock code means. What does tell generations apart is where each one
 * puts its sections and how long it makes them, and the rules here are those
 * flashrom's `ich_descriptors.c` uses for a dump, which agree with the ME
 * region's own chipset on every dump at hand.
 *
 * Several generations share one layout and cannot be told apart by it — 6 and 7
 * series, 8 and 9, 300 and 400, 600 and 700 — so a case names both.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration
 * @upstream-differs a string union with the facts in tables below, where upstream has an enum
 * with a computed property for each; the cases are the same
 */
export type DescriptorGeneration =
  | "ich8"
  | "ich9"
  | "ich10"
  | "ibexPeak"
  | "cougarPoint"
  | "bayTrail"
  | "lynxPoint"
  | "sunrisePoint"
  | "lewisburg"
  | "emmitsburg"
  | "apolloLake"
  | "geminiLake"
  | "cannonPoint"
  | "tigerPoint"
  | "alderPoint"
  | "elkhartLake"
  | "jasperLake"
  | "meteorLake"
  | "pantherLake"
  | "wildcatLake"
  | "novaLake";

/**
 * What a bench calls it: Intel's code names, which are the same in every
 * language.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.codeName
 */
const CODE_NAMES: Readonly<Record<DescriptorGeneration, string>> = {
  ich8: "ICH8",
  ich9: "ICH9",
  ich10: "ICH10",
  ibexPeak: "Ibex Peak",
  cougarPoint: "Cougar Point / Panther Point",
  bayTrail: "Bay Trail",
  lynxPoint: "Lynx Point / Wildcat Point",
  sunrisePoint: "Sunrise Point / Union Point",
  lewisburg: "Lewisburg",
  emmitsburg: "Emmitsburg",
  apolloLake: "Apollo Lake",
  geminiLake: "Gemini Lake",
  cannonPoint: "Cannon Point / Comet Point",
  tigerPoint: "Tiger Point",
  alderPoint: "Alder Point / Raptor Point",
  elkhartLake: "Elkhart Lake",
  jasperLake: "Jasper Lake",
  meteorLake: "Meteor Lake",
  pantherLake: "Panther Lake",
  wildcatLake: "Wildcat Lake",
  novaLake: "Nova Lake",
};

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.codeName */
export function generationCodeName(generation: DescriptorGeneration): string {
  return CODE_NAMES[generation];
}

/**
 * The chipset series the code name is sold as, where it is one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.series
 */
export function generationSeries(generation: DescriptorGeneration): string | undefined {
  switch (generation) {
    case "ibexPeak":
      return "5";
    case "cougarPoint":
      return "6/7";
    case "lynxPoint":
      return "8/9";
    case "sunrisePoint":
      return "100/200";
    case "lewisburg":
      return "C620";
    case "emmitsburg":
      return "C740";
    case "cannonPoint":
      return "300/400";
    case "tigerPoint":
      return "500";
    case "alderPoint":
      return "600/700";
    default:
      return undefined;
  }
}

/** Up to Wildcat Point: a byte of read and of write per master. */
const OLDER: ReadonlySet<DescriptorGeneration> = new Set([
  "ich8",
  "ich9",
  "ich10",
  "ibexPeak",
  "cougarPoint",
  "bayTrail",
  "lynxPoint",
]);

/**
 * How many base/limit pairs the region section holds.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.regionCount
 */
export function regionCount(generation: DescriptorGeneration): number {
  switch (generation) {
    case "ich8":
    case "ich9":
    case "ich10":
    case "ibexPeak":
    case "cougarPoint":
    case "bayTrail":
      return 5;
    case "lynxPoint":
      return 7;
    case "apolloLake":
    case "geminiLake":
      return 6;
    case "sunrisePoint":
      return 10;
    default:
      return 16;
  }
}

/**
 * Twelve bits of read and twelve of write in one dword per master, rather than
 * a byte of each.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.hasWideMasks
 */
export function hasWideMasks(generation: DescriptorGeneration): boolean {
  return !OLDER.has(generation);
}

/**
 * A chip's density is three bits up to Panther Point and four from Lynx Point
 * on, which is what lets a chip be 32 or 64 MB.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.densityBits
 */
export function densityBits(generation: DescriptorGeneration): number {
  switch (generation) {
    case "ich8":
    case "ich9":
    case "ich10":
    case "ibexPeak":
    case "cougarPoint":
    case "bayTrail":
      return 3;
    default:
      return 4;
  }
}

/**
 * From Sunrise Point on the partition boundary register holds four more
 * forbidden opcodes instead.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.hasEightInvalidInstructions
 */
export function hasEightInvalidInstructions(generation: DescriptorGeneration): boolean {
  return !OLDER.has(generation);
}

/**
 * The SPI clock a three-bit code stands for, in MHz. A code the generation
 * reserves has none; Apollo and Gemini Lake give one code two clocks.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.clock
 */
export function generationClock(
  generation: DescriptorGeneration,
  code: number
): readonly number[] | undefined {
  return clockTable(generation).get(code);
}

function clockTable(generation: DescriptorGeneration): ReadonlyMap<number, readonly number[]> {
  switch (generation) {
    case "ich8":
    case "ich9":
    case "ich10":
      return new Map([
        [0, [20]],
        [1, [33]],
      ]);
    case "ibexPeak":
    case "cougarPoint":
    case "bayTrail":
    case "lynxPoint":
      return new Map([
        [0, [20]],
        [1, [33]],
        [4, [50]],
      ]);
    case "sunrisePoint":
    case "lewisburg":
    case "cannonPoint":
    case "jasperLake":
      return new Map([
        [2, [48]],
        [4, [30]],
        [6, [17]],
      ]);
    case "apolloLake":
    case "geminiLake":
      return new Map([
        [1, [50]],
        [2, [40]],
        [4, [25]],
        [6, [14, 17]],
      ]);
    case "elkhartLake":
      return new Map([
        [1, [50]],
        [4, [33]],
        [5, [20]],
      ]);
    case "tigerPoint":
    case "alderPoint":
    case "emmitsburg":
    case "meteorLake":
    case "pantherLake":
    case "wildcatLake":
    case "novaLake":
      return new Map([
        [0, [100]],
        [1, [50]],
        [3, [33]],
        [4, [25]],
        [6, [14]],
      ]);
  }
}

/**
 * The upper map, at a fixed offset near the end of the descriptor, whose top
 * byte is where the MIP descriptor table begins.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.UpperMap.offset
 */
const UPPER_MAP_OFFSET = 0x0efc;

/**
 * The generation the descriptor at `base` was written for, and whether its
 * layout is one the rules know or the nearest they assume. Nothing when the map
 * cannot be read.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorGeneration.swift#DescriptorGeneration.read
 */
export function readDescriptorGeneration(
  base: number,
  reader: ImageReader
): { readonly generation: DescriptorGeneration; readonly isCertain: boolean } | undefined {
  const map1 = reader.uint32(base + Descriptor.map1Offset);
  const map2 = reader.uint32(base + Descriptor.map2Offset);
  if (map1 === undefined || map2 === undefined) return undefined;
  // A descriptor cut short before its upper map reads as erased there.
  const upper = reader.uint32(base + UPPER_MAP_OFFSET) ?? 0xffff_ffff;
  const pchStrapLength = map1 >>> 24;
  const masterCount = (map1 >>> 8) & 0x7;
  const procStrapBase = map2 & 0xff;
  const procStrapLength = (map2 >>> 8) & 0xff;
  // ICC register init base, new with Sandy Bridge.
  const iccBase = (map2 >>> 16) & 0xff;
  // The MIP descriptor table base, new with Cannon Point.
  const mipBase = upper >>> 24;
  // From Tiger Point on the third map word says where the CPU straps sit in the
  // PMC's space instead.
  const cpuStrapOffset = (map2 >>> 2) & 0x3ff;
  const cpuStrapLength = (map2 >>> 16) & 0xff;
  const certain = (generation: DescriptorGeneration, isCertain = true) => ({
    generation,
    isCertain,
  });

  if (iccBase === 0) {
    if (procStrapLength === 0 && pchStrapLength <= 2) return certain("ich8");
    if (pchStrapLength <= 2) return certain("ich9");
    if (pchStrapLength <= 10) return certain("ich10");
    if (pchStrapLength <= 16) return certain("ibexPeak");
    if (map2 === 0) {
      if (pchStrapLength === 19) return certain("apolloLake");
      return certain("geminiLake", pchStrapLength === 23);
    }
    if (pchStrapLength === 0x50) return certain("emmitsburg");
    return certain("ibexPeak", false);
  }
  if (mipBase === 0) {
    if (iccBase < 0x31 && procStrapBase < 0x30) {
      if (procStrapLength === 0 && pchStrapLength <= 17) return certain("bayTrail");
      if (procStrapLength <= 1 && pchStrapLength <= 18) return certain("cougarPoint");
      return certain("lynxPoint", procStrapLength <= 1 && pchStrapLength <= 21);
    }
    if (masterCount === 6) return certain("lewisburg", iccBase <= 0x34);
    return certain("sunrisePoint", iccBase === 0x31);
  }
  if (iccBase === 0x34) return certain("cannonPoint");
  // flashrom names Tiger Point by an offset of 0x68; Tiger Point H boards
  // (`1.bin`) write 0x6C, and nothing else at hand has a length of 0x11 — so the
  // length alone names it, unless the offset is Alder Point's.
  if (cpuStrapLength === 0x11)
    return certain(cpuStrapOffset === 0x5c ? "alderPoint" : "tigerPoint");
  if (cpuStrapLength === 0x14) return certain("alderPoint");
  if (cpuStrapLength === 0x03) {
    switch (cpuStrapOffset) {
      case 0x58:
        return certain("elkhartLake");
      case 0x6c:
        return certain("jasperLake");
      case 0x70:
        return certain("meteorLake");
      case 0x60:
        if (pchStrapLength === 0x78) return certain("wildcatLake");
        if (pchStrapLength === 0xa9) return certain("novaLake");
        return certain("pantherLake");
    }
  }
  return certain("tigerPoint", false);
}
