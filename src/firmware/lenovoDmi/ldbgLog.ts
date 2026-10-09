import {
  LenovoDMIFormat,
  type LenovoDMIKey,
  readKey,
  u32,
  xored,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";

/**
 * What is wrong with the log's write offset: `erased` — `FFFFFFFF`, the log was
 * erased and nothing has been written since; `outOfRange` — before the first
 * entry, or past the end of the log; `misaligned` — not a whole number of
 * entries after the header.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.WriteOffsetProblem
 */
export type WriteOffsetProblem = "erased" | "outOfRange" | "misaligned";

/**
 * The operations the firmware is known to write to its log.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.Operation
 */
export type LDBGOperation = "setData" | "protect" | "unprotect";

const OPERATIONS: ReadonlyMap<number, LDBGOperation> = new Map([
  [0x02, "setData"],
  [0x06, "protect"],
  [0x07, "unprotect"],
]);

/**
 * The timestamp, when its bytes are a date.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.timestamp
 * @upstream-differs a plain record where upstream returns `DateComponents`
 */
export interface LDBGTimestamp {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * One entry of the change log.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry
 */
export class LDBGEntry {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.index */
  readonly index: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.offset */
  readonly offset: number;
  /**
   * The seven timestamp bytes as read: BCD year, BCD century, month, day, hour,
   * minute, second.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.timestampBytes
   */
  readonly timestampBytes: Uint8Array;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.operation */
  readonly operation: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.key */
  readonly key: LenovoDMIKey;
  /**
   * How many bytes the operation wrote. A SetData of zero bytes is followed on
   * the dumps examined by the entry being gone from the newer block, which
   * makes it read as a removal — not confirmed in the firmware.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.size
   */
  readonly size: number;
  /**
   * Four bytes nobody has explained. Zero on every entry examined.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.unknown
   */
  readonly unknown: Uint8Array;

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.init */
  constructor(index: number, offset: number, bytes: Uint8Array) {
    this.index = index;
    this.offset = offset;
    this.timestampBytes = bytes.slice(0, 7);
    this.operation = bytes[7] ?? 0;
    this.key = readKey(bytes, 8);
    this.size = u32(bytes, 0x18);
    this.unknown = bytes.slice(0x1c, 0x20);
  }

  /**
   * Half-open.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.range
   */
  get range(): readonly [number, number] {
    return [this.offset, this.offset + LenovoDMIFormat.ldbgEntrySize];
  }

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.knownOperation */
  get knownOperation(): LDBGOperation | undefined {
    return OPERATIONS.get(this.operation);
  }

  /**
   * The timestamp, when its bytes are a date.
   *
   * Upstream reads the first two bytes as a 16-bit year "2000 + BCD byte". On
   * real dumps the second byte is `0x20` on every entry that reads as a date,
   * and the pair is a BCD century and a BCD year — `22 20` is 2022. Entries
   * written before the clock was set read as no date at all, and are shown as
   * their bytes.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.timestamp
   */
  get timestamp(): LDBGTimestamp | undefined {
    const [year, century, month, day, hour, minute, second] = Array.from(this.timestampBytes, bcd);
    if (
      year === undefined ||
      century === undefined ||
      month === undefined ||
      month < 1 ||
      month > 12 ||
      day === undefined ||
      day < 1 ||
      day > 31 ||
      hour === undefined ||
      hour >= 24 ||
      minute === undefined ||
      minute >= 60 ||
      second === undefined ||
      second >= 60
    ) {
      return undefined;
    }
    return { year: century * 100 + year, month, day, hour, minute, second };
  }

  /**
   * `YYYY-MM-DD hh:mm:ss`, the way the clock wrote it — no time zone is stored,
   * so none is applied.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.timestampText
   */
  get timestampText(): string | undefined {
    const t = this.timestamp;
    if (t === undefined) return undefined;
    const two = (value: number) => String(value).padStart(2, "0");
    return `${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}:${two(t.second)}`;
  }

  /**
   * An operation the firmware is known to write, under a key whose bytes are
   * not all one value — what decides which key the log is read with.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGEntry.looksLikeAnEntry
   */
  get looksLikeAnEntry(): boolean {
    return (
      this.knownOperation !== undefined &&
      new Set(this.key.namespace).size > 1 &&
      this.size <= LenovoDMIFormat.lenvSize
    );
  }
}

/** A BCD byte's value, or nothing for a byte that is not BCD. */
function bcd(byte: number): number | undefined {
  const high = byte >> 4;
  const low = byte & 0x0f;
  return high < 10 && low < 10 ? high * 10 + low : undefined;
}

/**
 * The `LDBG` change log: what the firmware wrote to the store, when, and how
 * much — a record of writes, not a copy of the values.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog
 */
export class LDBGLog {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.offset */
  readonly offset: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.stored */
  readonly stored: Uint8Array;
  /**
   * Where the firmware appends the next entry, from the start of the log.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.writeOffset
   */
  readonly writeOffset: number;
  /**
   * The 24 header bytes after the write offset. Zero on every dump examined;
   * what they are for is not known.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.unknownHeader
   */
  readonly unknownHeader: Uint8Array;
  /**
   * The key the entries were decoded with, or nothing when there is nothing to
   * decode. Upstream uses the first block's key, and on most dumps the log does
   * share it — but not on all: one dump examined has blocks under `A0` and a log
   * under `88`. The log's free space is zeros encoded, so a run of one byte
   * after the last entry names the key; failing that, the key is the one under
   * which the most entries read as entries.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.key
   */
  readonly key: number | undefined;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.entries */
  readonly entries: readonly LDBGEntry[];
  /**
   * What is wrong with the write offset, if anything.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.writeOffsetProblem
   */
  readonly writeOffsetProblem: WriteOffsetProblem | undefined;

  /**
   * `candidateKeys` are the keys of the blocks after the log, in order; the log
   * is read under each, and in the clear, and the reading in which the most
   * entries look like entries wins.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.init
   */
  constructor(offset: number, stored: Uint8Array, candidateKeys: readonly number[]) {
    if (stored.length < LenovoDMIFormat.ldbgHeaderSize) {
      throw new RangeError("an LDBG log is at least its header");
    }
    this.offset = offset;
    this.stored = stored;
    this.writeOffset = u32(stored, 0x04);
    this.unknownHeader = stored.slice(0x08, LenovoDMIFormat.ldbgHeaderSize);

    const header = LenovoDMIFormat.ldbgHeaderSize;
    const size = LenovoDMIFormat.ldbgEntrySize;
    let end: number;
    if (this.writeOffset === 0xffff_ffff) {
      this.writeOffsetProblem = "erased";
      end = header;
    } else if (this.writeOffset < header || this.writeOffset > stored.length) {
      this.writeOffsetProblem = "outOfRange";
      end = header;
    } else {
      this.writeOffsetProblem = (this.writeOffset - header) % size === 0 ? undefined : "misaligned";
      end = this.writeOffset;
    }
    const count = Math.floor((end - header) / size);
    if (count <= 0) {
      this.key = undefined;
      this.entries = [];
      return;
    }

    // The free space after the entries, if it is one byte repeated, is that
    // byte encoding zeros: the log's own key, whatever the blocks'.
    const keys: number[] = [];
    const tail = stored.subarray(end);
    const first = tail[0];
    if (
      first !== undefined &&
      tail.length >= size &&
      tail.every((byte) => byte === first) &&
      first !== 0xff
    ) {
      keys.push(first);
    }
    for (const candidate of [...candidateKeys, 0]) {
      if (!keys.includes(candidate)) keys.push(candidate);
    }
    const entryBytes = (index: number, key: number): Uint8Array => {
      const start = header + index * size;
      return xored(stored.subarray(start, start + size), key);
    };
    const reads = (candidate: number): number => {
      let found = 0;
      for (let index = 0; index < count; index++) {
        if (new LDBGEntry(index, 0, entryBytes(index, candidate)).looksLikeAnEntry) found++;
      }
      return found;
    };
    // Nothing reads under any of them: every key, the best reading kept.
    if (keys.every((candidate) => reads(candidate) === 0)) {
      for (let candidate = 0; candidate <= 255; candidate++) {
        if (!keys.includes(candidate)) keys.push(candidate);
      }
    }
    let best: { key: number; entries: LDBGEntry[]; score: number } | undefined;
    for (const candidate of keys) {
      const read: LDBGEntry[] = [];
      for (let index = 0; index < count; index++) {
        read.push(
          new LDBGEntry(index, offset + header + index * size, entryBytes(index, candidate))
        );
      }
      const score = read.filter((entry) => entry.looksLikeAnEntry).length;
      if (best === undefined || score > best.score) best = { key: candidate, entries: read, score };
    }
    this.key = best?.key;
    this.entries = best?.entries ?? [];
  }

  /**
   * Half-open.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.range
   */
  get range(): readonly [number, number] {
    return [this.offset, this.offset + this.stored.length];
  }

  /**
   * How many entries the log can hold.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LDBGLog.swift#LDBGLog.capacity
   */
  get capacity(): number {
    return Math.floor(
      (this.stored.length - LenovoDMIFormat.ldbgHeaderSize) / LenovoDMIFormat.ldbgEntrySize
    );
  }
}
