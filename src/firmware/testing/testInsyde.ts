/**
 * Insyde structures, built byte for byte. Ported from upstream's
 * `InsydeBVDTTests.table`, which lives in a test there and in a fixture module
 * here because two test files read it.
 */

export const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

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
  bytes.push(...ascii("$BME$"), 0x00, 0xa0, 0x0a, 0x00);
  bytes.push(...(options.records ?? [...ascii("$RDATE"), 0x24, 0x01, 0x08]));
  bytes.push(...ascii("$ENDOFBVDT"), ...(options.afterEnd ?? []));
  bytes.push(...new Array<number>(0x1000 - bytes.length).fill(0xff));
  return Uint8Array.from(bytes);
}
