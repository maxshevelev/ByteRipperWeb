/**
 * The Tiano / EFI 1.1 decompressor — a port of EDK2's `EfiTianoDecompress.c`
 * (Intel, Apple, LongSoft, BSD-licensed), the file upstream vendors from
 * UEFITool NE in its `FirmwareCompression` package.
 *
 * One algorithm with one switch: the block header's *Position Set Code Length
 * Array Size* is read as four bits for EFI 1.1 and five for Tiano, and nothing
 * else about the two differs. That is why a buffer usually decodes both ways
 * and only one of the results is the data.
 *
 * Ported routine for routine, with the C's names, so the two read side by side.
 * Two things the C gets from its types are spelled out here: a shift of 32 is a
 * zero rather than a shift of none, and the `(INT16)(--Count) >= 0` loops —
 * which count down through an unsigned wrap — are written as an explicit
 * sixteen-bit decrement and a signed test.
 *
 * The scratch space is this module's own state; nothing is allocated by the
 * caller, so `ctiano_decode`'s malloc and free have no counterpart.
 */

// MARK: - The decompressor's constants

const BITBUFSIZ = 32;
const MAXMATCH = 256;
const THRESHOLD = 3;
const CODE_BIT = 16;
/** `(UINT16)BAD_TABLE` — what `MakeTable` returns as its failure. */
const BAD_TABLE = 0xffff;

/** C: Char&Len Set; P: Position Set; T: exTra Set. */
const NC = 0xff + MAXMATCH + 2 - THRESHOLD;
const CBIT = 9;
const MAXPBIT = 5;
const TBIT = 5;
const MAXNP = (1 << MAXPBIT) - 1;
const NT = CODE_BIT + 3;
const NPT = NT > MAXNP ? NT : MAXNP;

/** Compressed size, then original size, each 32 bits. */
export const TIANO_HEADER_SIZE = 8;

/**
 * The decoder's whole state — the C's `SCRATCH_DATA`, which the caller there
 * allocates and hands in, and which here is made where the decode starts. It
 * carries no `@upstream` anchor because it is a `typedef struct`, and the
 * anchor check reads a C file for its functions.
 */
interface Scratch {
  /** The compressed data, past the header. */
  readonly srcBase: Uint8Array;
  readonly dstBase: Uint8Array;
  outBuf: number;
  inBuf: number;

  bitCount: number;
  bitBuf: number;
  subBitBuf: number;
  blockSize: number;
  compSize: number;
  readonly origSize: number;

  badTableFlag: number;

  readonly left: Uint16Array;
  readonly right: Uint16Array;
  readonly cLen: Uint8Array;
  readonly ptLen: Uint8Array;
  readonly cTable: Uint16Array;
  readonly ptTable: Uint16Array;

  /**
   * The length of the field *Position Set Code Length Array Size* in the block
   * header: 4 for EFI 1.1, 5 for Tiano.
   */
  readonly pBit: number;
}

/** The C's `LShiftU64` then truncation: a shift of 32 or more leaves nothing. */
const shiftLeft32 = (value: number, count: number) => (count >= 32 ? 0 : (value << count) >>> 0);

/** The `(INT16)` of a value the C has already wrapped to sixteen bits. */
const asInt16 = (value: number) => (value << 16) >> 16;

/**
 * Read `numOfBits` of bits from the source into `bitBuf`, shifting it left by
 * as many first. Past the end of the stream the padding is zero bits.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#FillBuf
 */
function fillBuf(sd: Scratch, numOfBits: number): void {
  let remaining = numOfBits;
  sd.bitBuf = shiftLeft32(sd.bitBuf, remaining);

  while (remaining > sd.bitCount) {
    remaining = (remaining - sd.bitCount) & 0xffff;
    sd.bitBuf = (sd.bitBuf | shiftLeft32(sd.subBitBuf, remaining)) >>> 0;

    if (sd.compSize > 0) {
      sd.compSize--;
      sd.subBitBuf = sd.srcBase[sd.inBuf++] ?? 0;
      sd.bitCount = 8;
    } else {
      // No more bits from the source, just pad zero bit.
      sd.subBitBuf = 0;
      sd.bitCount = 8;
    }
  }

  sd.bitCount = (sd.bitCount - remaining) & 0xffff;
  sd.bitBuf = (sd.bitBuf | (sd.subBitBuf >>> sd.bitCount)) >>> 0;
}

