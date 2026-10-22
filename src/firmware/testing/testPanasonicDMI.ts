/**
 * A synthetic Panasonic DMI block of the shape the dumps have — short and long record headers,
 * records back to back and with a gap, every part summing to 0 — holding no real serial or key.
 * Upstream repeats it in each test file (PanasonicDMIStoreTests, UEFIPanasonicDMIDetailTests);
 * here the two share it.
 */

export const PANASONIC_SERIAL = "TEST0000SERIAL1";
export const PANASONIC_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE";

/** A record of the block: its ID, where it starts in the block, its length, its header's form. */
export interface TestPanasonicRecord {
  readonly id: number;
  readonly at: number;
  readonly length: number;
  readonly long: boolean;
}

export const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
export const le32 = (value: number): number[] =>
  [0, 1, 2, 3].map((index) => (value >>> (index * 8)) & 0xff);
const ascii = (text: string): number[] => Array.from(text, (unit) => unit.charCodeAt(0));

/** Makes the bytes of `[start, end)` sum to 0 by the byte at `at`. */
export function fixSum(bytes: Uint8Array, start: number, end: number, at: number): void {
  bytes[at] = 0;
  let sum = 0;
  for (let index = start; index < end; index += 1) sum = (sum + (bytes[index] as number)) & 0xff;
  bytes[at] = (0x100 - sum) & 0xff;
}

/**
 * The block, `length` bytes, zero where nothing is written: the header, a directory of `records`
 * whose addresses are `address(at)`, the asset tag in 0x02, the serial in 0x03 and the key in
 * 0x16, each where it is in the dumps — and every checksum holding.
 */
export function panasonicBlock(options: {
  readonly length: number;
  readonly records: readonly TestPanasonicRecord[];
  readonly address: (at: number) => number;
}): Uint8Array {
  const bytes = new Uint8Array(options.length);
  bytes.set(ascii("MEI_FZ55-2"), 0);
  bytes.set(ascii("FZ55FZ-52M4"), 0x28);
  bytes.set(ascii("MEI___CF"), 0x3a);
  // The directory's length in 8-byte units counts its own first eight.
  bytes.set(le16(options.records.length + 1), 0x80);
  options.records.forEach((record, index) => {
    bytes.set([...le32(record.id), ...le32(options.address(record.at))], 0x88 + index * 8);
    bytes.set(
      record.long ? [...le32(record.length), 0, 0x40, 0, 0] : [...le16(record.length), 0],
      record.at
    );
  });
  const at = (id: number) => options.records.find((record) => record.id === id)?.at as number;
  bytes.set(ascii("No Asset Tag"), at(0x02) + 3);
  bytes.set([0x01, ...ascii(`${PANASONIC_SERIAL}\r\n`)], at(0x03) + 3);
  bytes.set(
    [...le32(1), ...le32(0), ...le32(1), ...le32(0), ...le32(29), ...ascii(PANASONIC_KEY)],
    at(0x16) + 8
  );
  fixSum(bytes, 0, 0x80, 0x16);
  fixSum(bytes, 0x80, 0x88 + options.records.length * 8, 0x82);
  for (const record of options.records) {
    fixSum(bytes, record.at, record.at + record.length, record.at + (record.long ? 4 : 2));
  }
  return bytes;
}
