import {
  LenovoDMIFormat,
  type LenovoDMIKey,
  smbiosKey,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";

/**
 * A store built byte by byte, laid out the way the real dumps lay theirs out: a
 * log of 32-byte entries, then two `LENV` blocks XORed with one key.
 *
 * The values are made up. The dumps upstream checked this against belong to
 * customers' machines, and their serial numbers, UUIDs and keys stay out of the
 * repository.
 *
 * @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore
 */

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.Entry */
export interface TestEntry {
  readonly key: LenovoDMIKey;
  readonly data: Uint8Array;
  readonly flags?: number;
}

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.LogEntry */
export interface TestLogEntry {
  /** BCD year, BCD century, month, day, hour, minute, second. */
  readonly timestamp: readonly number[];
  readonly operation: number;
  readonly key: LenovoDMIKey;
  readonly size: number;
}

const text = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0));

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.le16 */
export const le16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.le32 */
export const le32 = (value: number): number[] =>
  [0, 1, 2, 3].map((i) => (value >>> (8 * i)) & 0xff);

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.otherNamespace */
export const OTHER_NAMESPACE: readonly number[] = [
  0x46, 0x8f, 0x44, 0x64, 0x23, 0x6e, 0x88, 0x42, 0x93, 0x49, 0xfd, 0xd8, 0x87, 0xc4,
];

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.serial */
export const SERIAL: TestEntry = { key: smbiosKey(0x0400), data: text("PF0TEST1") };
/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.mtm */
export const MTM: TestEntry = { key: smbiosKey(0x0200), data: text("82XX0000GE") };
/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.uuid */
export const UUID: TestEntry = {
  key: smbiosKey(0x0500),
  data: Uint8Array.of(
    0x36,
    0x82,
    0x67,
    0x2b,
    0x1b,
    0x3b,
    0xed,
    0x11,
    0x80,
    0xf2,
    0x01,
    0x02,
    0x03,
    0x04,
    0x05,
    0x06
  ),
};
/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.unknown */
export const UNKNOWN: TestEntry = { key: smbiosKey(0x0700), data: Uint8Array.of(0x19) };
/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.foreign */
export const FOREIGN: TestEntry = {
  key: { namespace: OTHER_NAMESPACE, type: 0xe10d },
  data: new Uint8Array(8),
};

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.standardEntries */
export const STANDARD_ENTRIES: readonly TestEntry[] = [FOREIGN, SERIAL, UUID, UNKNOWN, MTM];

/**
 * One block's 4 KiB: header, entries encoded with `key` unless `encode` is
 * false, zeros after them (encoded, so they read as the key), and the checksum
 * of the body as stored.
 *
 * @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.block
 */
export function testBlock(options: {
  readonly generation: number;
  readonly key: number;
  readonly entries: readonly TestEntry[];
  readonly encode?: boolean;
  readonly declared?: number;
  readonly checksum?: number;
}): Uint8Array {
  const body: number[] = [];
  for (const entry of options.entries) {
    body.push(...entry.key.namespace, ...le16(entry.key.type), ...le32(entry.data.length));
    body.push(entry.flags ?? 0, 0, 0, 0, ...entry.data);
  }
  while (body.length < LenovoDMIFormat.lenvSize - 16) body.push(0);
  const stored = options.encode === false ? body : body.map((byte) => byte ^ options.key);
  const sum = options.checksum ?? stored.reduce((total, byte) => (total + byte) & 0xffff, 0);
  return Uint8Array.from([
    ...text("LENV"),
    ...le32(options.generation),
    ...le32(options.declared ?? options.entries.length),
    0,
    options.key,
    ...le16(sum),
    ...stored,
  ]);
}

/**
 * The log's 8 KiB: header with the write offset in the clear, entries encoded
 * with `key`, zeros after them encoded too.
 *
 * @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.log
 */
export function testLog(
  entries: readonly TestLogEntry[],
  key: number,
  writeOffset?: number
): Uint8Array {
  const body: number[] = [];
  for (const entry of entries) {
    body.push(...entry.timestamp, entry.operation, ...entry.key.namespace);
    body.push(...le16(entry.key.type), ...le32(entry.size), 0, 0, 0, 0);
  }
  const offset = writeOffset ?? 0x20 + body.length;
  while (body.length < LenovoDMIFormat.ldbgSize - 0x20) body.push(0);
  return Uint8Array.from([
    ...text("LDBG"),
    ...le32(offset),
    ...new Array<number>(24).fill(0),
    ...body.map((byte) => byte ^ key),
  ]);
}

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.standardLog */
export const STANDARD_LOG: readonly TestLogEntry[] = [
  // Written before the clock was set: not a date.
  {
    timestamp: [0xdf, 0x20, 0x00, 0x27, 0xe7, 0x3c, 0x26],
    operation: 2,
    key: smbiosKey(0x0011),
    size: 1,
  },
  {
    timestamp: [0x15, 0x20, 0x11, 0x15, 0x00, 0x01, 0x08],
    operation: 2,
    key: smbiosKey(0x0500),
    size: 16,
  },
  {
    timestamp: [0x22, 0x20, 0x06, 0x29, 0x20, 0x30, 0x25],
    operation: 2,
    key: smbiosKey(0x0400),
    size: 8,
  },
];

/**
 * An image: `before` bytes of FF, the area, `after` bytes of FF.
 *
 * @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.image
 */
export function testStoreImage(options: {
  readonly log: Uint8Array;
  readonly blocks: readonly Uint8Array[];
  readonly before?: number;
  readonly after?: number;
}): Uint8Array {
  const before = options.before ?? 0x3000;
  const after = options.after ?? 0x1000;
  const parts = [
    new Uint8Array(before).fill(0xff),
    options.log,
    ...options.blocks,
    new Uint8Array(after).fill(0xff),
  ];
  const image = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    image.set(part, at);
    at += part.length;
  }
  return image;
}

/** @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.standardImage */
export function standardStoreImage(key = 0x7f): Uint8Array {
  return testStoreImage({
    log: testLog(STANDARD_LOG, key),
    blocks: [
      testBlock({ generation: 127, key, entries: STANDARD_ENTRIES }),
      testBlock({ generation: 126, key, entries: STANDARD_ENTRIES.slice(0, -1) }),
    ],
  });
}

/**
 * What a wiped store looks like on the dump examined: both blocks signed, every
 * header field after the signature zero, the bodies erased, and the log's write
 * offset erased with them.
 *
 * @upstream Packages/LenovoDMI/Tests/LenovoDMITests/TestStore.swift#TestStore.wipedImage
 */
export function wipedStoreImage(): Uint8Array {
  const blank = Uint8Array.from([
    ...text("LENV"),
    ...new Array<number>(12).fill(0),
    ...new Array<number>(LenovoDMIFormat.lenvSize - 16).fill(0xff),
  ]);
  const log = Uint8Array.from([
    ...text("LDBG"),
    0xff,
    0xff,
    0xff,
    0xff,
    ...new Array<number>(24).fill(0),
    ...new Array<number>(LenovoDMIFormat.ldbgSize - 0x20).fill(0xff),
  ]);
  return testStoreImage({ log, blocks: [blank, blank] });
}