/**
 * Pop `numOfBits` of bits off the left of `bitBuf` and refill behind them.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#GetBits
 */
function getBits(sd: Scratch, numOfBits: number): number {
  const outBits = sd.bitBuf >>> (BITBUFSIZ - numOfBits);
  fillBuf(sd, numOfBits);
  return outBits >>> 0;
}

/**
 * Build the Huffman mapping table for a symbol set from its code length array:
 * codes no longer than `tableBits` are looked up directly, longer ones walk the
 * `left` / `right` tree the spare entries hold.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#MakeTable
 */
function makeTable(
  sd: Scratch,
  numOfChar: number,
  bitLen: Uint8Array,
  tableBits: number,
  table: Uint16Array
): number {
  const count = new Uint16Array(17);
  const weight = new Uint16Array(17);
  const start = new Uint16Array(18);

  // The widest mapping table this works over is 16 bits.
  if (tableBits >= count.length) return BAD_TABLE;

  for (let index = 0; index < numOfChar; index++) {
    const length = bitLen[index] ?? 0;
    if (length > 16) return BAD_TABLE;
    count[length] = ((count[length] ?? 0) + 1) & 0xffff;
  }

  start[0] = 0;
  start[1] = 0;

  for (let index = 1; index <= 16; index++) {
    start[index + 1] = ((start[index] ?? 0) + ((count[index] ?? 0) << (16 - index))) & 0xffff;
  }

  // The codes have to fill the space exactly: anything left over, and the
  // lengths are not a Huffman code.
  if ((start[17] ?? 0) !== 0) return BAD_TABLE;

  const juBits = 16 - tableBits;

  weight[0] = 0;
  let index = 1;
  for (; index <= tableBits; index++) {
    start[index] = (start[index] ?? 0) >>> juBits;
    weight[index] = 1 << (tableBits - index);
  }

  while (index <= 16) {
    weight[index] = 1 << (16 - index);
    index++;
  }

  index = (start[tableBits + 1] ?? 0) >>> juBits;

  if (index !== 0) {
    const limit = 1 << tableBits;
    if (index < limit) table.fill(0, index, limit);
  }

  let avail = numOfChar;
  const mask = 1 << (15 - tableBits);
  const maxTableLength = 1 << tableBits;

  for (let char = 0; char < numOfChar; char++) {
    const length = bitLen[char] ?? 0;
    if (length === 0 || length >= 17) continue;

    const nextCode = ((start[length] ?? 0) + (weight[length] ?? 0)) & 0xffff;

    if (length <= tableBits) {
      for (let slot = start[length] ?? 0; slot < nextCode; slot++) {
        if (slot >= maxTableLength) return BAD_TABLE;
        table[slot] = char;
      }
    } else {
      // The code is longer than the table is wide: the remaining bits walk a
      // tree of left / right pairs, and the table entry points at its root.
      let code = start[length] ?? 0;
      let pointer = table;
      let at = code >>> juBits;
      let depth = length - tableBits;

      while (depth !== 0) {
        if ((pointer[at] ?? 0) === 0 && avail < 2 * NC - 1) {
          sd.right[avail] = 0;
          sd.left[avail] = 0;
          pointer[at] = avail++;
        }

        if ((pointer[at] ?? 0) < 2 * NC - 1) {
          const next = pointer[at] ?? 0;
          pointer = (code & mask) !== 0 ? sd.right : sd.left;
          at = next;
        }

        code = (code << 1) & 0xffff;
        depth--;
      }

      pointer[at] = char;
    }

    start[length] = nextCode;
  }

  return 0;
}

/**
 * Decode a position value against the Position Set's table.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#DecodeP
 */
function decodeP(sd: Scratch): number {
  let value = sd.ptTable[sd.bitBuf >>> (BITBUFSIZ - 8)] ?? 0;

  if (value >= MAXNP) {
    let mask = 1 << (BITBUFSIZ - 1 - 8);

    do {
      value = ((sd.bitBuf & mask) !== 0 ? sd.right[value] : sd.left[value]) ?? 0;
      mask >>>= 1;
    } while (value >= MAXNP);
  }

  // Advance what we have read.
  fillBuf(sd, sd.ptLen[value] ?? 0);

  return value > 1 ? ((1 << (value - 1)) + getBits(sd, value - 1)) >>> 0 : value;
}

