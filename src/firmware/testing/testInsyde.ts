/**
 * Insyde structures, built byte for byte. Ported from upstream's
 * `InsydeBVDTTests.table`, which lives in a test there and in a fixture module
 * here because two test files read it.
 */

export const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/**
 * `all.orig.bin`'s `$BME$`: the table's own region, the microcode volume, and a
 * slot not in use.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.ranges
 */
export const BVDT_RANGES: readonly number[] = [
  0x00, 0xa0, 0x0a, 0x00, 0x00, 0x10, 0x00, 0x00, 0x24, 0x00, 0x00, 0xc4, 0x00, 0x00, 0x00, 0x0c,
  0x00, 0x24, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

/**
 * `all.orig.bin`'s `$_MSC_VER=` and `$ESRT`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.compilerAndESRT
 */
export const BVDT_COMPILER_AND_ESRT: readonly number[] = [
  ...ascii("$_MSC_VER="),
  0x40,
  0x06,
  ...ascii("$ESRT"),
  0x57,
  0x40,
  0x22,
  0x70,
  0x4c,
  0x61,
  0xf9,
  0x94,
  0xf2,
  0xe5,
  0x92,
  0x46,
  0x81,
  0xae,
  0x20,
  0xe9,
  0xc6,
  0x1a,
  0x86,
  0x64,
  0x8b,
  0x01,
  0x00,
  0x00,
];

/**
 * A table: the signature, three strings at their fixed places, erased bytes,
 * then the tagged records up to `$ENDOFBVDT`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.table
 */
export function bvdtTable(
  options: {
    readonly version?: string;
    readonly product?: string;
    readonly kernel?: string;
    readonly ranges?: readonly number[];
    readonly records?: readonly number[];
    readonly afterEnd?: readonly number[];
  } = {}
): Uint8Array {
  const field = (text: string, end: number, start: number): number[] => {
    const bytes = [0x24, ...ascii(text)];
    return [...bytes, ...new Array<number>(end - start - bytes.length).fill(0)];
  };
  const bytes = [
    ...ascii("$BVDT$"),
    0x00,
    0x00,
    0x00,
    0x24,
    0x00,
    0x00,
    0x00,
    ...field(options.version ?? "J2CN57WW", 0x26, 0x0d),
    ...field(options.product ?? "Legion 570 Series Intel", 0x40, 0x26),
    ...field(options.kernel ?? "05.43.44", 0x66, 0x40),
  ];
  bytes.push(...new Array<number>(0x12f - bytes.length).fill(0xff));
  bytes.push(...ascii("$BME$"), ...(options.ranges ?? BVDT_RANGES));
  bytes.push(...(options.records ?? [...ascii("$RDATE"), 0x24, 0x01, 0x08]));
  bytes.push(...ascii("$ENDOFBVDT"), ...(options.afterEnd ?? []));
  bytes.push(...new Array<number>(0x1000 - bytes.length).fill(0xff));
  return Uint8Array.from(bytes);
}

/**
 * A signature block as the dumps at hand have it, the varying bytes set to values
 * one of them carries.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.block
 */
export const ITE_BLOCK: readonly number[] = [
  0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa4, 0x14, 0x85, 0x12, 0x5a, 0x5a, 0xaa, 0xaf, 0x55, 0x55,
];

/**
 * An image `length` bytes long with the block at `at` and the identification
 * after it, padded to sixteen bytes.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.image
 */
export function iteImage(
  options: { readonly identification?: string; readonly at?: number; readonly length?: number } = {}
): Uint8Array {
  const identification = options.identification ?? "ITE8380-EC-V1.43";
  const at = options.at ?? 0x80;
  const bytes = new Uint8Array(options.length ?? 0x1000);
  const text = [...ascii(identification)];
  while (text.length < 16) text.push(0);
  bytes.set([...ITE_BLOCK, ...text], at);
  return bytes;
}
