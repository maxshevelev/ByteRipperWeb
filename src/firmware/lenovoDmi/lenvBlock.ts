import {
  keysEqual,
  knownType,
  LenovoDMIFormat,
  type LenovoDMIKey,
  type LenovoDMIKnownType,
  readKey,
  startsWith,
  sum16,
  u16,
  u32,
  xored,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";

/**
 * How a block's body is stored, decided by which reading parses — not by
 * upstream's guess from the block's last byte.
 *
 * - `encoded`: the body is XORed with the key. What every live block examined
 *   holds.
 * - `plain`: the body is in the clear under a non-zero key — what upstream's
 *   "decode" toggle leaves behind. Whether the firmware accepts it is not known.
 * - `keyIsZero`: the key is zero, so the two are the same bytes.
 * - `undetermined`: neither reading parses; the entries shown are what the
 *   encoded reading gave before it ran out.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.Encoding
 */
export type LENVEncoding = "encoded" | "plain" | "keyIsZero" | "undetermined";

/**
 * One entry of a `LENV` block, decoded.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.init
 */
export interface LENVEntry {
  /**
   * Its place in the block, from zero.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.index
   */
  readonly index: number;
  /**
   * Where its header starts in the file.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.offset
   */
  readonly offset: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.key */
  readonly key: LenovoDMIKey;
  /**
   * Bit 0 appears to mark the entry write-protected; the log's Protect and
   * Unprotect operations would be what sets and clears it.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.flags
   */
  readonly flags: number;
  /**
   * Two fields nobody has explained. Zero on every entry examined.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.unknown1
   */
  readonly unknown1: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.unknown2 */
  readonly unknown2: number;
  /**
   * The value, decoded.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.data
   */
  readonly data: Uint8Array;
}

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.isWriteProtected */
export const isWriteProtected = (entry: LENVEntry): boolean => (entry.flags & 1) !== 0;

/**
 * Just the value, in the file. Half-open.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.dataRange
 */
export function entryDataRange(entry: LENVEntry): readonly [number, number] {
  const start = entry.offset + LenovoDMIFormat.lenvEntryHeaderSize;
  return [start, start + entry.data.length];
}

/**
 * The entry's header and data, in the file. Half-open.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.range
 */
export const entryRange = (entry: LENVEntry): readonly [number, number] => [
  entry.offset,
  entryDataRange(entry)[1],
];

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVEntry.knownType */
export const entryKnownType = (entry: LENVEntry): LenovoDMIKnownType | undefined =>
  knownType(entry.key);

/** What a walk over a body found. */
interface Walk {
  readonly entries: LENVEntry[];
  readonly fits: boolean;
  readonly tailIsZero: boolean;
}

/**
 * One `LENV` block: a plain header, then entries — XORed with the header's key,
 * as every block on the dumps examined is.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock
 */
export class LENVBlock {
  /**
   * Where the block starts in the file.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.offset
   */
  readonly offset: number;
  /**
   * The block's bytes as the file holds them, header included.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.stored
   */
  readonly stored: Uint8Array;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.hasSignature */
  readonly hasSignature: boolean;
  /**
   * Higher is newer; 0 is a block the firmware does not use.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.generation
   */
  readonly generation: number;
  /**
   * How many entries the header says follow.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.declaredEntries
   */
  readonly declaredEntries: number;
  /**
   * Bit 0 appears to mark the block write-protected. Not set on any dump
   * examined, so what the firmware does about it is not confirmed.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.accessFlag
   */
  readonly accessFlag: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.xorKey */
  readonly xorKey: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.checksum */
  readonly checksum: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.encoding */
  readonly encoding: LENVEncoding;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.entries */
  readonly entries: readonly LENVEntry[];
  /**
   * True when `declaredEntries` entries were read and every one of them fits in
   * the block.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.entriesFit
   */
  readonly entriesFit: boolean;

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.init */
  constructor(offset: number, stored: Uint8Array) {
    if (stored.length < LenovoDMIFormat.lenvHeaderSize) {
      throw new RangeError("a LENV block is at least its header");
    }
    this.offset = offset;
    this.stored = stored;
    this.hasSignature = startsWith(stored, LenovoDMIFormat.lenvSignature);
    this.generation = u32(stored, 0x04);
    this.declaredEntries = u32(stored, 0x08);
    this.accessFlag = stored[0x0c] ?? 0;
    this.xorKey = stored[0x0d] ?? 0;
    this.checksum = u16(stored, 0x0e);

    const body = stored.subarray(LenovoDMIFormat.lenvHeaderSize);
    const base = offset + LenovoDMIFormat.lenvHeaderSize;
    const count = Math.min(this.declaredEntries, 0x1000);

    if (this.xorKey === 0) {
      const reading = LENVBlock.walk(body, count, base);
      this.encoding = reading.fits ? "keyIsZero" : "undetermined";
      this.entries = reading.entries;
      this.entriesFit = reading.fits;
      return;
    }
    const encoded = LENVBlock.walk(xored(body, this.xorKey), count, base);
    const clear = LENVBlock.walk(body, count, base);
    if (encoded.fits && !clear.fits) {
      this.encoding = "encoded";
      this.entries = encoded.entries;
    } else if (!encoded.fits && clear.fits) {
      this.encoding = "plain";
      this.entries = clear.entries;
    } else if (encoded.fits && clear.fits) {
      // Both parse — a short block can. What follows the entries is zero in the
      // clear on every block examined, so the reading that leaves zeros behind
      // is the one the firmware wrote.
      if (clear.tailIsZero && !encoded.tailIsZero) {
        this.encoding = "plain";
        this.entries = clear.entries;
      } else {
        this.encoding = "encoded";
        this.entries = encoded.entries;
      }
    } else {
      this.encoding = "undetermined";
      this.entries =
        encoded.entries.length >= clear.entries.length ? encoded.entries : clear.entries;
    }
    this.entriesFit = this.encoding !== "undetermined";
  }

  /**
   * The bytes after the header, as stored.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.storedBody
   */
  get storedBody(): Uint8Array {
    return this.stored.subarray(LenovoDMIFormat.lenvHeaderSize);
  }

  /**
   * The checksum the body adds up to.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.computedChecksum
   */
  get computedChecksum(): number {
    return sum16(this.storedBody);
  }

  /**
   * What the body adds up to encoded with the header's key — the checksum this
   * block would carry back in the store.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.encodedChecksum
   */
  get encodedChecksum(): number {
    return sum16(xored(this.storedBody, this.xorKey));
  }

  /**
   * The header's checksum is the one the body has encoded, although the body
   * here is in the clear: a block opened decoded, whose header was left as the
   * store holds it.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.checksumIsOfEncodedBody
   */
  get checksumIsOfEncodedBody(): boolean {
    return (
      this.encoding === "plain" &&
      this.checksum !== this.computedChecksum &&
      this.checksum === this.encodedChecksum
    );
  }

  /**
   * The checksum adds up — over the body as it lies, or, for a block in the
   * clear, over the body as it would be encoded again. Upstream's "decode"
   * rewrites the checksum for the clear body; a block opened decoded here keeps
   * the store's. Either is a block in order.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.checksumIsValid
   */
  get checksumIsValid(): boolean {
    return this.computedChecksum === this.checksum || this.checksumIsOfEncodedBody;
  }

  /**
   * The checksum the header should carry: the clear body's, unless the header
   * already speaks for the encoded one.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.expectedChecksum
   */
  get expectedChecksum(): number {
    return this.encoding === "plain" && this.checksum !== this.computedChecksum && this.xorKey !== 0
      ? this.encodedChecksum
      : this.computedChecksum;
  }

  /**
   * Every byte `FF`: the page was erased and nothing was written since.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.isErased
   */
  get isErased(): boolean {
    return this.stored.every((byte) => byte === 0xff);
  }

  /**
   * A block the firmware can use: signed, with a generation.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.isUsable
   */
  get isUsable(): boolean {
    return this.hasSignature && this.generation !== 0;
  }

  /**
   * Signed, with generation, count, key and checksum all zero and nothing
   * written after the header but erased bytes — a store wiped or never filled.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.isBlank
   */
  get isBlank(): boolean {
    return (
      this.hasSignature &&
      this.generation === 0 &&
      this.declaredEntries === 0 &&
      this.storedBody.every((byte) => byte === 0xff || byte === 0x00)
    );
  }

  /**
   * The key the body is decoded with: the header's for an encoded block, none
   * for one that is already in the clear.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.effectiveKey
   */
  get effectiveKey(): number {
    return this.encoding === "plain" ? 0 : this.xorKey;
  }

  /**
   * The range the block covers in the file. Half-open.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.range
   */
  get range(): readonly [number, number] {
    return [this.offset, this.offset + this.stored.length];
  }

  /**
   * The block `stored` holds, when its header reads as one on its own, away
   * from an area: signed, a whole page, and holding entries that fit or nothing
   * at all. A stray `LENV` in a driver's code has a count that does not parse
   * under either reading; a block emptied has none.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.found
   */
  static found(stored: Uint8Array, offset: number): LENVBlock | undefined {
    if (
      stored.length !== LenovoDMIFormat.lenvSize ||
      !startsWith(stored, LenovoDMIFormat.lenvSignature)
    ) {
      return undefined;
    }
    const block = new LENVBlock(offset, stored);
    return block.entriesFit && (block.declaredEntries > 0 || block.isBlank) ? block : undefined;
  }

  /**
   * The entries of `body` read one after another, until `count` have been read
   * or one does not fit.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.walk
   */
  static walk(body: Uint8Array, count: number, base: number): Walk {
    const entries: LENVEntry[] = [];
    let position = 0;
    for (let index = 0; index < count; index++) {
      if (position + LenovoDMIFormat.lenvEntryHeaderSize > body.length) {
        return { entries, fits: false, tailIsZero: false };
      }
      const size = u32(body, position + 0x10);
      const dataStart = position + LenovoDMIFormat.lenvEntryHeaderSize;
      if (size > body.length - dataStart) return { entries, fits: false, tailIsZero: false };
      // The free space after the last entry is zeros, and zeros read as an
      // entry of no bytes under a key of no bytes. A count that runs into them
      // has run out of entries, not found more.
      if (size === 0 && body.subarray(position, dataStart).every((byte) => byte === 0)) {
        return { entries, fits: false, tailIsZero: false };
      }
      entries.push({
        index,
        offset: base + position,
        key: readKey(body, position),
        flags: body[position + 0x14] ?? 0,
        unknown1: body[position + 0x15] ?? 0,
        unknown2: u16(body, position + 0x16),
        data: body.slice(dataStart, dataStart + size),
      });
      position = dataStart + size;
    }
    const tailIsZero = body.subarray(position).every((byte) => byte === 0);
    return { entries, fits: true, tailIsZero };
  }

  /**
   * The entry filed under `key`, if this block has one.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LENVBlock.swift#LENVBlock.entry
   */
  entry(key: LenovoDMIKey): LENVEntry | undefined {
    return this.entries.find((entry) => keysEqual(entry.key, key));
  }
}