/**
 * Read the Extra Set's or the Position Set's code length array and build its
 * table. A length under 7 is three bits; above it, that many "1"s and a "0".
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#ReadPTLen
 */
function readPTLen(sd: Scratch, nn: number, nbit: number, special: number): number {
  const number = getBits(sd, nbit) & 0xffff;

  // Fail if the count, or the set, is larger than the array they go in.
  if (number > sd.ptLen.length || nn > sd.ptLen.length) return BAD_TABLE;

  if (number === 0) {
    // This represents only Huffman code used.
    const charC = getBits(sd, nbit) & 0xffff;
    sd.ptTable.fill(charC);
    sd.ptLen.fill(0, 0, nn);
    return 0;
  }

  let index = 0;

  while (index < number && index < NPT) {
    let charC = sd.bitBuf >>> (BITBUFSIZ - 3);

    if (charC === 7) {
      let mask = 1 << (BITBUFSIZ - 1 - 3);
      while ((mask & sd.bitBuf) !== 0) {
        mask >>>= 1;
        charC += 1;
      }
    }

    fillBuf(sd, charC < 7 ? 3 : charC - 3);

    sd.ptLen[index++] = charC & 0xff;

    // After the third length, a 2-bit value says how many zero lengths follow.
    if (index === special) {
      let run = getBits(sd, 2) & 0xffff;
      run = (run - 1) & 0xffff;
      while (asInt16(run) >= 0 && index < NPT) {
        sd.ptLen[index++] = 0;
        run = (run - 1) & 0xffff;
      }
    }
  }

  while (index < nn && index < NPT) {
    sd.ptLen[index++] = 0;
  }

  return makeTable(sd, nn, sd.ptLen, 8, sd.ptTable);
}

/**
 * Read and decode the Char&Len Set's code length array — itself coded against
 * the Extra Set — and build its table.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#ReadCLen
 */
function readCLen(sd: Scratch): void {
  const number = getBits(sd, CBIT) & 0xffff;

  if (number === 0) {
    // This represents only Huffman code used.
    const charC = getBits(sd, CBIT) & 0xffff;
    sd.cLen.fill(0);
    sd.cTable.fill(charC);
    return;
  }

  let index = 0;
  while (index < number && index < NC) {
    let charC = sd.ptTable[sd.bitBuf >>> (BITBUFSIZ - 8)] ?? 0;
    if (charC >= NT) {
      let mask = 1 << (BITBUFSIZ - 1 - 8);

      do {
        charC = ((mask & sd.bitBuf) !== 0 ? sd.right[charC] : sd.left[charC]) ?? 0;
        mask >>>= 1;
      } while (charC >= NT);
    }

    // Advance what we have read.
    fillBuf(sd, sd.ptLen[charC] ?? 0);

    if (charC <= 2) {
      // A run of zero lengths, its count coded three ways by how long it is.
      if (charC === 0) {
        charC = 1;
      } else if (charC === 1) {
        charC = (getBits(sd, 4) + 3) & 0xffff;
      } else {
        charC = (getBits(sd, CBIT) + 20) & 0xffff;
      }

      charC = (charC - 1) & 0xffff;
      while (asInt16(charC) >= 0 && index < NC) {
        sd.cLen[index++] = 0;
        charC = (charC - 1) & 0xffff;
      }
    } else {
      sd.cLen[index++] = (charC - 2) & 0xff;
    }
  }

  sd.cLen.fill(0, index, NC);

  makeTable(sd, NC, sd.cLen, 12, sd.cTable);
}

/**
 * Decode one character or length value, reading a new block's three tables
 * first when the last block is spent.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#DecodeC
 */
function decodeC(sd: Scratch): number {
  if (sd.blockSize === 0) {
    // Starting a new block: its size, then the Extra Set, the Char&Len Set and
    // the Position Set.
    sd.blockSize = getBits(sd, 16) & 0xffff;

    sd.badTableFlag = readPTLen(sd, NT, TBIT, 3);
    if (sd.badTableFlag !== 0) return 0;

    readCLen(sd);

    sd.badTableFlag = readPTLen(sd, MAXNP, sd.pBit, 0xffff);
    if (sd.badTableFlag !== 0) return 0;
  }

  sd.blockSize = (sd.blockSize - 1) & 0xffff;
  let index = sd.cTable[sd.bitBuf >>> (BITBUFSIZ - 12)] ?? 0;

  if (index >= NC) {
    let mask = 1 << (BITBUFSIZ - 1 - 12);

    do {
      index = ((sd.bitBuf & mask) !== 0 ? sd.right[index] : sd.left[index]) ?? 0;
      mask >>>= 1;
    } while (index >= NC);
  }

  // Advance what we have read.
  fillBuf(sd, sd.cLen[index] ?? 0);

  return index;
}

/**
 * The decode loop: a value under 256 is a byte, anything above is a length and
 * a position back into what has been written.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#Decode
 */
function decode(sd: Scratch): void {
  for (;;) {
    const charC = decodeC(sd);
    if (sd.badTableFlag !== 0) return;

    if (charC < 256) {
      if (sd.outBuf >= sd.origSize) return;
      sd.dstBase[sd.outBuf++] = charC;
    } else {
      // A pointer: the length first, then where it points.
      let bytesRemain = (charC - (0x100 - THRESHOLD)) & 0xffff;
      let dataIdx = (sd.outBuf - decodeP(sd) - 1) >>> 0;

      bytesRemain = (bytesRemain - 1) & 0xffff;
      while (asInt16(bytesRemain) >= 0) {
        if (sd.outBuf >= sd.origSize) return;
        if (dataIdx >= sd.origSize) {
          sd.badTableFlag = BAD_TABLE;
          return;
        }
        sd.dstBase[sd.outBuf++] = sd.dstBase[dataIdx++] ?? 0;

        bytesRemain = (bytesRemain - 1) & 0xffff;
      }

      // Once the output is full, there is nothing more to read.
      if (sd.outBuf >= sd.origSize) return;
    }
  }
}

/**
 * The size the header declares the buffer decompresses to, or nothing when the
 * header does not account for the data it is in front of.
 *
 * The scratch size the C hands back with it has no counterpart: the state is
 * this module's, and the caller has nothing to allocate.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#GetInfo
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#EfiTianoGetInfo
 * @upstream Packages/FirmwareCompression/Sources/CTiano/CTiano.c#ctiano_info
 */
export function tianoInfo(source: Uint8Array): number | undefined {
  if (source.length < TIANO_HEADER_SIZE) return undefined;
  const compressedSize = littleEndian32(source, 0);
  if (source.length < compressedSize + TIANO_HEADER_SIZE) return undefined;
  return littleEndian32(source, 4);
}

/**
 * Decode `source` into `destination`, which is exactly the size the header
 * declares, as Tiano when `tiano` is set and as EFI 1.1 otherwise. False when
 * the stream is not one the decoder reads.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#Decompress
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#EfiDecompress
 * @upstream Packages/FirmwareCompression/Sources/CTiano/Tiano/EfiTianoDecompress.c#TianoDecompress
 * @upstream Packages/FirmwareCompression/Sources/CTiano/CTiano.c#ctiano_decode
 */
export function tianoDecode(source: Uint8Array, destination: Uint8Array, tiano: boolean): boolean {
  const declared = tianoInfo(source);
  if (declared === undefined || declared !== destination.length) return false;

  const compSize = littleEndian32(source, 0);
  const origSize = littleEndian32(source, 4);

  // An empty buffer is a decode that has nothing to do, not a failure.
  if (origSize === 0) return true;

  const sd: Scratch = {
    srcBase: source.subarray(TIANO_HEADER_SIZE),
    dstBase: destination,
    outBuf: 0,
    inBuf: 0,
    bitCount: 0,
    bitBuf: 0,
    subBitBuf: 0,
    blockSize: 0,
    compSize,
    origSize,
    badTableFlag: 0,
    left: new Uint16Array(2 * NC - 1),
    right: new Uint16Array(2 * NC - 1),
    cLen: new Uint8Array(NC),
    ptLen: new Uint8Array(NPT),
    cTable: new Uint16Array(4096),
    ptTable: new Uint16Array(256),
    pBit: tiano ? 5 : 4,
  };

  // Fill the first BITBUFSIZ bits, then decode.
  fillBuf(sd, BITBUFSIZ);
  decode(sd);

  return sd.badTableFlag === 0;
}

function littleEndian32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}
